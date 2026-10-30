// The MCP server's side of the database: read-only.
import { z } from "zod";
import type {
  AmendmentId,
  DocumentId,
  DocumentKind,
  DocumentView,
  NodeId,
  Relation,
  RelatedNode,
  StoredDocument,
} from "#/packages/domain/documents.ts";
import type { Measure, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openReadConnection } from "./lib/connection.ts";

export type IndexReader = {
  findMeasure(key: MeasureKey): Measure | undefined;
  /** When the last completed full pull started, or undefined if none has completed. */
  asOf(session: SessionKey): Timestamp | undefined;
  /**
   * A document by its id, or a Proposed Amendment by its id: the text of its latest posting, with the
   * nodes all its postings point at.
   */
  findDocument(id: string): DocumentView | undefined;
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
});

export function openIndexReader(path: string): IndexReader {
  const database = openReadConnection(path);
  const selectMeasure = database.prepare(
    "SELECT catchline, created_at, modified_at FROM measure WHERE session_key = ? AND prefix = ? AND number = ?",
  );
  const selectAsOf = database.prepare("SELECT full_pull_as_of FROM index_state WHERE session_key = ?");
  const selectDocument = database.prepare("SELECT * FROM document WHERE id = ?");
  const selectPostings = database.prepare(
    "SELECT * FROM document WHERE node_id = ? AND node_id <> id ORDER BY posted_at DESC, id DESC",
  );
  const selectRelations = database.prepare(
    "SELECT relation, to_id, meaning FROM document_relation WHERE document_id = ? ORDER BY rowid",
  );
  function documentOf(row: unknown): StoredDocument {
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
      relations: [],
    };
  }
  function relationsOf(documentId: DocumentId): RelatedNode[] {
    return selectRelations.all(documentId).map((row) => {
      const stored = relationRow.parse(row);
      return { relation: stored.relation as Relation, to: stored.to_id as NodeId, meaning: stored.meaning, documentId };
    });
  }
  return {
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
