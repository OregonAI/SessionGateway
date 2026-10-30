import type { DocumentFacts, SearchIndexReader } from "#/packages/database/search.ts";
import type { IndexReader } from "#/packages/database/reader.ts";
import type { AmendmentId, DocumentId } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import { VECTOR_DIMENSIONS } from "#/packages/embedder/index.ts";
import { createVectorIndex, type VectorIndex } from "#/packages/search/vectors.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/** The documents the vectors are of, by the index each vector carries. */
export type VectorDocuments = {
  documentIds: DocumentId[];
  nodeIds: (DocumentId | AmendmentId)[];
  facts: DocumentFacts[];
};

export type LoadedVectors = {
  /** The index's as-of time when the vectors were read. */
  asOf: Timestamp;
  index: VectorIndex;
  documents: VectorDocuments;
};

export type VectorCache = {
  /** The vectors as of the index's current as-of time: read again from the database when that has changed. */
  current(): LoadedVectors;
};

/**
 * Holds the vectors of the Session in memory for the exact scan, and reads them again when the index's as-of
 * time changes (docs/adr/0025, "Vectors in memory"). The as-of time is read on every call, which is one
 * small query, so a full pull that finishes between two questions shows in the second. The vectors are those
 * of the embedder's model: a database built with another model has none, and a scan finds nothing.
 */
export function createVectorCache(deps: {
  reader: IndexReader;
  searchIndex: SearchIndexReader;
  session: SessionKey;
  modelId: string;
}): VectorCache {
  let loaded: LoadedVectors | undefined;
  return {
    current() {
      const asOf = deps.reader.asOf(deps.session);
      if (asOf === undefined) throw new Error(`The index holds no completed full pull of ${deps.session}`);
      if (loaded?.asOf === asOf) return loaded;
      const index = createVectorIndex(VECTOR_DIMENSIONS, deps.searchIndex.vectorCount(deps.session, deps.modelId));
      const documents: VectorDocuments = { documentIds: [], nodeIds: [], facts: [] };
      const documentIndexes = new Map<DocumentId, number>();
      for (const row of deps.searchIndex.vectors(deps.session, deps.modelId)) {
        let documentIndex = documentIndexes.get(row.documentId);
        if (documentIndex === undefined) {
          documentIndex = documents.documentIds.length;
          documentIndexes.set(row.documentId, documentIndex);
          documents.documentIds.push(row.documentId);
          documents.nodeIds.push(row.nodeId);
          documents.facts.push(row.facts);
        }
        index.add(row.passageId, documentIndex, row.vector);
      }
      loaded = { asOf, index, documents };
      return loaded;
    },
  };
}
