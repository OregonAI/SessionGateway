import type { DocumentFacts, SearchIndexReader } from "#/packages/database/search.ts";
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

/** The transcript passages the vectors are of, by the index each vector carries: one entry for each passage (ticket #134). */
export type VectorTranscriptPassages = {
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
  /**
   * The vectors of the machine transcript's passages, scanned beside the documents' (ticket #134, ADR-0055). Empty while the
   * publication gate is off: the cache never reads them then.
   */
  transcripts: { index: VectorIndex; passages: VectorTranscriptPassages };
};

export type VectorCache = {
  /**
   * The vectors the index holds now: read again from the database when the as-of time given or the generation has
   * changed since they were read. The as-of time is the one the tool result envelope read for the call.
   */
  current(asOf: Timestamp): LoadedVectors;
};

/**
 * Holds the vectors of the Session in memory for the exact scan, and reads them again when the index has changed
 * (ADR-0025, "Meaning side"). The as-of time comes with every call, and the generation is read on every call, which
 * is one small query. A full pull records its as-of time before it stores its documents, one by one, and the server
 * serves during the pull (ADR-0007), so the as-of time alone would pin the vectors a search in the middle of a pull
 * read, and the pull's later documents would never reach the meaning side until the next pull; the worker raises the
 * generation with each document and each refresh that changes what is held. The generation is read before the
 * vectors, so a commit that lands while they are read makes the next call read them again. The vectors are those
 * of the embedder's model: a database built with another model has none, and a scan finds nothing.
 */
export function createVectorCache(deps: {
  searchIndex: SearchIndexReader;
  session: SessionKey;
  modelId: string;
  /** The publication gate: whether the passages of a machine transcript are loaded. */
  transcriptsPublished: boolean;
}): VectorCache {
  let loaded: LoadedVectors | undefined;
  return {
    current(asOf) {
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
      const passages: VectorTranscriptPassages = { documentIds: [], nodeIds: [], facts: [] };
      const spoken = createVectorIndex(
        VECTOR_DIMENSIONS,
        deps.transcriptsPublished ? deps.searchIndex.transcriptVectorCount(deps.session, deps.modelId) : 0,
      );
      if (deps.transcriptsPublished) {
        for (const row of deps.searchIndex.transcriptVectors(deps.session, deps.modelId)) {
          // One entry for each passage: a passage's Measure is its own, so its facts are not its log's.
          spoken.add(row.passageId, passages.documentIds.length, row.vector);
          passages.documentIds.push(row.documentId);
          passages.nodeIds.push(row.nodeId);
          passages.facts.push(row.facts);
        }
      }
      loaded = { asOf, generation, index, documents, transcripts: { index: spoken, passages } };
      return loaded;
    },
  };
}
