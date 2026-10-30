/**
 * Each component of a unit-length vector times 127, rounded: the int8 vector that is stored and scanned
 * (spec #1 module 10; docs/adr/0025). A component of a unit vector is at most 1 in size, so it fits.
 */
export function quantizeUnitVector(vector: Float32Array): Int8Array {
  const quantized = new Int8Array(vector.length);
  for (let place = 0; place < vector.length; place += 1) {
    quantized[place] = Math.round(Math.max(-1, Math.min(1, vector[place] ?? 0)) * 127);
  }
  return quantized;
}

/** A passage near a question: which passage, which document it is of, and how near (the dot product of the int8 vectors). */
export type NearPassage = {
  passageId: number;
  documentIndex: number;
  /** The dot product of the two int8 vectors: the cosine times 127 times 127. */
  score: number;
};

/**
 * Every vector the server holds in memory: one flat `Int8Array`, a vector after a vector, and for each the
 * passage it is of and the index of its document. A scan reads all of them, exactly, in TypeScript; the
 * research measured that faster than sqlite-vec at every size (docs/research/embeddings-and-storage.md §2.3).
 */
export type VectorIndex = {
  /** How many vectors it holds. */
  readonly size: number;
  /** The bytes the vectors, the passage ids and the document indexes take. */
  readonly bytes: number;
  /** Adds a vector. */
  add(passageId: number, documentIndex: number, vector: Int8Array): void;
  /**
   * The `limit` vectors nearest the question among those whose document `accept`s, nearest first. Equal
   * scores come in the order the vectors were added.
   */
  nearest(question: Int8Array, accept: (documentIndex: number) => boolean, limit: number): NearPassage[];
};

/**
 * An index with room for `capacity` vectors of `dimensions` components, which grows when more are added than
 * that: the caller knows how many vectors the database held a moment ago, and the worker may have added
 * some since.
 */
export function createVectorIndex(dimensions: number, capacity: number): VectorIndex {
  let vectors = new Int8Array(capacity * dimensions);
  let passages = new Float64Array(capacity);
  let documents = new Int32Array(capacity);
  let size = 0;
  return {
    get size() {
      return size;
    },
    get bytes() {
      return vectors.byteLength + passages.byteLength + documents.byteLength;
    },
    add(passageId, documentIndex, vector) {
      if (vector.length !== dimensions) throw new Error(`A vector has ${vector.length} components, not ${dimensions}`);
      if (size === capacity) {
        capacity = Math.max(16, capacity * 2);
        const grownVectors = new Int8Array(capacity * dimensions);
        grownVectors.set(vectors);
        vectors = grownVectors;
        const grownPassages = new Float64Array(capacity);
        grownPassages.set(passages);
        passages = grownPassages;
        const grownDocuments = new Int32Array(capacity);
        grownDocuments.set(documents);
        documents = grownDocuments;
      }
      vectors.set(vector, size * dimensions);
      passages[size] = passageId;
      documents[size] = documentIndex;
      size += 1;
    },
    nearest(question, accept, limit) {
      if (question.length !== dimensions)
        throw new Error(`A question has ${question.length} components, not ${dimensions}`);
      // The best so far, best first. `floor` is the score a vector must beat once the list is full.
      const best: NearPassage[] = [];
      let floor = -Infinity;
      for (let row = 0; row < size; row += 1) {
        const documentIndex = documents[row] as number;
        if (!accept(documentIndex)) continue;
        let score = 0;
        const base = row * dimensions;
        for (let place = 0; place < dimensions; place += 1) {
          score += (question[place] as number) * (vectors[base + place] as number);
        }
        if (best.length === limit && score <= floor) continue;
        let position = best.length;
        while (position > 0 && (best[position - 1] as NearPassage).score < score) position -= 1;
        best.splice(position, 0, { passageId: passages[row] as number, documentIndex, score });
        if (best.length > limit) best.pop();
        if (best.length === limit) floor = (best[limit - 1] as NearPassage).score;
      }
      return best;
    },
  };
}
