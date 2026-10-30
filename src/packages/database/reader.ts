// The MCP server's side of the database: read-only.
import { z } from "zod";
import type {
  AmendmentId,
  DocumentId,
  DocumentKind,
  DocumentRelation,
  NodeId,
  Relation,
  StoredDocument,
} from "#/packages/domain/documents.ts";
import type { Measure, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openReadConnection } from "./lib/connection.ts";

export type IndexReader = {
  findMeasure(key: MeasureKey): Measure | undefined;
  /** When the last completed full pull started, or undefined if none has completed. */
  asOf(session: SessionKey): Timestamp | undefined;
  /** A document by its id. */
  findDocument(id: string): StoredDocument | undefined;
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
const relationRow = z.object({
  relation: z.string(),
  to_id: z.string(),
  meaning: z.string().nullable(),
  provenance: z.string(),
});

export function openIndexReader(path: string): IndexReader {
  const database = openReadConnection(path);
  const selectMeasure = database.prepare(
    "SELECT catchline, created_at, modified_at FROM measure WHERE session_key = ? AND prefix = ? AND number = ?",
  );
  const selectAsOf = database.prepare("SELECT full_pull_as_of FROM index_state WHERE session_key = ?");
  const selectDocument = database.prepare("SELECT * FROM document WHERE id = ?");
  const selectRelations = database.prepare(
    "SELECT relation, to_id, meaning, provenance FROM document_relation WHERE document_id = ? ORDER BY rowid",
  );
  function relationsOf(documentId: string): DocumentRelation[] {
    return selectRelations.all(documentId).map((row) => {
      const stored = relationRow.parse(row);
      return {
        relation: stored.relation as Relation,
        to: stored.to_id as NodeId,
        meaning: stored.meaning,
        provenance: stored.provenance,
      };
    });
  }
  return {
    findDocument(id) {
      const row = selectDocument.get(id);
      if (row === undefined) return undefined;
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
        relations: relationsOf(stored.id),
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
    close() {
      database.close();
    },
  };
}
