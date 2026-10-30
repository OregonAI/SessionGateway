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

/** A document that a citation names exactly, and its first passage (null for a file with no text to show). */
export type CitedDocument = {
  passageId: number | null;
  documentId: DocumentId;
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
  /**
   * The Versions of a Measure that pass the filter, in the order they came: Introduced first, Enrolled last.
   * The Measure's own texts are what its citation names.
   */
  versionsOf(measure: MeasureId, filter: SearchFilter): CitedDocument[];
  /**
   * The Proposed Amendment's latest posting that passes the filter (the posting `get_document` serves
   * for the amendment), or undefined when none does.
   */
  postingOf(amendment: AmendmentId, filter: SearchFilter): CitedDocument | undefined;
  /** What a hit shows. A document with no passage shows no text. */
  details(match: { passageId: number | null; documentId: DocumentId }): HitDetails;
  close(): void;
};

const citedRow = z.object({ document_id: z.string(), node_id: z.string(), passage_id: z.number().nullable() });
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
  start_offset: z.number().nullable(),
  end_offset: z.number().nullable(),
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
     FROM document d
       JOIN search_document sd ON sd.document_id = d.id
       LEFT JOIN passage p ON p.id = ? AND p.document_id = d.id
     WHERE d.id = ?`,
  );
  /** The first passage of a document: what a hit shows when it is found by a citation and not by a passage. */
  const firstPassage = "(SELECT p.id FROM passage p WHERE p.document_id = sd.document_id ORDER BY p.ordinal LIMIT 1)";
  const citedOf = (row: unknown): CitedDocument => {
    const stored = citedRow.parse(row);
    return {
      passageId: stored.passage_id,
      documentId: stored.document_id as DocumentId,
      nodeId: stored.node_id as DocumentId | AmendmentId,
    };
  };
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
    versionsOf(measure, filter) {
      const terms = filterTerms(filter);
      return database
        .prepare(
          `SELECT sd.document_id, sd.node_id, ${firstPassage} AS passage_id
           FROM search_document sd
           WHERE sd.kind = 'version' AND sd.measure_id = ? AND ${terms.sql}
           ORDER BY sd.dated_at, sd.document_id`,
        )
        .all(measure, ...terms.values)
        .map(citedOf);
    },
    postingOf(amendment, filter) {
      const terms = filterTerms(filter);
      const row = database
        .prepare(
          `SELECT sd.document_id, sd.node_id, ${firstPassage} AS passage_id
           FROM search_document sd
           WHERE sd.node_id = ? AND ${terms.sql}
           ORDER BY sd.dated_at DESC, sd.document_id DESC
           LIMIT 1`,
        )
        .get(amendment, ...terms.values);
      return row === undefined ? undefined : citedOf(row);
    },
    details(match) {
      const row = selectDetails.get(match.passageId, match.documentId);
      if (row === undefined) throw new Error(`The index has no document ${match.documentId}`);
      const stored = detailsRow.parse(row);
      return {
        documentId: stored.document_id as DocumentId,
        nodeId: stored.node_id as DocumentId | AmendmentId,
        kind: stored.kind as DocumentKind,
        title: stored.title,
        measureId: stored.measure_id as MeasureId | null,
        date: stored.dated_at as Timestamp | null,
        sourceUrl: stored.source_url,
        passageText:
          stored.start_offset === null || stored.end_offset === null
            ? ""
            : stored.text.slice(stored.start_offset, stored.end_offset),
      };
    },
    close() {
      database.close();
    },
  };
}
