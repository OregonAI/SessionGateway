// The MCP server's side of the search index: read-only, like reader.ts, and a file of its own so that
// the queries of search (ADR-0025) do not grow reader.ts. The worker writes the index through
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

/** What a filter looks at in a document. */
export type DocumentFacts = {
  kind: DocumentKind;
  measureId: MeasureId | null;
  committeeId: CommitteeId | null;
  date: Timestamp | null;
};

/**
 * Whether a document passes a filter. This is `filterTerms` again, for the vector side, which scans in memory
 * and not in SQL: the two sit side by side so that they change together.
 */
export function acceptsDocument(filter: SearchFilter, facts: DocumentFacts): boolean {
  if (filter.kind !== undefined && facts.kind !== filter.kind) return false;
  if (!filter.withTestimony && facts.kind === "testimony") return false;
  if (filter.measure !== undefined && facts.measureId !== filter.measure) return false;
  if (filter.committee !== undefined && facts.committeeId !== filter.committee) return false;
  const day = facts.date?.slice(0, 10);
  if (filter.from !== undefined && (day === undefined || day < filter.from)) return false;
  if (filter.to !== undefined && (day === undefined || day > filter.to)) return false;
  return true;
}

/** One passage that has a vector, with the document it is of. */
export type VectorRow = {
  passageId: number;
  documentId: DocumentId;
  nodeId: DocumentId | AmendmentId;
  facts: DocumentFacts;
  /** The int8 vector, as the worker stored it. */
  vector: Int8Array;
};

/** A passage that matched, and the hit it belongs to. */
export type PassageMatch = {
  passageId: number;
  documentId: DocumentId;
  /** The id a hit carries: the document's, or a posting's Proposed Amendment's. */
  nodeId: DocumentId | AmendmentId;
};

/**
 * A document that a citation names exactly, and the passage that shows it (null for a file with no text to show).
 * For an ORS section that is the passage the first mention starts in, and `citedAt` is where the mention starts
 * in the document's text; for a Measure or an amendment it is the document's first passage.
 */
export type CitedDocument = {
  passageId: number | null;
  documentId: DocumentId;
  nodeId: DocumentId | AmendmentId;
  citedAt?: number;
};

/** How much text after the start of a mention is shown, so that a mention a passage ends in the middle of is whole. */
const CITATION_TAIL = 100;

/** What a hit shows of a document and of the passage that matched. */
export type HitDetails = {
  documentId: DocumentId;
  nodeId: DocumentId | AmendmentId;
  kind: DocumentKind;
  title: string;
  measureId: MeasureId | null;
  date: Timestamp | null;
  sourceUrl: string;
  /**
   * The text of the passage that matched, exactly as the document has it. When the hit was found by a mention of a
   * citation that starts in the passage, the text runs on past the passage's end far enough to hold the mention.
   */
  passageText: string;
};

export type SearchIndexReader = {
  /**
   * The passages that match an FTS5 expression, best first (BM25), at most `limit`; only the passages of
   * keyword-only documents when `keywordOnly` is true.
   */
  keyword(match: string, filter: SearchFilter, limit: number, keywordOnly?: boolean): PassageMatch[];
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
  /**
   * The documents whose text names a citation (an id: `ors-468.130`) and pass the filter, at most `limit`, oldest
   * first (by the date they are filed under, then by id). Each comes with the passage that holds the citation's
   * first mention, or the passage it starts in when a boundary cuts it in two.
   */
  citing(citationId: string, filter: SearchFilter, limit: number): CitedDocument[];
  /**
   * A number that moves whenever the worker stores or refreshes something the meaning side holds in memory: a
   * document's vectors, or how a document is filed (its kind, Measure, committee, date, keyword-only flag). Read
   * it before reading the vectors, and read the vectors again when it has moved.
   */
  generation(): number;
  /** How many passages of the Session have a vector under this model id. */
  vectorCount(session: SessionKey, modelId: string): number;
  /**
   * Every passage of the Session that has a vector under this model id, in the order of the passages' ids.
   * The passages of keyword-only documents have none.
   */
  vectors(session: SessionKey, modelId: string): Iterable<VectorRow>;
  /** What a hit shows. A document with no passage shows no text. */
  details(match: { passageId: number | null; documentId: DocumentId; citedAt?: number }): HitDetails;
  close(): void;
};

const citedRow = z.object({
  document_id: z.string(),
  node_id: z.string(),
  passage_id: z.number().nullable(),
  cited_at: z.number().nullable().optional(),
});
const countRow = z.object({ n: z.number() });
const generationRow = z.object({ generation: z.number() });
const vectorRow = z.object({
  passage_id: z.number(),
  document_id: z.string(),
  node_id: z.string(),
  kind: z.string(),
  measure_id: z.string().nullable(),
  committee_id: z.string().nullable(),
  dated_at: z.string().nullable(),
  vector: z.instanceof(Uint8Array),
});
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

