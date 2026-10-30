// The MCP server's side of the database: read-only.
import { z } from "zod";
import type { StoredAnalysis } from "#/packages/domain/analysis.ts";
import {
  documentKinds,
  positionOf,
  type AgendaItem,
  type AmendmentId,
  type AmendmentPosting,
  type Committee,
  type DocumentId,
  type DocumentKind,
  type DocumentView,
  type IndexCounts,
  type CommitteeId,
  type MeetingContents,
  type MeetingDocument,
  type MeetingHeader,
  type MeetingId,
  type NodeId,
  type PostedAmendment,
  type Relation,
  type RelatedNode,
  type TestimonyEntry,
} from "#/packages/domain/documents.ts";
import {
  measureIdOf,
  type HistoryAction,
  type Measure,
  type MeasureId,
  type MeasureKey,
  type SessionKey,
} from "#/packages/domain/index.ts";
import { comparePrintOrder, type Legislator, type LegislatorId, type Sponsor } from "#/packages/domain/legislators.ts";
import { parseOrsChapterId, parseOrsSectionId, type AgencyId, type SnapshotVersion } from "#/packages/domain/oregonai.ts";
import type {
  AmendmentFile,
  RelatingClauseEdit,
  StatuteLink,
  StatuteLinkSource,
  StatuteParse,
  StoredAmendment,
  StoredVersion,
} from "#/packages/domain/statute-links.ts";
import {
  groupCommitteeVotes,
  groupFloorVotes,
  type CommitteeVote,
  type FloorVote,
  type LegislatorVote,
} from "#/packages/domain/votes.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openReadConnection } from "./lib/connection.ts";

/** What a meetings query asks for. Every field given must hold. */
export type MeetingFilter = {
  /** Meetings with an agenda item about this Measure. */
  measure?: MeasureKey;
  /** Meetings of the committee with this code, as the feed writes it ("SLB"). */
  committeeCode?: string;
  /** Meetings that start on this Pacific date or later: "2025-01-21". */
  from?: string;
  /** Meetings that start on this Pacific date or earlier, the whole day included. */
  to?: string;
};

export type IndexReader = {
  findMeasure(key: MeasureKey): Measure | undefined;
  /** A Measure's Member sponsors in print order. */
  findSponsors(key: MeasureKey): Sponsor[];
  /** The codes of the committees that sponsor a Measure, in print order. */
  findCommitteeSponsors(key: MeasureKey): string[];
  /** The messages of a Measure's Presession rows, as the feed gives them, in print order. */
  findPresessionMessages(key: MeasureKey): string[];
  /** A Measure's history, oldest action first: by the time it happened, then by the feed's id. */
  findHistory(key: MeasureKey): HistoryAction[];
  /**
   * A Measure's floor votes, in the order they were taken (then by the feed's history id), each with the
   * Legislators' votes in the order of the feed's ids for the entries (`MeasureVoteId`).
   */
  findFloorVotes(key: MeasureKey): FloorVote[];
  /**
   * A Measure's committee votes, in the order the committees met (then by the feed's report id), each
   * with the members' votes in the order of the feed's ids for the entries (`CommitteeVoteId`).
   */
  findCommitteeVotes(key: MeasureKey): CommitteeVote[];
  /**
   * The Legislator a Legislator Code names, as the last full pull resolved it, or undefined when the code
   * is not one the pull could resolve. The live lookup resolves the codes in OLIS's current votes this way.
   */
  findLegislatorOfCode(session: SessionKey, code: string): Legislator | undefined;
  /** When the last completed full pull started, or undefined if none has completed. */
  asOf(session: SessionKey): Timestamp | undefined;
  /** The version of the OregonAI snapshot the last completed full pull built the index with. */
  snapshotVersion(session: SessionKey): SnapshotVersion | undefined;
  /**
   * A document by its id, or a Proposed Amendment by its id: the text of its latest posting, with the
   * nodes all its postings point at.
   */
  findDocument(id: DocumentId | AmendmentId): DocumentView | undefined;
  /**
   * The analysis documents the store holds for a Measure: the ones whose files the worker fetched, so
   * that each is a document `findDocument` resolves.
   */
  analysisDocuments(key: MeasureKey): StoredAnalysis[];
  /**
   * How many analysis documents the feed lists for a Measure that the store does not hold, because the
   * worker could not fetch their files. The next pull tries them again.
   */
  analysisNotHeld(key: MeasureKey): number;
  /**
   * A Proposed Amendment by its id: its Measure, every posting the feed lists for it (earliest meeting first,
   * whether or not the store holds the posting's file) and, for each distinct file the store holds among them,
   * what was read of it. Undefined when the feed lists no such amendment.
   */
  findAmendment(id: AmendmentId): StoredAmendment | undefined;
  /** The Versions of a Measure the store holds (not its Printed Amendments), in no particular order, each with what was read of its text. */
  findMeasureVersions(key: MeasureKey): StoredVersion[];
  /** What the index holds of the Session. */
  counts(session: SessionKey): IndexCounts;
  /** A committee by its code or its id, in either case. */
  findCommittee(session: SessionKey, reference: string): Committee | undefined;
  /** The meetings that match, earliest first. */
  findMeetings(session: SessionKey, filter: MeetingFilter): MeetingHeader[];
  /** What one meeting holds. */
  meetingContents(meeting: MeetingId): MeetingContents;
  /**
   * Every Testimony row the feed lists for a Measure, in the order of the feed's `CommTestId`, whether or not
   * its file is fetched.
   */
  findTestimony(key: MeasureKey): TestimonyEntry[];
  /**
   * Whether the feed lists a Testimony with this id, whether or not its file is fetched. A Testimony that is
   * listed and whose file the store lacks is one `findDocument` does not resolve yet: the next pull fetches it.
   */
  listsTestimony(id: DocumentId | AmendmentId): boolean;
  close(): void;
};

