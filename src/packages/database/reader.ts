// The MCP server's side of the database: read-only.
import { z } from "zod";
import {
  documentKinds,
  type AgendaItem,
  type AmendmentId,
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
  type Relation,
  type RelatedNode,
} from "#/packages/domain/documents.ts";
import type { Measure, MeasureId, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openReadConnection } from "./lib/connection.ts";

/** What a meetings query asks for. Every field given must hold. */
export type MeetingFilter = {
  /** Meetings with an agenda item about this Measure. */
  measure?: MeasureKey;
};

export type IndexReader = {
  findMeasure(key: MeasureKey): Measure | undefined;
  /** When the last completed full pull started, or undefined if none has completed. */
  asOf(session: SessionKey): Timestamp | undefined;
  /**
   * A document by its id, or a Proposed Amendment by its id: the text of its latest posting, with the
   * nodes all its postings point at.
   */
  findDocument(id: DocumentId | AmendmentId): DocumentView | undefined;
  /** What the index holds of the Session. */
  counts(session: SessionKey): IndexCounts;
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
  label: z.string(),
  source_url: z.string(),
  measure_id: z.string().nullable(),
});
const postedAmendmentRow = z.object({
  node_id: z.string(),
  id: z.string(),
  label: z.string(),
  source_url: z.string(),
  meaning: z.string().nullable(),
  measure_id: z.string(),
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
  const selectMeetings = database.prepare(
    `SELECT m.id, m.committee_id, m.committee_code, c.name AS committee_name, m.at, m.status
     FROM meeting m JOIN committee c ON c.session_key = m.session_key AND c.code = m.committee_code
     WHERE m.session_key = ?
       AND (? IS NULL OR EXISTS (SELECT 1 FROM agenda_item a
                                 WHERE a.meeting_id = m.id AND a.measure_prefix = ? AND a.measure_number = ?))
     ORDER BY m.at, m.committee_code`,
  );
  const selectAgendaItems = database.prepare(
    "SELECT * FROM agenda_item WHERE meeting_id = ? ORDER BY print_order IS NULL, CAST(print_order AS INTEGER), id",
  );
  const selectPostedAmendments = database.prepare(
    `SELECT d.id, d.node_id, d.label, d.source_url, r.meaning,
            (SELECT x.to_id FROM document_relation x WHERE x.document_id = d.id AND x.relation = 'measure') AS measure_id
     FROM document_relation r JOIN document d ON d.id = r.document_id
     WHERE r.relation = 'posted_to' AND r.to_id = ?`,
  );
  const selectMeetingDocuments = database.prepare(
    `SELECT d.id, d.label, d.source_url,
            (SELECT x.to_id FROM document_relation x WHERE x.document_id = d.id AND x.relation = 'measure') AS measure_id
     FROM document_relation r JOIN document d ON d.id = r.document_id
     WHERE r.relation = 'meeting' AND r.to_id = ? AND d.kind = ?`,
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
  function meetingDocumentsOf(meeting: MeetingId, kind: DocumentKind): MeetingDocument[] {
    const documents = selectMeetingDocuments.all(meeting, kind).map((row) => {
      const stored = meetingDocumentRow.parse(row);
      return {
        id: stored.id as DocumentId,
        label: stored.label,
        sourceUrl: stored.source_url,
        measureId: stored.measure_id as MeasureId | null,
      };
    });
    return documents.sort((a, b) => numbersInOrder.compare(a.id, b.id));
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
    findMeetings(session, filter) {
      const measure = filter.measure;
      return selectMeetings
        .all(session, measure?.prefix ?? null, measure?.prefix ?? null, measure?.number ?? null)
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
      const amendments = selectPostedAmendments.all(meeting).map((row) => {
        const stored = postedAmendmentRow.parse(row);
        return {
          id: stored.node_id as AmendmentId,
          number: stored.label,
          measureId: stored.measure_id as MeasureId,
          meaning: stored.meaning,
          documentId: stored.id as DocumentId,
          sourceUrl: stored.source_url,
        };
      });
      amendments.sort(
        (a, b) =>
          numbersInOrder.compare(a.measureId, b.measureId) ||
          numbersInOrder.compare(a.number, b.number) ||
          numbersInOrder.compare(a.documentId, b.documentId),
      );
      return { agendaItems, amendments, exhibits: meetingDocumentsOf(meeting, "exhibit") };
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
    close() {
      database.close();
    },
  };
}