/**
 * The WHERE term that leaves out a document the feed no longer lists (ADR-0005, ADR-0030), over `search_document`
 * aliased `sd`. Every query of the index and the load of the vectors have it, so that a document that two complete
 * pulls in a row have not listed is in no result and in no scan, and `get_document` still serves it.
 */
const listedDocument =
  "EXISTS (SELECT 1 FROM feed_row_state fr WHERE fr.document_id = sd.document_id AND fr.listed = 1)";

/** The WHERE terms of a filter over `search_document` (aliased `sd`), and the values they take. */
function filterTerms(filter: SearchFilter): { sql: string; values: string[] } {
  const terms = ["sd.session_key = ?", listedDocument];
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

/** The passage's text, run on to hold a mention of a citation that starts in it (`HitDetails.passageText`). */
function passageTextOf(stored: z.infer<typeof detailsRow>, citedAt: number | undefined): string {
  if (stored.start_offset === null || stored.end_offset === null) return "";
  const startsHere = citedAt !== undefined && citedAt >= stored.start_offset && citedAt < stored.end_offset;
  const end = startsHere ? Math.max(stored.end_offset, citedAt + CITATION_TAIL) : stored.end_offset;
  return stored.text.slice(stored.start_offset, end);
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
  const vectorSelection = `FROM passage p
       JOIN search_document sd ON sd.document_id = p.document_id
       JOIN passage_vector v ON v.text_hash = p.text_hash AND v.model_id = ?2
     WHERE sd.session_key = ?1 AND sd.keyword_only = 0 AND ${listedDocument}`;
  const selectGeneration = database.prepare("SELECT generation FROM search_generation WHERE id = 1");
  const selectVectorCount = database.prepare(`SELECT COUNT(*) AS n ${vectorSelection}`);
  const selectVectors = database.prepare(
    `SELECT p.id AS passage_id, p.document_id, sd.node_id, sd.kind, sd.measure_id, sd.committee_id, sd.dated_at,
            v.vector ${vectorSelection} ORDER BY p.id`,
  );
  /** The first passage of a document: what a hit shows when it is found by a citation and not by a passage. */
  const firstPassage = "(SELECT p.id FROM passage p WHERE p.document_id = sd.document_id ORDER BY p.ordinal LIMIT 1)";
  const citedOf = (row: unknown): CitedDocument => {
    const stored = citedRow.parse(row);
    return {
      passageId: stored.passage_id,
      documentId: stored.document_id as DocumentId,
      nodeId: stored.node_id as DocumentId | AmendmentId,
      ...(stored.cited_at === null || stored.cited_at === undefined ? {} : { citedAt: stored.cited_at }),
    };
  };
  return {
    keyword(match, filter, limit, keywordOnly = false) {
      const terms = filterTerms(filter);
      const rows = database
        .prepare(
          `SELECT p.id AS passage_id, p.document_id, sd.node_id
           FROM passage_fts
             JOIN passage p ON p.id = passage_fts.rowid
             JOIN search_document sd ON sd.document_id = p.document_id
           WHERE passage_fts MATCH ? AND ${terms.sql}${keywordOnly ? " AND sd.keyword_only = 1" : ""}
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
    generation() {
      return generationRow.parse(selectGeneration.get()).generation;
    },
    vectorCount(session, modelId) {
      return countRow.parse(selectVectorCount.get(session, modelId)).n;
    },
    *vectors(session, modelId) {
      for (const row of selectVectors.iterate(session, modelId)) {
        const stored = vectorRow.parse(row);
        yield {
          passageId: stored.passage_id,
          documentId: stored.document_id as DocumentId,
          nodeId: stored.node_id as DocumentId | AmendmentId,
          facts: {
            kind: stored.kind as DocumentKind,
            measureId: stored.measure_id as MeasureId | null,
            committeeId: stored.committee_id as CommitteeId | null,
            date: stored.dated_at as Timestamp | null,
          },
          // The blob is a view of SQLite's buffer, which the next row reuses: the vector is copied out.
          vector: new Int8Array(
            stored.vector.buffer.slice(stored.vector.byteOffset, stored.vector.byteOffset + stored.vector.byteLength),
          ),
        };
      }
    },
    citing(citationId, filter, limit) {
      const terms = filterTerms(filter);
      return database
        .prepare(
          `SELECT sd.document_id, sd.node_id,
                  COALESCE(
                    (SELECT p.id FROM passage p
                     WHERE p.document_id = sd.document_id AND p.start_offset <= dc.first_offset
                       AND dc.first_offset < p.end_offset
                     ORDER BY p.ordinal LIMIT 1),
                    ${firstPassage}) AS passage_id,
                  dc.first_offset AS cited_at
           FROM document_citation dc
             JOIN search_document sd ON sd.document_id = dc.document_id
           WHERE dc.citation_id = ? AND ${terms.sql}
           ORDER BY sd.dated_at IS NULL, sd.dated_at, sd.document_id
           LIMIT ?`,
        )
        .all(citationId, ...terms.values, limit)
        .map(citedOf);
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
        passageText: passageTextOf(stored, match.citedAt),
      };
    },
    close() {
      database.close();
    },
  };
}
