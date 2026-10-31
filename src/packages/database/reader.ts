// The MCP server's side of the database: read-only.
import { z } from "zod";
import {
  agencyLinkKey,
  listedLinkKeys,
  type AgencyEvidence,
  type LinkedNode,
  type StoredAgencyLink,
  type StoredStatuteLinked,
  type StoredUnresolvedUnit,
} from "#/packages/domain/agency-links.ts";
import type { StoredAnalysis } from "#/packages/domain/analysis.ts";
import {
  documentKinds,
  positionOf,
  type AmendmentId,
  type AmendmentPosting,
  type Committee,
  type DocumentId,
  type DocumentKind,
  type DocumentView,
  type IndexCounts,
  type Listing,
  type ListedAgendaItem,
  type AmendmentHeader,
  type CommitteeId,
  type MeetingContents,
  type MeetingDocument,
  type MeetingHeader,
  type MeetingId,
  type NodeId,
  type PostedAmendment,
  type PulledEntitySet,
  type Relation,
  type RelatedNode,
  type TestimonyEntry,
} from "#/packages/domain/documents.ts";
import {
  measureIdOf,
  olisPageUrlOf,
  parseMeasureReference,
  type HistoryAction,
  type Measure,
  type MeasureId,
  type MeasureKey,
  type SessionKey,
} from "#/packages/domain/index.ts";
import { comparePrintOrder, type Legislator, type LegislatorId, type Sponsor } from "#/packages/domain/legislators.ts";
import {
  orsSectionIdRangeOf,
  parseOrsSectionId,
  type AgencyId,
  type OrsChapterId,
  type OrsSectionId,
  type SnapshotVersion,
} from "#/packages/domain/oregonai.ts";
import {
  unreadStatuteParse,
  type AmendmentFile,
  type RelatingClauseEdit,
  type StatuteLinkSource,
  type StatuteParse,
  type StatutesAffectedEntry,
  type StatutesAffectedTableOfMeasure,
  type StoredAmendment,
  type StoredVersion,
  tableActions,
} from "#/packages/domain/statute-links.ts";
import {
  groupCommitteeVotes,
  groupFloorVotes,
  type CommitteeVote,
  type FloorVote,
  type LegislatorVote,
} from "#/packages/domain/votes.ts";
import { compareTimestamps, type Timestamp } from "#/packages/time/pacific.ts";
import { evidenceFromJson, storedEvidenceKinds } from "./lib/agency-evidence.ts";
import { openReadConnection } from "./lib/connection.ts";
import { listedOrUnchecked } from "./lib/listing.ts";
import { statuteLinkOfRow, statuteLinkRow, storedTargetOf } from "./lib/statute-link-rows.ts";

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
  /** When the last complete full pull started, or undefined while there has been none. */
  lastFullPull(session: SessionKey): Timestamp | undefined;
  /** When the last increment started, or undefined while there has been none (ticket #17, ADR-0039). */
  lastIncrement(session: SessionKey): Timestamp | undefined;
  /** The Pacific dates (YYYY-MM-DD) of the Session's committee meetings the index holds: days the Session meets. */
  meetingDays(session: SessionKey): string[];
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
  /** Every Proposed Amendment the feed lists for a Measure, as `findAmendment` gives it, ordered by number ("-1", "-2", "-A3"). */
  findMeasureAmendments(key: MeasureKey): StoredAmendment[];
  /** The Versions of a Measure the store holds (not its Printed Amendments), in no particular order, each with what was read of its text. */
  findMeasureVersions(key: MeasureKey): StoredVersion[];
  /**
   * Legislative Counsel's Statutes Affected Table, for one Measure: where it came from, when the index retrieved it, the
   * entries it has for the Measure (none when it lists none), and the Versions the feed lists for the Measure, which say
   * what an entry that ends in an E alone is. Undefined while the index holds no table, which is when the deployment does
   * not load it or it is not published yet.
   */
  statutesAffectedTableOf(key: MeasureKey): StatutesAffectedTableOfMeasure | undefined;
  /**
   * The Agency Links the store holds, of one Agency or of one Measure's nodes: those read at ingest from
   * Fiscal Impact Statements, Versions and Proposed Amendments, and Testimony's. Each says the document its evidence was
   * read from and the node it sits on (ADR-0027). In no particular order.
   */
  findAgencyLinks(session: SessionKey, of: { agency: AgencyId } | { measure: MeasureKey }): StoredAgencyLink[];
  /**
   * The Versions and Proposed Amendments the store has read a Statute Link to an ORS section from, or to an ORS chapter or
   * any section in it, with each link (a Proposed Amendment posted again is a link for each posting). A Proposed
   * Amendment's links are all here, replaced by a later Version or not. In no particular order.
   */
  findStatuteLinked(
    session: SessionKey,
    target: { section: OrsSectionId } | { chapter: OrsChapterId },
  ): StoredStatuteLinked[];
  /** The Measures with an Agency Link of any evidence to the Agency: through a Version, a Proposed Amendment, a statement or Testimony. */
  measuresWithAgencyLink(session: SessionKey, agency: AgencyId): MeasureId[];
  /** The units a Measure's Fiscal Impact Statements list that are not Agencies, as each statement writes them. */
  findUnresolvedUnits(measure: MeasureKey): StoredUnresolvedUnit[];
  /** The parent of each Agency that has one, from the snapshot the last full pull built with (ADR-0029). */
  agencyParents(): ReadonlyMap<AgencyId, AgencyId>;
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
   * Whether the feed lists a Testimony with this id, whether or not its file is fetched, and when it last did;
   * undefined when the index holds no Testimony row with this id. A Testimony that is listed and whose file the store lacks is one
   * `findDocument` does not resolve yet: the next pull fetches it. One that is no longer listed is not fetched by
   * any pull, and the store holds the file only if it fetched it while the feed listed it.
   */
  testimonyListing(id: DocumentId | AmendmentId): Listing | undefined;
  /**
   * When the feed no longer lists the row behind a document id or a Proposed Amendment id, the time it last did:
   * undefined when the feed lists it, or the index knows no such row. For an id `findDocument` does not resolve,
   * because no pull fetched the file while the feed listed it, and none will now.
   */
  findNoLongerListed(id: DocumentId | AmendmentId): Extract<Listing, { listed: false }> | undefined;
  /** Whether the feed still lists a Measure the index holds, and when it last did. */
  measureListing(key: MeasureKey): Listing;
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
const incrementStateRow = z.object({ as_of: z.string() });
const meetingDayRow = z.object({ day: z.string() });
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
  listed: z.number(),
});
const committeeRow = z.object({ code: z.string(), id: z.string(), name: z.string() });
const meetingRow = z.object({
  id: z.string(),
  committee_id: z.string(),
  committee_code: z.string(),
  committee_name: z.string(),
  at: z.string(),
  status: z.string(),
  listed: z.number(),
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
  listed: z.number(),
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
  listed: z.number(),
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
  listed: z.number(),
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
  listed: z.number(),
  content_hash: z.string().nullable(),
});
const versionRow = z.object({
  id: z.string(),
  label: z.string(),
  source_url: z.string(),
  content_hash: z.string(),
  listed: z.number(),
});
const parseRow = z.object({
  text_read: z.number(),
  amended_version_header: z.string().nullable(),
  header_measure_prefix: z.string().nullable(),
  header_measure_number: z.number().nullable(),
  relating_clause_edits: z.string(),
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
const tableRow = z.object({ source_url: z.string(), retrieved_at: z.string() });
const listedVersionRow = z.object({ label: z.string() });
const tableEntryRow = z.object({
  level: z.string().nullable(),
  action: z.enum(tableActions),
  target_type: z.enum(["section", "chapter"]),
  target_id: z.string(),
  measure_section: z.string(),
  emergency: z.number(),
  lone_e: z.number(),
});
const agencyLinkRow = z.object({
  agency_id: z.string(),
  link_kind: z.enum(storedEvidenceKinds),
  evidence: z.string(),
  document_id: z.string(),
  document_source_url: z.string(),
  document_label: z.string(),
  document_kind: z.enum(["version", "proposed_amendment", "analysis"]),
  node_id: z.string(),
  document_created_at: z.string().nullable(),
  measure_id: z.string(),
  version_id: z.string().nullable(),
  listed: z.number().nullable(),
  last_listed_at: z.string().nullable(),
});
const testimonyLinkRow = z.object({
  agency_id: z.string(),
  organization: z.string().nullable(),
  document_id: z.string(),
  document_source_url: z.string(),
  document_created_at: z.string().nullable(),
  measure_id: z.string(),
  listed: z.number().nullable(),
  last_listed_at: z.string().nullable(),
});
const statuteLinkedRow = statuteLinkRow.extend({
  document_id: z.string(),
  document_kind: z.enum(["version", "proposed_amendment"]),
  document_label: z.string(),
  document_source_url: z.string(),
  document_created_at: z.string().nullable(),
  node_id: z.string(),
  measure_id: z.string(),
});
const agencyParentRow = z.object({ agency_id: z.string(), parent_id: z.string() });
const unresolvedUnitRow = z.object({
  unit: z.string(),
  document_id: z.string(),
  document_source_url: z.string(),
  measure_id: z.string(),
  version_id: z.string().nullable(),
  listed: z.number().nullable(),
  last_listed_at: z.string().nullable(),
});
const versionNodeRow = z.object({ label: z.string(), source_url: z.string() });
const amendmentNumberRow = z.object({ label: z.string() });
const amendmentFileRow = z.object({ source_url: z.string() });
const countRow = z.object({ n: z.number() });
const kindCountRow = z.object({ kind: z.string(), n: z.number() });
const listingRow = z.object({ listed: z.number().nullable(), last_listed_at: z.string().nullable() });
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
  const selectIncrementAsOf = database.prepare("SELECT as_of FROM increment_state WHERE session_key = ?");
  const selectMeetingDays = database.prepare(
    "SELECT DISTINCT substr(at, 1, 10) AS day FROM meeting WHERE session_key = ? ORDER BY day",
  );
  const fullPullOf = (session: SessionKey): Timestamp | undefined => {
    const row = selectAsOf.get(session);
    return row === undefined ? undefined : (stateRow.parse(row).full_pull_as_of as Timestamp);
  };
  const incrementOf = (session: SessionKey): Timestamp | undefined => {
    const row = selectIncrementAsOf.get(session);
    return row === undefined ? undefined : (incrementStateRow.parse(row).as_of as Timestamp);
  };
  const selectSnapshot = database.prepare(
    "SELECT source, commit_sha, commit_date FROM snapshot_state WHERE session_key = ?",
  );
  const countOf = (sql: string, session: SessionKey): number => countRow.parse(database.prepare(sql).get(session)).n;
  const selectKindCounts = database.prepare(
    "SELECT kind, COUNT(*) AS n FROM document WHERE session_key = ? GROUP BY kind",
  );
  const selectDocument = database.prepare("SELECT * FROM document WHERE id = ?");
  // Whether the feed lists a document: its feed row's state (ADR-0030). For a Proposed Amendment the postings'
  // rows are looked at together, and the latest pull that listed any of them says.
  const selectDocumentListing = database.prepare(
    "SELECT listed, last_listed_at FROM feed_row_state WHERE document_id = ?",
  );
  // An amendment is listed while the feed lists any of its postings (ADR-0030), so the postings are the ones the feed
  // lists for it (meeting_document, written for every link before any file is fetched) and the ones the store holds,
  // whether or not a posting's file is stored. The posting listed most recently says: a listed one comes first.
  const selectPostingsListing = database.prepare(
    `SELECT ${listedOrUnchecked} AS listed, fr.last_listed_at
     FROM (SELECT document_id FROM meeting_document WHERE node_id = ?1 AND kind = 'proposed_amendment'
           UNION
           SELECT id FROM document WHERE node_id = ?1 AND node_id <> id) p
       LEFT JOIN feed_row_state fr ON fr.document_id = p.document_id
     ORDER BY ${listedOrUnchecked} DESC, fr.last_listed_pull DESC
     LIMIT 1`,
  );
  const selectPostings = database.prepare(
    "SELECT * FROM document WHERE node_id = ? AND node_id <> id ORDER BY posted_at DESC, id DESC",
  );
  const selectRelations = database.prepare(
    "SELECT relation, to_id, meaning FROM document_relation WHERE document_id = ? ORDER BY rowid",
  );
  const selectAnalyses = database.prepare(
    `SELECT d.id, d.label, d.source_url, d.analysis_version_label, d.analysis_is_minority, ${listedOrUnchecked} AS listed
       FROM document d
         JOIN document_relation r ON r.document_id = d.id
         LEFT JOIN feed_row_state fr ON fr.document_id = d.id
      WHERE d.kind = 'analysis' AND r.relation = 'measure' AND r.to_id = ?
      ORDER BY d.id`,
  );
  // The listed analysis documents the store does not hold. A row the feed has stopped listing (two complete pulls in
  // a row missed it) is not one the feed lists, so it is not counted; one pull that misses it changes nothing.
  const countNotHeld = database.prepare(
    `SELECT COUNT(*) AS n
       FROM analysis_listing l
         LEFT JOIN document d ON d.id = l.document_id
         LEFT JOIN feed_row_state fr ON fr.document_id = l.document_id
      WHERE l.measure_id = ? AND d.id IS NULL AND ${listedOrUnchecked} = 1`,
  );
  const selectCommittee = database.prepare(
    "SELECT code, id, name FROM committee WHERE session_key = ? AND (upper(code) = upper(?) OR id = lower(?))",
  );
  // The entity sets the listing of rows keys these by (ADR-0030): bound as parameters, from the one list of names.
  const measuresSet: PulledEntitySet = "Measures";
  const meetingsSet: PulledEntitySet = "CommitteeMeetings";
  const agendaItemsSet: PulledEntitySet = "CommitteeAgendaItems";
  const selectMeetings = database.prepare(
    `SELECT m.id, m.committee_id, m.committee_code, c.name AS committee_name, m.at, m.status, ${listedOrUnchecked} AS listed
     FROM meeting m
       JOIN committee c ON c.session_key = m.session_key AND c.code = m.committee_code
       LEFT JOIN feed_row_state fr ON fr.session_key = m.session_key AND fr.entity_set = ?
                                  AND fr.row_key = m.id
     WHERE m.session_key = ?
       AND (? IS NULL OR EXISTS (SELECT 1 FROM agenda_item a
                                 WHERE a.meeting_id = m.id AND a.measure_prefix = ? AND a.measure_number = ?))
       AND (? IS NULL OR m.committee_code = ?)
       AND (? IS NULL OR substr(m.at, 1, 10) >= ?)
       AND (? IS NULL OR substr(m.at, 1, 10) <= ?)
     ORDER BY m.at, m.committee_code`,
  );
  const selectAgendaItems = database.prepare(
    `SELECT a.*, ${listedOrUnchecked} AS listed
     FROM agenda_item a
       LEFT JOIN feed_row_state fr ON fr.session_key = a.session_key AND fr.entity_set = ?
                                  AND fr.row_key = CAST(a.id AS TEXT)
     WHERE a.meeting_id = ? ORDER BY a.print_order IS NULL, CAST(a.print_order AS INTEGER), a.id`,
  );
  // What the feed lists for a meeting, and whether the document table holds each file yet.
  const selectMeetingDocuments = database.prepare(
    `SELECT l.document_id AS id, l.node_id, l.kind, l.label, l.source_url, l.title, l.measure_id, l.meaning,
            EXISTS (SELECT 1 FROM document d WHERE d.id = l.document_id) AS fetched, ${listedOrUnchecked} AS listed
     FROM meeting_document l
       LEFT JOIN feed_row_state fr ON fr.document_id = l.document_id
     WHERE l.meeting_id = ?`,
  );
  // The Testimony the feed lists for a Measure, and whether the document table holds each file yet.
  const selectTestimony = database.prepare(
    `SELECT t.document_id AS id, t.comm_test_id, t.source_url, t.document_description, t.position_id, t.submitter,
            t.behalf_of, t.organization, t.committee_id, t.committee_code, t.meeting_at, t.agency_id,
            d.id IS NOT NULL AS fetched, ${listedOrUnchecked} AS listed, d.has_text_layer, d.text_hash
     FROM testimony t
       LEFT JOIN document d ON d.id = t.document_id
       LEFT JOIN feed_row_state fr ON fr.document_id = t.document_id
     WHERE t.measure_id = ? ORDER BY t.comm_test_id`,
  );
  const selectTestimonyListing = database.prepare(
    `SELECT fr.listed, fr.last_listed_at FROM testimony t
       LEFT JOIN feed_row_state fr ON fr.document_id = t.document_id
      WHERE t.document_id = ?`,
  );
  const selectMeasureListing = database.prepare(
    "SELECT listed, last_listed_at FROM feed_row_state WHERE session_key = ? AND entity_set = ? AND row_key = ?",
  );
  // The postings the feed lists for one Proposed Amendment, with the meeting each was posted to.
  const selectPostingsOfAmendment = database.prepare(
    `SELECT l.document_id, l.label, l.source_url, l.measure_id, l.meaning, l.meeting_id, m.at AS meeting_at,
            m.committee_code, c.name AS committee_name,
            d.id IS NOT NULL AS fetched, ${listedOrUnchecked} AS listed, d.content_hash
     FROM meeting_document l
     JOIN meeting m ON m.id = l.meeting_id
     JOIN committee c ON c.session_key = m.session_key AND c.code = m.committee_code
     LEFT JOIN document d ON d.id = l.document_id
     LEFT JOIN feed_row_state fr ON fr.document_id = l.document_id
     WHERE l.kind = 'proposed_amendment' AND l.node_id = ?
     ORDER BY m.at`,
  );
  const selectAmendmentsOfMeasure = database.prepare(
    "SELECT DISTINCT node_id FROM meeting_document WHERE kind = 'proposed_amendment' AND measure_id = ?",
  );
  const selectVersionsOfMeasure = database.prepare(
    `SELECT d.id, d.label, d.source_url, d.content_hash, ${listedOrUnchecked} AS listed
     FROM document d
       JOIN document_relation r ON r.document_id = d.id
       LEFT JOIN feed_row_state fr ON fr.document_id = d.id
     WHERE d.kind = 'version' AND r.relation = 'measure' AND r.to_id = ?`,
  );
  const selectStatuteParse = database.prepare(
    "SELECT text_read, amended_version_header, header_measure_prefix, header_measure_number, relating_clause_edits FROM statute_parse WHERE content_hash = ? AND parsed_as = ?",
  );
  const selectStatuteLinks = database.prepare(
    "SELECT kind, target_type, target_id, measure_section FROM statute_link WHERE content_hash = ? AND parsed_as = ? ORDER BY ordinal",
  );
  const selectListedVersions = database.prepare(
    "SELECT DISTINCT label FROM version_listing WHERE measure_id = ? ORDER BY label",
  );
  const selectTable = database.prepare(
    "SELECT source_url, retrieved_at FROM statutes_affected_table WHERE session_key = ?",
  );
  const selectTableEntries = database.prepare(
    `SELECT level, action, target_type, target_id, measure_section, emergency, lone_e FROM statutes_affected_entry
     WHERE session_key = ? AND prefix = ? AND number = ? ORDER BY ordinal`,
  );
  // The stored Agency Links of one Agency or of one Measure, with the document each was read from and the Measure
  // that document belongs to. An analysis document also gives the Version the feed places it on (ADR-0013), if any.
  // One statement for each, so that SQLite uses the index of the one asked about.
  const agencyLinksWhere = (condition: string): string =>
    `SELECT a.agency_id, a.kind AS link_kind, a.evidence, d.id AS document_id, d.source_url AS document_source_url,
            d.label AS document_label, d.kind AS document_kind, d.node_id, dc.created_at AS document_created_at,
            mr.to_id AS measure_id, vr.to_id AS version_id, fr.listed, fr.last_listed_at
     FROM agency_link a
       JOIN document d ON d.id = a.document_id
       JOIN document_relation mr ON mr.document_id = d.id AND mr.relation = 'measure'
       LEFT JOIN document_relation vr ON vr.document_id = d.id AND vr.relation = 'version'
       LEFT JOIN document_created dc ON dc.document_id = d.id
       LEFT JOIN feed_row_state fr ON fr.document_id = d.id
     WHERE d.session_key = ?1 AND ${condition}
     ORDER BY a.agency_id, d.id, a.ordinal`;
  const selectAgencyLinksOfAgency = database.prepare(agencyLinksWhere("a.agency_id = ?2"));
  const selectAgencyLinksOfMeasure = database.prepare(agencyLinksWhere("mr.to_id = ?2"));
  // The files with a Statute Link to a section or a chapter (`target_id = ?2`), or to a section of a chapter: its ids
  // from "ors-657b." up to "ors-657b/", the character after the dot, so chapter 657 does not take 657B's sections.
  const statuteLinkedWhere = (condition: string): string =>
    `SELECT d.id AS document_id, d.kind AS document_kind, d.label AS document_label, d.source_url AS document_source_url,
            d.node_id, dc.created_at AS document_created_at, mr.to_id AS measure_id,
            l.kind, l.target_type, l.target_id, l.measure_section
     FROM statute_link l INDEXED BY statute_link_target
       JOIN document d ON d.content_hash = l.content_hash AND d.kind = l.parsed_as
       JOIN document_relation mr ON mr.document_id = d.id AND mr.relation = 'measure'
       LEFT JOIN document_created dc ON dc.document_id = d.id
     WHERE d.session_key = ?1 AND ${condition}
     ORDER BY d.id, l.ordinal`;
  const selectStatuteLinkedTo = database.prepare(statuteLinkedWhere("l.target_id = ?2"));
  const selectStatuteLinkedWithin = database.prepare(statuteLinkedWhere("l.target_id >= ?2 AND l.target_id < ?3"));
  // Testimony whose Organization names an Agency: the worker matched it when it stored the row (ADR-0016, ADR-0027).
  const testimonyLinksWhere = (condition: string): string =>
    `SELECT t.agency_id, t.organization, t.document_id, t.source_url AS document_source_url,
            dc.created_at AS document_created_at, t.measure_id, fr.listed, fr.last_listed_at
     FROM testimony t LEFT JOIN document_created dc ON dc.document_id = t.document_id
       LEFT JOIN feed_row_state fr ON fr.document_id = t.document_id
     WHERE t.session_key = ?1 AND t.agency_id IS NOT NULL AND t.measure_id IS NOT NULL AND ${condition}
     ORDER BY t.agency_id, t.comm_test_id`;
  const selectTestimonyLinksOfAgency = database.prepare(testimonyLinksWhere("t.agency_id = ?2"));
  const selectTestimonyLinksOfMeasure = database.prepare(testimonyLinksWhere("t.measure_id = ?2"));
  const selectUnresolvedUnits = database.prepare(
    `SELECT u.unit, d.id AS document_id, d.source_url AS document_source_url, mr.to_id AS measure_id,
            vr.to_id AS version_id, fr.listed, fr.last_listed_at
     FROM unresolved_unit u
       JOIN document d ON d.id = u.document_id
       JOIN document_relation mr ON mr.document_id = d.id AND mr.relation = 'measure'
       LEFT JOIN document_relation vr ON vr.document_id = d.id AND vr.relation = 'version'
       LEFT JOIN feed_row_state fr ON fr.document_id = d.id
     WHERE mr.to_id = ?
     ORDER BY d.id, u.ordinal`,
  );
  // A Proposed Amendment's number as its earliest posting writes it, and the file `get_document` serves for it.
  const selectAmendmentNumber = database.prepare(
    `SELECT md.label FROM meeting_document md JOIN meeting m ON m.id = md.meeting_id
     WHERE md.kind = 'proposed_amendment' AND md.node_id = ?
     ORDER BY m.at, length(md.document_id), md.document_id LIMIT 1`,
  );
  const selectAmendmentFile = database.prepare(
    "SELECT source_url FROM document WHERE node_id = ? AND node_id <> id ORDER BY posted_at DESC, id DESC LIMIT 1",
  );
  const selectVersionNode = database.prepare(
    "SELECT label, source_url FROM document WHERE id = ? AND kind = 'version'",
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
    if (row === undefined) return unreadStatuteParse();
    const stored = parseRow.parse(row);
    const links = selectStatuteLinks
      .all(contentHash, readAs)
      .map((found) => statuteLinkOfRow(statuteLinkRow.parse(found)));
    const edits: RelatingClauseEdit[] = relatingClauseEdits.parse(JSON.parse(stored.relating_clause_edits));
    const header: AmendmentHeader | null =
      stored.amended_version_header === null ||
      stored.header_measure_prefix === null ||
      stored.header_measure_number === null
        ? null
        : {
            version: stored.amended_version_header,
            measure: { prefix: stored.header_measure_prefix, number: stored.header_measure_number },
          };
    return {
      textRead: stored.text_read === 1,
      amendedVersionHeader: header,
      links,
      relatingClauseEdits: edits,
    };
  }
  /**
   * The listing a query of `feed_row_state` found. No row, or a row whose state is NULL (a LEFT JOIN that found
   * none), is a row no complete pull has listed: it reads as listed, not yet checked (ADR-0030).
   */
  function listingOf(row: unknown): Listing {
    const stored = row === undefined ? { listed: null, last_listed_at: null } : listingRow.parse(row);
    if (stored.listed === 0) {
      if (stored.last_listed_at === null)
        throw new Error("A row that is no longer listed has no time it was last listed");
      return { listed: false, lastListedAt: stored.last_listed_at as Timestamp };
    }
    return { listed: true, lastListedAt: stored.last_listed_at as Timestamp | null };
  }
  function measureNodeOf(key: MeasureKey): LinkedNode {
    return {
      type: "measure",
      id: measureIdOf(key),
      measure: key,
      label: null,
      sourceUrl: olisPageUrlOf(key),
    };
  }
  /** The Measure a stored id names. The ids in the store were minted from a Measure of this Session. */
  function measureKeyOf(measureId: string, session: SessionKey): MeasureKey {
    const key = parseMeasureReference(measureId, session);
    if (key === undefined) throw new Error(`The store holds ${measureId}, which is no Measure of ${session}`);
    return key;
  }
  /** The Version a stored Version document is. */
  function versionNodeOf(key: MeasureKey, id: string, label: string, sourceUrl: string): LinkedNode {
    return { type: "version", id: id as DocumentId, measure: key, label, sourceUrl };
  }
  /** The Proposed Amendment a stored posting is of: its number as its earliest posting writes it, and the file served for it. */
  function amendmentNodeOf(key: MeasureKey, id: string): LinkedNode {
    const number = amendmentNumberRow.parse(selectAmendmentNumber.get(id));
    const file = amendmentFileRow.parse(selectAmendmentFile.get(id));
    return {
      type: "proposed_amendment",
      id: id as AmendmentId,
      measure: key,
      label: number.label,
      sourceUrl: file.source_url,
    };
  }
  /**
   * Where a Fiscal Impact Statement sits: the Version the feed places it on (ADR-0013) when the store holds that
   * Version's file, and otherwise the Measure. A Version whose file did not come cannot be named or linked to.
   */
  function statementNodeOf(key: MeasureKey, versionId: string | null): LinkedNode {
    if (versionId === null) return measureNodeOf(key);
    const version = selectVersionNode.get(versionId);
    if (version === undefined) return measureNodeOf(key);
    const stored = versionNodeRow.parse(version);
    return versionNodeOf(key, versionId, stored.label, stored.source_url);
  }
  /**
   * The node a stored Agency Link sits on, from the document its evidence was read from. A call asks for the same
   * Version or amendment once for each link, so `known` keeps the nodes it has made.
   */
  function nodeOfDocument(
    found: z.infer<typeof agencyLinkRow>,
    key: MeasureKey,
    known: Map<string, LinkedNode>,
  ): LinkedNode {
    const remembered = (nodeKey: string, make: () => LinkedNode): LinkedNode => {
      const node = known.get(nodeKey) ?? make();
      known.set(nodeKey, node);
      return node;
    };
    switch (found.document_kind) {
      case "analysis":
        return remembered(`statement ${found.version_id ?? found.measure_id}`, () =>
          statementNodeOf(key, found.version_id),
        );
      case "version":
        return remembered(`version ${found.document_id}`, () =>
          versionNodeOf(key, found.document_id, found.document_label, found.document_source_url),
        );
      case "proposed_amendment":
        return remembered(`amendment ${found.node_id}`, () => amendmentNodeOf(key, found.node_id));
      default:
        return found.document_kind satisfies never;
    }
  }
  function relationsOf(documentId: DocumentId): RelatedNode[] {
    return selectRelations.all(documentId).map((row) => {
      const stored = relationRow.parse(row);
      return { relation: stored.relation as Relation, to: stored.to_id as NodeId, meaning: stored.meaning, documentId };
    });
  }
  function amendmentOf(id: AmendmentId): StoredAmendment | undefined {
    const rows = selectPostingsOfAmendment.all(id).map((row) => postingRow.parse(row));
    const listed = rows.map((stored) => ({
      label: stored.label,
      measureId: stored.measure_id as MeasureId,
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
        listed: stored.listed === 1,
      } satisfies AmendmentPosting,
    }));
    // The same meeting's postings are told apart by the feed's number, compared as a number.
    listed.sort(
      (a, b) =>
        a.posting.meetingAt.localeCompare(b.posting.meetingAt) ||
        numbersInOrder.compare(a.posting.documentId, b.posting.documentId),
    );
    const [earliest] = listed;
    if (earliest === undefined) return undefined;
    // Postings are told apart by their files, and files by what was read of them: postings that share a file
    // (the same bytes) share one reading, and so do files that differ in bytes only (the PDF's modification date
    // differs between SB 69-1's two files, ADR-0011) and whose text was read and reads the same. Each such set is one
    // entry, with every posting it covers, so no posting is picked and none is left out.
    const readings = new Map<string, AmendmentFile>();
    const parsed = new Map<string, StatuteParse>();
    for (const { contentHash, posting } of listed) {
      if (contentHash === null) continue;
      const parse = parsed.get(contentHash) ?? statuteParseOf(contentHash, "proposed_amendment");
      parsed.set(contentHash, parse);
      // Files that were read are one entry when they read the same. A file that was not read has said nothing about
      // what it holds, so two different unread files are never "the same": each stands alone, and postings share
      // an entry only when they share the file itself.
      const reading = parse.textRead ? JSON.stringify(parse) : `not read: ${contentHash}`;
      const file = readings.get(reading) ?? { postingIds: [], parse };
      file.postingIds.push(posting.documentId);
      readings.set(reading, file);
    }
    return {
      id,
      number: earliest.label,
      spellings: [...new Set(listed.map(({ label }) => label))],
      measureId: earliest.measureId,
      postings: listed.map(({ posting }) => posting),
      files: [...readings.values()],
    };
  }
  function findAgencyLinks(
    session: SessionKey,
    of: { agency: AgencyId } | { measure: MeasureKey },
  ): StoredAgencyLink[] {
    const [links, testimonyLinks, asked] =
      "agency" in of
        ? [selectAgencyLinksOfAgency, selectTestimonyLinksOfAgency, of.agency]
        : [selectAgencyLinksOfMeasure, selectTestimonyLinksOfMeasure, measureIdOf(of.measure)];
    const stored = links.all(session, asked).map((row) => agencyLinkRow.parse(row));
    const known = new Map<string, LinkedNode>();
    const read = stored.map((found): StoredAgencyLink => {
      const key = measureKeyOf(found.measure_id, session);
      const evidence: AgencyEvidence = evidenceFromJson(found.link_kind, found.evidence);
      return {
        agency: found.agency_id as AgencyId,
        evidence,
        document: {
          id: found.document_id as DocumentId,
          sourceUrl: found.document_source_url,
          createdAt: found.document_created_at as Timestamp | null,
          // A Proposed Amendment is listed while the feed lists any of its postings (ADR-0030), as its node is.
          listing: listingOf(
            found.document_kind === "proposed_amendment" ? selectPostingsListing.get(found.node_id) : found,
          ),
        },
        node: nodeOfDocument(found, key, known),
      };
    });
    const testimony = testimonyLinks
      .all(session, asked)
      .map((row) => testimonyLinkRow.parse(row))
      .map((found): StoredAgencyLink => {
        const key = measureKeyOf(found.measure_id, session);
        return {
          agency: found.agency_id as AgencyId,
          // The Agency Link extractor matches the Organization with stray spaces trimmed (agency-links, matchOrganization).
          evidence: { kind: "testimony", organization: (found.organization ?? "").trim() },
          document: {
            id: found.document_id as DocumentId,
            sourceUrl: found.document_source_url,
            createdAt: found.document_created_at as Timestamp | null,
            listing: listingOf(found),
          },
          node: measureNodeOf(key),
        };
      });
    return [...read, ...testimony];
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
          listed: stored.listed === 1,
        };
      });
    },
    analysisNotHeld(key) {
      return countRow.parse(countNotHeld.get(measureIdOf(key))).n;
    },
    findAgencyLinks,
    findStatuteLinked(session, target) {
      const known = new Map<string, LinkedNode>();
      let rows;
      if ("section" in target) {
        rows = selectStatuteLinkedTo.all(session, target.section);
      } else {
        const { from, before } = orsSectionIdRangeOf(target.chapter);
        rows = [
          ...selectStatuteLinkedTo.all(session, target.chapter),
          ...selectStatuteLinkedWithin.all(session, from, before),
        ];
      }
      return rows
        .map((row) => statuteLinkedRow.parse(row))
        .map((found): StoredStatuteLinked => {
          const key = measureKeyOf(found.measure_id, session);
          const node =
            found.document_kind === "version"
              ? (known.get(found.document_id) ??
                versionNodeOf(key, found.document_id, found.document_label, found.document_source_url))
              : (known.get(found.node_id) ?? amendmentNodeOf(key, found.node_id));
          known.set(node.id, node);
          return {
            document: {
              id: found.document_id as DocumentId,
              sourceUrl: found.document_source_url,
              createdAt: found.document_created_at as Timestamp | null,
            },
            node,
            link: statuteLinkOfRow(found),
          };
        });
    },
    measuresWithAgencyLink(session, agency) {
      // ADR-0037: a link none of whose evidence documents the feed lists is not counted, as a node no longer listed is not.
      const links = findAgencyLinks(session, { agency });
      const listed = listedLinkKeys(links);
      return [
        ...new Set(
          links
            .filter((link) => listed.has(agencyLinkKey(link.agency, link.node.id)))
            .map((link) => measureIdOf(link.node.measure)),
        ),
      ];
    },
    agencyParents() {
      const parents = new Map<AgencyId, AgencyId>();
      for (const row of database.prepare("SELECT agency_id, parent_id FROM agency_parent").all()) {
        const stored = agencyParentRow.parse(row);
        parents.set(stored.agency_id as AgencyId, stored.parent_id as AgencyId);
      }
      return parents;
    },
    findUnresolvedUnits(measure) {
      return selectUnresolvedUnits.all(measureIdOf(measure)).map((row): StoredUnresolvedUnit => {
        const found = unresolvedUnitRow.parse(row);
        return {
          unit: found.unit,
          statement: {
            id: found.document_id as DocumentId,
            sourceUrl: found.document_source_url,
            listing: listingOf(found),
          },
          node: statementNodeOf(measure, found.version_id),
        };
      });
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
        return {
          document,
          related: relationsOf(document.id),
          listing: listingOf(selectDocumentListing.get(document.id)),
        };
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
      return {
        document: latest,
        related,
        listing: listingOf(selectPostingsListing.get(id)),
      };
    },
    findAmendment(id) {
      return amendmentOf(id);
    },
    findMeasureAmendments(key) {
      const ids = selectAmendmentsOfMeasure
        .all(measureIdOf(key))
        .map((row) => z.object({ node_id: z.string() }).parse(row).node_id);
      const amendments = ids.flatMap((id) => amendmentOf(id as AmendmentId) ?? []);
      return amendments.sort((a, b) => numbersInOrder.compare(a.number, b.number));
    },
    findMeasureVersions(key) {
      return selectVersionsOfMeasure.all(measureIdOf(key)).map((row): StoredVersion => {
        const stored = versionRow.parse(row);
        return {
          id: stored.id as DocumentId,
          label: stored.label,
          sourceUrl: stored.source_url,
          parse: statuteParseOf(stored.content_hash, "version"),
          listed: stored.listed === 1,
        };
      });
    },
    statutesAffectedTableOf(key) {
      const row = selectTable.get(key.session);
      if (row === undefined) return undefined;
      const table = tableRow.parse(row);
      const entries = selectTableEntries
        .all(key.session, key.prefix, key.number)
        .map((entryOf): StatutesAffectedEntry => {
          const stored = tableEntryRow.parse(entryOf);
          const measure = { prefix: key.prefix, number: key.number };
          const common = {
            measure,
            level: stored.level,
            action: stored.action,
            measureSection: stored.measure_section,
            emergency: stored.emergency === 1,
            loneE: stored.lone_e === 1,
          };
          return {
            ...common,
            target: storedTargetOf(stored.target_type, stored.target_id, "a table entry for"),
          };
        });
      const listedVersions = selectListedVersions
        .all(measureIdOf(key))
        .map((listed) => listedVersionRow.parse(listed).label);
      return { sourceUrl: table.source_url, retrievedAt: table.retrieved_at as Timestamp, entries, listedVersions };
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
          meetingsSet,
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
            listed: stored.listed === 1,
          };
        });
    },
    meetingContents(meeting) {
      const agendaItems = selectAgendaItems.all(agendaItemsSet, meeting).map((row): ListedAgendaItem => {
        const stored = agendaItemRow.parse(row);
        return {
          listed: stored.listed === 1,
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
            listed: stored.listed === 1,
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
            listed: stored.listed === 1,
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
    testimonyListing(id) {
      const row = selectTestimonyListing.get(id);
      return row === undefined ? undefined : listingOf(row);
    },
    findNoLongerListed(id) {
      const listing = listingOf(selectDocumentListing.get(id) ?? selectPostingsListing.get(id));
      return listing.listed ? undefined : listing;
    },
    measureListing(key) {
      return listingOf(selectMeasureListing.get(key.session, measuresSet, measureIdOf(key)));
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
          listed: stored.listed === 1,
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
      // The index is as of its latest update: the last complete full pull, or a later increment (ADR-0039).
      const full = fullPullOf(session);
      const increment = incrementOf(session);
      if (full === undefined || increment === undefined) return full;
      return compareTimestamps(increment, full) > 0 ? increment : full;
    },
    lastFullPull: fullPullOf,
    lastIncrement: incrementOf,
    meetingDays(session) {
      return selectMeetingDays.all(session).map((row) => meetingDayRow.parse(row).day);
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