const measureRow = z.object({
  catchline: z.string().nullable(),
  location: z.string(),
  committee_code: z.string().nullable(),
  digest: z.string().nullable(),
  created_at: z.string(),
  modified_at: z.string().nullable(),
});
const stateRow = z.object({ full_pull_as_of: z.string() });
const textRow = z.object({ text: z.string() });
const historyRow = z.object({
  history_id: z.number(),
  chamber: z.enum(["house", "senate"]),
  action_date: z.string(),
  action_text: z.string(),
});
const floorVoteRow = z.object({
  history_id: z.number(),
  chamber: z.enum(["house", "senate"]),
  action_date: z.string(),
  action_text: z.string(),
  legislator_code: z.string(),
  legislator_id: z.string().nullable(),
  legislator_name: z.string().nullable(),
  vote: z.string(),
});
const committeeVoteRow = z.object({
  report_id: z.number(),
  committee_code: z.string(),
  meeting_date: z.string(),
  legislator_code: z.string(),
  legislator_id: z.string().nullable(),
  legislator_name: z.string().nullable(),
  vote: z.string(),
});
const legislatorOfCodeRow = z.object({ legislator_id: z.string(), legislator_name: z.string() });
const sponsorRow = z.object({
  sponsor_id: z.number(),
  print_order: z.number(),
  level: z.enum(["chief", "regular"]),
  legislator_code: z.string(),
  legislator_id: z.string().nullable(),
  legislator_name: z.string().nullable(),
});

/** The Legislator a stored row names, or null while the row's code is unresolved. */
function legislatorOf(stored: { legislator_id: string | null; legislator_name: string | null }): Legislator | null {
  if (stored.legislator_id === null || stored.legislator_name === null) return null;
  return { id: stored.legislator_id as LegislatorId, name: stored.legislator_name };
}

