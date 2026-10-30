// The MCP server's side of the database: read-only.
import { z } from "zod";
import {
  documentKinds,
  type AgendaItem,
  type AmendmentId,
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
} from "#/packages/domain/documents.ts";
import type { Measure, MeasureId, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { SnapshotVersion } from "#/packages/domain/oregonai.ts";
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
  /** When the last completed full pull started, or undefined if none has completed. */
  asOf(session: SessionKey): Timestamp | undefined;
  /** The version of the OregonAI snapshot the last completed full pull built the index with. */
  snapshotVersion(session: SessionKey): SnapshotVersion | undefined;
  /**
   * A document by its id, or a Proposed Amendment by its id: the text of its latest posting, with the
   * nodes all its postings point at.
   */
  findDocument(id: DocumentId | AmendmentId): DocumentView | undefined;
  /** What the index holds of the Session. */
  counts(session: SessionKey): IndexCounts;
  /** A committee by its code or its id, in either case. */
  findCommittee(session: SessionKey, reference: string): Committee | undefined;
  /** The meetings that match, earliest first. */
  findMeetings(session: SessionKey, filter: MeetingFilter): MeetingHeader[];
  /** What one meeting holds. */
  meetingContents(meeting: MeetingId): MeetingContents;
  close(): void;
};

const measureRow = z.object({
  catchline: z.string().nullable(),
  created_at: z.string(),
  modified_at: z.string().nullable(),
});
const stateRow = z.object({ full_pull_as_of: z.string() });
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
    "SELECT catchline, created_at, modified_at FROM measure WHERE session_key = ? AND prefix = ? AND number = ?",
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
  function relationsOf(documentId: DocumentId): RelatedNode[] {
    return selectRelations.all(documentId).map((row) => {
      const stored = relationRow.parse(row);
      return { relation: stored.relation as Relation, to: stored.to_id as NodeId, meaning: stored.meaning, documentId };
    });
  }
  return {
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
    findMeasure(key) {
      const row = selectMeasure.get(key.session, key.prefix, key.number);
      if (row === undefined) return undefined;
      const stored = measureRow.parse(row);
      return {
        ...key,
        catchline: stored.catchline,
        createdAt: stored.created_at as Timestamp,
        modifiedAt: stored.modified_at as Timestamp | null,
      };
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
