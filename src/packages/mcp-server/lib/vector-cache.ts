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
  /** The index's generation (`SearchIndexReader.generation`) when the vectors were read. */
  generation: number;
  index: VectorIndex;
  documents: VectorDocuments;
};

export type VectorCache = {
  /**
   * The vectors the index holds now: read again from the database when its as-of time or its generation has
   * changed since they were read.
   */
  current(): LoadedVectors;
};

/**
 * Holds the vectors of the Session in memory for the exact scan, and reads them again when the index has changed
 * (docs/adr/0025, "Meaning side"). The as-of time and the generation are read on every call, which is two small
 * queries. A full pull records its as-of time before it stores its documents, one by one, and the server serves
 * during the pull (ADR-0007), so the as-of time alone would pin the vectors a search in the middle of a pull read,
 * and the pull's later documents would never reach the meaning side until the next pull; the worker raises the
 * generation with each document and each refresh that changes what is held. The generation is read before the
 * vectors, so a commit that lands while they are read makes the next call read them again. The vectors are those
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
      // Before the vectors are read: a commit that lands while they are read then shows in the next call.
      const generation = deps.searchIndex.generation();
      if (loaded?.asOf === asOf && loaded.generation === generation) return loaded;
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
      loaded = { asOf, generation, index, documents };
      return loaded;
    },
  };
}