/** A stored vote entry, as the server shows it. */
function legislatorVoteOf(stored: z.infer<typeof floorVoteRow> | z.infer<typeof committeeVoteRow>): LegislatorVote {
  return { legislatorCode: stored.legislator_code, legislator: legislatorOf(stored), vote: stored.vote };
}
const snapshotRow = z.object({
  source: z.literal("executive-regulatory-frameworks"),
  commit_sha: z.string(),
  commit_date: z.string(),
});
const documentRow = z.object({
  id: z.string(),
  node_id: z.string(),
  kind: z.string(),
  label: z.string(),
  source_url: z.string(),
  retrieved_at: z.string(),
  content_hash: z.string(),
  page_count: z.number(),
  has_text_layer: z.number(),
  posted_at: z.string().nullable(),
  text: z.string(),
});
const analysisRow = z.object({
  id: z.string(),
  label: z.string(),
  source_url: z.string(),
  analysis_version_label: z.string(),
  analysis_is_minority: z.number(),
});
const committeeRow = z.object({ code: z.string(), id: z.string(), name: z.string() });
const meetingRow = z.object({
  id: z.string(),
  committee_id: z.string(),
  committee_code: z.string(),
  committee_name: z.string(),
  at: z.string(),
  status: z.string(),
});
const agendaItemRow = z.object({
  id: z.number(),
  meeting_id: z.string(),
  session_key: z.string(),
  measure_prefix: z.string().nullable(),
  measure_number: z.number().nullable(),
  meeting_type: z.string().nullable(),
  action: z.string().nullable(),
  print_order: z.string().nullable(),
  comments: z.string().nullable(),
  board_name: z.string().nullable(),
  executive_appointee: z.string().nullable(),
});
const meetingDocumentRow = z.object({
  id: z.string(),
  node_id: z.string(),
  kind: z.string(),
  label: z.string(),
  source_url: z.string(),
  title: z.string().nullable(),
  measure_id: z.string().nullable(),
  meaning: z.string().nullable(),
  fetched: z.number(),
});
const testimonyRow = z.object({
  id: z.string(),
  comm_test_id: z.number(),
  source_url: z.string(),
  document_description: z.string(),
  position_id: z.number(),
  submitter: z.string(),
  behalf_of: z.string().nullable(),
  organization: z.string().nullable(),
  committee_id: z.string(),
  committee_code: z.string(),
  meeting_at: z.string(),
  agency_id: z.string().nullable(),
  fetched: z.number(),
  has_text_layer: z.number().nullable(),
  text_hash: z.string().nullable(),
});
const postingRow = z.object({
  document_id: z.string(),
  label: z.string(),
  source_url: z.string(),
  measure_id: z.string(),
  meaning: z.string().nullable(),
  meeting_id: z.string(),
  meeting_at: z.string(),
  committee_code: z.string(),
  committee_name: z.string(),
  fetched: z.number(),
  content_hash: z.string().nullable(),
});
const versionRow = z.object({ id: z.string(), label: z.string(), source_url: z.string(), content_hash: z.string() });
const parseRow = z.object({
  text_read: z.number(),
  amended_version_header: z.string().nullable(),
  relating_clause_edits: z.string(),
});
const linkRow = z.object({
  kind: z.enum(["amends", "repeals", "adds-to", "cites"]),
  target_type: z.enum(["section", "chapter"]),
  target_id: z.string(),
  measure_section: z.string().nullable(),
});
const orsSectionId = z.string().transform((text, context) => {
  const id = parseOrsSectionId(text);
  if (id === undefined) context.addIssue({ code: "custom", message: `not an ORS section id: ${text}` });
  return id ?? z.NEVER;
});
const relatingClauseEdits = z.array(
  z.object({
    deleted: z.string().nullable(),
    deletedLines: z.array(z.string()),
    inserted: z.string().nullable(),
    insertedSections: z.array(orsSectionId),
  }),
);
const countRow = z.object({ n: z.number() });
const kindCountRow = z.object({ kind: z.string(), n: z.number() });
const relationRow = z.object({
  relation: z.string(),
  to_id: z.string(),
  meaning: z.string().nullable(),
});

