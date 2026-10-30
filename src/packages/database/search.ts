// The MCP server's side of the search index: read-only, like reader.ts, and a file of its own so that
// the queries of search (docs/adr/0025) do not grow reader.ts. The worker writes the index through
// writer.ts.
import { z } from "zod";
import type { AmendmentId, CommitteeId, DocumentId, DocumentKind } from "#/packages/domain/documents.ts";
import type { MeasureId, SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openReadConnection } from "./lib/connection.ts";

/** Which documents a search may return. Every field given must hold. */
export type SearchFilter = {
  session: SessionKey;
  /** Only documents of this kind. */
  kind?: DocumentKind;
  /** Whether Testimony may be returned. The caller decides: it is left out unless asked for or scoped. */
  withTestimony: boolean;
  measure?: MeasureId;
  committee?: CommitteeId;
  /** Only documents dated on this Pacific date or later: "2025-01-21". */
  from?: string;
  /** Only documents dated on this Pacific date or earlier. */
  to?: string;
};

/** A passage that matched, and the hit it belongs to. */
export type PassageMatch = {
  passageId: number;
  documentId: DocumentId;
  /** The id a hit carries: the document's, or a posting's Proposed Amendment's. */
  nodeId: DocumentId | AmendmentId;
};

/** What a hit shows of a document and of the passage that matched. */
export type HitDetails = {
  documentId: DocumentId;
  nodeId: DocumentId | AmendmentId;
  kind: DocumentKind;
  title: string;
  measureId: MeasureId | null;
  date: Timestamp | null;
  sourceUrl: string;
  /** The text of the passage that matched, exactly as the document has it. */
  passageText: string;
};

export type SearchIndexReader = {
  /** The passages that match an FTS5 expression, best first (BM25), at most `limit`. */
  keyword(match: string, filter: SearchFilter, limit: number): PassageMatch[];
  /** What a hit shows. */
  details(match: { passageId: number; documentId: DocumentId }): HitDetails;
  close(): void;
};

const matchRow = z.object({ passage_id: z.number(), document_id: z.string(), node_id: z.string() });
const detailsRow = z.object({
  document_id: z.string(),
  node_id: z.string(),
  kind: z.string(),
  title: z.string(),
  measure_id: z.string().nullable(),
  dated_at: z.string().nullable(),
  source_url: z.string(),
  text: z.string(),
  start_offset: z.number(),
  end_offset: z.number(),
});

/** The WHERE terms of a filter over `search_document` (aliased `sd`), and the values they take. */
function filterTerms(filter: SearchFilter): { sql: string; values: string[] } {
  const terms = ["sd.session_key = ?"];
  const values: string[] = [filter.session];
  if (filter.kind !== undefined) {
    terms.push("sd.kind = ?");
    values.push(filter.kind);
  }
  if (!filter.withTestimony) terms.push("sd.kind <> 'testimony'");
  if (filter.measure !== undefined) {
    terms.push("sd.measure_id = ?");
    values.push(filter.measure);
  }
  if (filter.committee !== undefined) {
    terms.push("sd.committee_id = ?");
    values.push(filter.committee);
  }
  if (filter.from !== undefined) {
    terms.push("substr(sd.dated_at, 1, 10) >= ?");
    values.push(filter.from);
  }
  if (filter.to !== undefined) {
    terms.push("substr(sd.dated_at, 1, 10) <= ?");
    values.push(filter.to);
  }
  return { sql: terms.join(" AND "), values };
}

export function openSearchReader(path: string): SearchIndexReader {
  const database = openReadConnection(path);
  const selectDetails = database.prepare(
    `SELECT d.id AS document_id, sd.node_id, sd.kind, sd.title, sd.measure_id, sd.dated_at, d.source_url, d.text,
            p.start_offset, p.end_offset
     FROM passage p
       JOIN document d ON d.id = p.document_id
       JOIN search_document sd ON sd.document_id = p.document_id
     WHERE p.id = ? AND p.document_id = ?`,
  );
  return {
    keyword(match, filter, limit) {
      const terms = filterTerms(filter);
      const rows = database
        .prepare(
          `SELECT p.id AS passage_id, p.document_id, sd.node_id
           FROM passage_fts
             JOIN passage p ON p.id = passage_fts.rowid
             JOIN search_document sd ON sd.document_id = p.document_id
           WHERE passage_fts MATCH ? AND ${terms.sql}
           ORDER BY passage_fts.rank, p.id
           LIMIT ?`,
        )
        .all(match, ...terms.values, limit);
      return rows.map((row) => {
        const stored = matchRow.parse(row);
        return {
          passageId: stored.passage_id,
          documentId: stored.document_id as DocumentId,
          nodeId: stored.node_id as DocumentId | AmendmentId,
        };
      });
    },
    details(match) {
      const row = selectDetails.get(match.passageId, match.documentId);
      if (row === undefined) throw new Error(`The index has no passage ${match.passageId} of ${match.documentId}`);
      const stored = detailsRow.parse(row);
      return {
        documentId: stored.document_id as DocumentId,
        nodeId: stored.node_id as DocumentId | AmendmentId,
        kind: stored.kind as DocumentKind,
        title: stored.title,
        measureId: stored.measure_id as MeasureId | null,
        date: stored.dated_at as Timestamp | null,
        sourceUrl: stored.source_url,
        passageText: stored.text.slice(stored.start_offset, stored.end_offset),
      };
    },
    close() {
      database.close();
    },
  };
}