export function openIndexReader(path: string): IndexReader {
  const database = openReadConnection(path);
  const selectMeasure = database.prepare(
    "SELECT catchline, location, committee_code, digest, created_at, modified_at FROM measure WHERE session_key = ? AND prefix = ? AND number = ?",
  );
  const selectSponsors = database.prepare(
    `SELECT sponsor.sponsor_id, sponsor.print_order, sponsor.level, sponsor.legislator_code,
            sponsor.legislator_id, legislator.name AS legislator_name
     FROM sponsor LEFT JOIN legislator
       ON legislator.session_key = sponsor.session_key AND legislator.id = sponsor.legislator_id
     WHERE sponsor.session_key = ? AND sponsor.prefix = ? AND sponsor.number = ? AND sponsor.kind = 'member'`,
  );
  const selectCommittees = database.prepare(
    `SELECT committee_code AS text FROM sponsor
     WHERE session_key = ? AND prefix = ? AND number = ? AND kind = 'committee'
     ORDER BY print_order, sponsor_id`,
  );
  const selectPresessionMessages = database.prepare(
    `SELECT presession_message AS text FROM sponsor
     WHERE session_key = ? AND prefix = ? AND number = ? AND kind = 'presession'
     ORDER BY print_order, sponsor_id`,
  );
  const selectHistory = database.prepare(
    `SELECT history_id, chamber, action_date, action_text FROM history_action
     WHERE session_key = ? AND prefix = ? AND number = ? ORDER BY action_date, history_id`,
  );
  const selectFloorVotes = database.prepare(
    `SELECT floor_vote.history_id, floor_vote.chamber, floor_vote.action_date, floor_vote.action_text,
            floor_vote.legislator_code, floor_vote.legislator_id, legislator.name AS legislator_name, floor_vote.vote
     FROM floor_vote LEFT JOIN legislator
       ON legislator.session_key = floor_vote.session_key AND legislator.id = floor_vote.legislator_id
     WHERE floor_vote.session_key = ? AND floor_vote.prefix = ? AND floor_vote.number = ?
     ORDER BY floor_vote.action_date, floor_vote.history_id, floor_vote.vote_id`,
  );
  const selectCommitteeVotes = database.prepare(
    `SELECT committee_vote.report_id, committee_vote.committee_code, committee_vote.meeting_date,
            committee_vote.legislator_code, committee_vote.legislator_id, legislator.name AS legislator_name,
            committee_vote.vote
     FROM committee_vote LEFT JOIN legislator
       ON legislator.session_key = committee_vote.session_key AND legislator.id = committee_vote.legislator_id
     WHERE committee_vote.session_key = ? AND committee_vote.prefix = ? AND committee_vote.number = ?
     ORDER BY committee_vote.meeting_date, committee_vote.report_id, committee_vote.vote_id`,
  );
  const selectLegislatorOfCode = database.prepare(
    `SELECT legislator.id AS legislator_id, legislator.name AS legislator_name
     FROM legislator_code JOIN legislator
       ON legislator.session_key = legislator_code.session_key AND legislator.id = legislator_code.legislator_id
     WHERE legislator_code.session_key = ? AND legislator_code.code = ?`,
  );
  const selectAsOf = database.prepare("SELECT full_pull_as_of FROM index_state WHERE session_key = ?");
  const selectSnapshot = database.prepare(
    "SELECT source, commit_sha, commit_date FROM snapshot_state WHERE session_key = ?",
  );
  const countOf = (sql: string, session: SessionKey): number => countRow.parse(database.prepare(sql).get(session)).n;
  const selectKindCounts = database.prepare(
    "SELECT kind, COUNT(*) AS n FROM document WHERE session_key = ? GROUP BY kind",
  );
  const selectDocument = database.prepare("SELECT * FROM document WHERE id = ?");
  const selectPostings = database.prepare(
    "SELECT * FROM document WHERE node_id = ? AND node_id <> id ORDER BY posted_at DESC, id DESC",
  );
  const selectRelations = database.prepare(
    "SELECT relation, to_id, meaning FROM document_relation WHERE document_id = ? ORDER BY rowid",
  );
  const selectAnalyses = database.prepare(
    `SELECT d.id, d.label, d.source_url, d.analysis_version_label, d.analysis_is_minority
       FROM document d JOIN document_relation r ON r.document_id = d.id
      WHERE d.kind = 'analysis' AND r.relation = 'measure' AND r.to_id = ?
      ORDER BY d.id`,
  );
  const countNotHeld = database.prepare(
    `SELECT COUNT(*) AS n
       FROM analysis_listing l LEFT JOIN document d ON d.id = l.document_id
      WHERE l.measure_id = ? AND d.id IS NULL`,
  );
  const selectCommittee = database.prepare(
    "SELECT code, id, name FROM committee WHERE session_key = ? AND (upper(code) = upper(?) OR id = lower(?))",
  );
  const selectMeetings = database.prepare(
    `SELECT m.id, m.committee_id, m.committee_code, c.name AS committee_name, m.at, m.status
     FROM meeting m JOIN committee c ON c.session_key = m.session_key AND c.code = m.committee_code
     WHERE m.session_key = ?
       AND (? IS NULL OR EXISTS (SELECT 1 FROM agenda_item a
                                 WHERE a.meeting_id = m.id AND a.measure_prefix = ? AND a.measure_number = ?))
       AND (? IS NULL OR m.committee_code = ?)
       AND (? IS NULL OR substr(m.at, 1, 10) >= ?)
       AND (? IS NULL OR substr(m.at, 1, 10) <= ?)
     ORDER BY m.at, m.committee_code`,
  );
  const selectAgendaItems = database.prepare(
    "SELECT * FROM agenda_item WHERE meeting_id = ? ORDER BY print_order IS NULL, CAST(print_order AS INTEGER), id",
  );
  // What the feed lists for a meeting, and whether the document table holds each file yet.
  const selectMeetingDocuments = database.prepare(
    `SELECT l.document_id AS id, l.node_id, l.kind, l.label, l.source_url, l.title, l.measure_id, l.meaning,
            EXISTS (SELECT 1 FROM document d WHERE d.id = l.document_id) AS fetched
     FROM meeting_document l WHERE l.meeting_id = ?`,
  );
  // The Testimony the feed lists for a Measure, and whether the document table holds each file yet.
  const selectTestimony = database.prepare(
    `SELECT t.document_id AS id, t.comm_test_id, t.source_url, t.document_description, t.position_id, t.submitter,
            t.behalf_of, t.organization, t.committee_id, t.committee_code, t.meeting_at, t.agency_id,
            d.id IS NOT NULL AS fetched, d.has_text_layer, d.text_hash
     FROM testimony t LEFT JOIN document d ON d.id = t.document_id
     WHERE t.measure_id = ? ORDER BY t.comm_test_id`,
  );
  const selectTestimonyListing = database.prepare("SELECT 1 AS listed FROM testimony WHERE document_id = ?");
  // The postings the feed lists for one Proposed Amendment, with the meeting each was posted to.
  const selectPostingsOfAmendment = database.prepare(
    `SELECT l.document_id, l.label, l.source_url, l.measure_id, l.meaning, l.meeting_id, m.at AS meeting_at,
            m.committee_code, c.name AS committee_name,
            d.id IS NOT NULL AS fetched, d.content_hash
     FROM meeting_document l
     JOIN meeting m ON m.id = l.meeting_id
     JOIN committee c ON c.session_key = m.session_key AND c.code = m.committee_code
     LEFT JOIN document d ON d.id = l.document_id
     WHERE l.kind = 'proposed_amendment' AND l.node_id = ?
     ORDER BY m.at`,
  );
  const selectVersionsOfMeasure = database.prepare(
    `SELECT d.id, d.label, d.source_url, d.content_hash
     FROM document d JOIN document_relation r ON r.document_id = d.id
     WHERE d.kind = 'version' AND r.relation = 'measure' AND r.to_id = ?`,
  );
  const selectStatuteParse = database.prepare(
    "SELECT text_read, amended_version_header, relating_clause_edits FROM statute_parse WHERE content_hash = ? AND parsed_as = ?",
  );
  const selectStatuteLinks = database.prepare(
    "SELECT kind, target_type, target_id, measure_section FROM statute_link WHERE content_hash = ? AND parsed_as = ? ORDER BY ordinal",
  );
  const numbersInOrder = new Intl.Collator("en", { numeric: true });
  function documentOf(row: unknown): DocumentView["document"] {
    const stored = documentRow.parse(row);
    return {
      id: stored.id as DocumentId,
      nodeId: stored.node_id as DocumentId | AmendmentId,
      kind: stored.kind as DocumentKind,
      label: stored.label,
      sourceUrl: stored.source_url,
      retrievedAt: stored.retrieved_at as Timestamp,
      contentHash: stored.content_hash,
      pageCount: stored.page_count,
      hasTextLayer: stored.has_text_layer === 1,
      postedAt: stored.posted_at as Timestamp | null,
      text: stored.text,
    };
  }
  /**
   * What was read of a file for Statute Links. A file the worker has not read yet (a pull that stopped between
   * storing it and reading it) is shown as not read, with no links.
   */
  function statuteParseOf(contentHash: string, readAs: StatuteLinkSource): StatuteParse {
    const row = selectStatuteParse.get(contentHash, readAs);
    if (row === undefined) return { textRead: false, amendedVersionHeader: null, links: [], relatingClauseEdits: [] };
    const stored = parseRow.parse(row);
    const links = selectStatuteLinks.all(contentHash, readAs).map((linkRowOf): StatuteLink => {
      const link = linkRow.parse(linkRowOf);
      if (link.target_type === "section") {
        const id = parseOrsSectionId(link.target_id);
        if (id === undefined)
          throw new Error(`The store holds a Statute Link to ${link.target_id}, which is no ORS section id`);
        return {
          kind: link.kind,
          target: { type: "section", id, resolvableOnOregonAi: true },
          measureSection: link.measure_section,
        };
      }
      const id = parseOrsChapterId(link.target_id);
      if (id === undefined)
        throw new Error(`The store holds a Statute Link to ${link.target_id}, which is no ORS chapter id`);
      return {
        kind: link.kind,
        target: { type: "chapter", id, resolvableOnOregonAi: false },
        measureSection: link.measure_section,
      };
    });
    const edits: RelatingClauseEdit[] = relatingClauseEdits.parse(JSON.parse(stored.relating_clause_edits));
    return {
      textRead: stored.text_read === 1,
      amendedVersionHeader: stored.amended_version_header,
      links,
      relatingClauseEdits: edits,
    };
  }
  function relationsOf(documentId: DocumentId): RelatedNode[] {
    return selectRelations.all(documentId).map((row) => {
      const stored = relationRow.parse(row);
      return { relation: stored.relation as Relation, to: stored.to_id as NodeId, meaning: stored.meaning, documentId };
    });
  }
  return {
    analysisDocuments(key) {
      return selectAnalyses.all(measureIdOf(key)).map((row) => {
        const stored = analysisRow.parse(row);
        const id = stored.id as DocumentId;
        const related = relationsOf(id);
        return {
          id,
          type: stored.label,
          versionLabel: stored.analysis_version_label,
          isMinority: stored.analysis_is_minority === 1,
          sourceUrl: stored.source_url,
          committeeId: (related.find((node) => node.relation === "committee")?.to as CommitteeId | undefined) ?? null,
          placedVersionId: (related.find((node) => node.relation === "version")?.to as DocumentId | undefined) ?? null,
        };
      });
    },
    analysisNotHeld(key) {
      return countRow.parse(countNotHeld.get(measureIdOf(key))).n;
    },
    counts(session) {
      const documentsByKind = Object.fromEntries(documentKinds.map((kind) => [kind, 0])) as Record<
        DocumentKind,
        number
      >;
      for (const row of selectKindCounts.all(session)) {
        const counted = kindCountRow.parse(row);
        documentsByKind[counted.kind as DocumentKind] = counted.n;
      }
      return {
        measures: countOf("SELECT COUNT(*) AS n FROM measure WHERE session_key = ?", session),
        committees: countOf("SELECT COUNT(*) AS n FROM committee WHERE session_key = ?", session),
        meetings: countOf("SELECT COUNT(*) AS n FROM meeting WHERE session_key = ?", session),
        proposedAmendments: countOf(
          "SELECT COUNT(DISTINCT node_id) AS n FROM document WHERE session_key = ? AND kind = 'proposed_amendment'",
          session,
        ),
        documents: countOf("SELECT COUNT(*) AS n FROM document WHERE session_key = ?", session),
        documentsWithoutTextLayer: countOf(
          "SELECT COUNT(*) AS n FROM document WHERE session_key = ? AND has_text_layer = 0",
          session,
        ),
        documentsByKind,
      };
    },
    findDocument(id) {
      const own = selectDocument.get(id);
      if (own !== undefined) {
        const document = documentOf(own);
        return { document, related: relationsOf(document.id) };
      }
      // Not a document: a Proposed Amendment, which has a posting (and a file) for each meeting.
      const postings = selectPostings.all(id).map(documentOf);
      const latest = postings[0];
      if (latest === undefined) return undefined;
      const related: RelatedNode[] = [];
      const seen = new Set<string>();
      for (const posting of postings.toReversed()) {
        for (const node of relationsOf(posting.id)) {
          if (node.relation === "amendment") continue;
          // A posting is told apart by its meeting; every other relation is the same for each posting.
          const key = `${node.relation} ${node.to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          related.push(node);
        }
      }
      return { document: latest, related };
    },
    findAmendment(id) {
      const rows = selectPostingsOfAmendment.all(id).map((row) => postingRow.parse(row));
      const first = rows[0];
      if (first === undefined) return undefined;
      const listed = rows.map((stored) => ({
        contentHash: stored.content_hash,
        posting: {
          documentId: stored.document_id as DocumentId,
          sourceUrl: stored.source_url,
          meetingId: stored.meeting_id as MeetingId,
          meetingAt: stored.meeting_at as Timestamp,
          committeeCode: stored.committee_code,
          committeeName: stored.committee_name,
          meaning: stored.meaning,
          fetched: stored.fetched === 1,
        } satisfies AmendmentPosting,
      }));
      // The same meeting's postings are told apart by the feed's number, compared as a number.
      listed.sort(
        (a, b) =>
          a.posting.meetingAt.localeCompare(b.posting.meetingAt) ||
          numbersInOrder.compare(a.posting.documentId, b.posting.documentId),
      );
      // Postings that share a file (the same bytes) are one file with several postings.
      const files = new Map<string, AmendmentFile>();
      for (const { contentHash, posting } of listed) {
        if (contentHash === null) continue;
        const file = files.get(contentHash) ?? {
          postingIds: [],
          parse: statuteParseOf(contentHash, "proposed_amendment"),
        };
        file.postingIds.push(posting.documentId);
        files.set(contentHash, file);
      }
      return {
        id,
        number: first.label,
        measureId: first.measure_id as MeasureId,
        postings: listed.map(({ posting }) => posting),
        files: [...files.values()],
      };
    },
    findMeasureVersions(key) {
      return selectVersionsOfMeasure.all(measureIdOf(key)).map((row): StoredVersion => {
        const stored = versionRow.parse(row);
        return {
          id: stored.id as DocumentId,
          label: stored.label,
          sourceUrl: stored.source_url,
          parse: statuteParseOf(stored.content_hash, "version"),
        };
      });
    },
    findCommittee(session, reference) {
      const row = selectCommittee.get(session, reference.trim(), reference.trim());
      if (row === undefined) return undefined;
      const stored = committeeRow.parse(row);
      return { session, code: stored.code, id: stored.id as CommitteeId, name: stored.name };
    },
    findMeetings(session, filter) {
      const measure = filter.measure;
      const committeeCode = filter.committeeCode ?? null;
      const from = filter.from ?? null;
      const to = filter.to ?? null;
      return selectMeetings
        .all(
          session,
          measure?.prefix ?? null,
          measure?.prefix ?? null,
          measure?.number ?? null,
          committeeCode,
          committeeCode,
          from,
          from,
          to,
          to,
        )
        .map((row) => {
          const stored = meetingRow.parse(row);
          return {
            id: stored.id as MeetingId,
            committee: {
              id: stored.committee_id as CommitteeId,
              code: stored.committee_code,
              name: stored.committee_name,
            },
            at: stored.at as Timestamp,
            status: stored.status,
          };
        });
    },
    meetingContents(meeting) {
      const agendaItems = selectAgendaItems.all(meeting).map((row): AgendaItem => {
        const stored = agendaItemRow.parse(row);
        return {
          itemId: stored.id,
          meetingId: stored.meeting_id as MeetingId,
          measure:
            stored.measure_prefix === null || stored.measure_number === null
              ? null
              : {
                  session: stored.session_key as SessionKey,
                  prefix: stored.measure_prefix,
                  number: stored.measure_number,
                },
          meetingType: stored.meeting_type,
          action: stored.action,
          printOrder: stored.print_order,
          comments: stored.comments,
          boardName: stored.board_name,
          executiveAppointee: stored.executive_appointee,
        };
      });
      const listed = selectMeetingDocuments.all(meeting).map((row) => meetingDocumentRow.parse(row));
      const documentsOfKind = (kind: DocumentKind): MeetingDocument[] =>
        listed
          .filter((stored) => stored.kind === kind)
          .map((stored) => ({
            id: stored.id as DocumentId,
            label: stored.label,
            sourceUrl: stored.source_url,
            measureId: stored.measure_id as MeasureId | null,
            title: stored.title,
            fetched: stored.fetched === 1,
          }))
          .sort((a, b) => numbersInOrder.compare(a.id, b.id));
      const amendments = listed
        .filter((stored) => stored.kind === "proposed_amendment")
        .map((stored): PostedAmendment => {
          if (stored.measure_id === null) throw new Error(`The posting ${stored.id} is listed with no Measure`);
          return {
            id: stored.node_id as AmendmentId,
            number: stored.label,
            measureId: stored.measure_id as MeasureId,
            meaning: stored.meaning,
            documentId: stored.id as DocumentId,
            sourceUrl: stored.source_url,
            fetched: stored.fetched === 1,
          };
        });
      amendments.sort(
        (a, b) =>
          numbersInOrder.compare(a.measureId, b.measureId) ||
          numbersInOrder.compare(a.number, b.number) ||
          numbersInOrder.compare(a.documentId, b.documentId),
      );
      return {
        agenda: documentsOfKind("agenda")[0] ?? null,
        agendaItems,
        amendments,
        exhibits: documentsOfKind("exhibit"),
        recordingLogs: documentsOfKind("recording_log"),
      };
    },
    listsTestimony(id) {
      return selectTestimonyListing.get(id) !== undefined;
    },
    findTestimony(key) {
      return selectTestimony.all(measureIdOf(key)).map((row): TestimonyEntry => {
        const stored = testimonyRow.parse(row);
        return {
          id: stored.id as DocumentId,
          commTestId: stored.comm_test_id,
          sourceUrl: stored.source_url,
          documentDescription: stored.document_description,
          position: positionOf(stored.position_id),
          submitter: stored.submitter,
          behalfOf: stored.behalf_of,
          organization: stored.organization,
          committeeId: stored.committee_id as CommitteeId,
          committeeCode: stored.committee_code,
          meetingAt: stored.meeting_at as Timestamp,
          agencyId: stored.agency_id as AgencyId | null,
          fetched: stored.fetched === 1,
          hasTextLayer: stored.has_text_layer === null ? null : stored.has_text_layer === 1,
          textHash: stored.text_hash,
        };
      });
    },
    findMeasure(key) {
      const row = selectMeasure.get(key.session, key.prefix, key.number);
      if (row === undefined) return undefined;
      const stored = measureRow.parse(row);
      return {
        ...key,
        catchline: stored.catchline,
        location: { current: stored.location, committeeCode: stored.committee_code },
        digest: stored.digest,
        createdAt: stored.created_at as Timestamp,
        modifiedAt: stored.modified_at as Timestamp | null,
      };
    },
    findSponsors(key) {
      const sponsors = selectSponsors.all(key.session, key.prefix, key.number).map((row) => {
        const stored = sponsorRow.parse(row);
        return {
          printOrder: stored.print_order,
          sponsorId: stored.sponsor_id,
          level: stored.level,
          legislatorCode: stored.legislator_code,
          legislatorId: stored.legislator_id as LegislatorId | null,
          legislator: legislatorOf(stored),
        };
      });
      return sponsors.sort(comparePrintOrder(key.prefix)).map((sponsor) => ({
        level: sponsor.level,
        legislatorCode: sponsor.legislatorCode,
        legislator: sponsor.legislator,
      }));
    },
    findCommitteeSponsors(key) {
      return selectCommittees.all(key.session, key.prefix, key.number).map((row) => textRow.parse(row).text);
    },
    findPresessionMessages(key) {
      return selectPresessionMessages.all(key.session, key.prefix, key.number).map((row) => textRow.parse(row).text);
    },
    findHistory(key) {
      return selectHistory.all(key.session, key.prefix, key.number).map((row) => {
        const stored = historyRow.parse(row);
        return {
          id: stored.history_id,
          measure: key,
          chamber: stored.chamber,
          date: stored.action_date as Timestamp,
          text: stored.action_text,
        };
      });
    },
    findFloorVotes(key) {
      const rows = selectFloorVotes.all(key.session, key.prefix, key.number).map((row) => floorVoteRow.parse(row));
      // The rows come ordered by time and history id, so the rows of a history id are one floor vote.
      return groupFloorVotes(
        rows.map((stored) => ({
          historyId: stored.history_id,
          chamber: stored.chamber,
          date: stored.action_date as Timestamp,
          action: stored.action_text,
          cast: legislatorVoteOf(stored),
        })),
      );
    },
    findCommitteeVotes(key) {
      const rows = selectCommitteeVotes
        .all(key.session, key.prefix, key.number)
        .map((row) => committeeVoteRow.parse(row));
      // The rows come ordered by meeting and report, so the rows of a report id are one roll.
      return groupCommitteeVotes(
        rows.map((stored) => ({
          reportId: stored.report_id,
          committeeCode: stored.committee_code,
          meetingDate: stored.meeting_date as Timestamp,
          cast: legislatorVoteOf(stored),
        })),
      );
    },
    findLegislatorOfCode(session, code) {
      const row = selectLegislatorOfCode.get(session, code);
      if (row === undefined) return undefined;
      const stored = legislatorOfCodeRow.parse(row);
      return { id: stored.legislator_id as LegislatorId, name: stored.legislator_name };
    },
    asOf(session) {
      const row = selectAsOf.get(session);
      return row === undefined ? undefined : (stateRow.parse(row).full_pull_as_of as Timestamp);
    },
    snapshotVersion(session) {
      const row = selectSnapshot.get(session);
      if (row === undefined) return undefined;
      const stored = snapshotRow.parse(row);
      return { source: stored.source, commit: stored.commit_sha, commitDate: stored.commit_date as Timestamp };
    },
    close() {
      database.close();
    },
  };
}
