import { VECTOR_DIMENSIONS, type Embedder, type ModelRunner } from "#/packages/embedder/index.ts";
import { loadEmbedder } from "#/packages/embedder/load.ts";
import { modelLockPath } from "#/packages/embedder/lock.ts";
import { modelPath } from "./real-embedder.ts";

// A test double for the embedder's ONNX session, and labelled as one: its model id says "fake". It replaces
// that session and nothing else. The tokenizer is the model's own, read from MODEL_PATH, so a document is cut
// into the same passages here as in production (a different count of tokens would put the cuts, and so the
// citations a cut passage splits, in other places), and the question's instruction and the one-text-at-a-time
// rule are the real embedder's. The vectors are deterministic and unit length, derived from the token ids
// of the text (each token adds to one of the 384 places, chosen by a hash of its id), so two texts that share
// words point the same way and the same text always has the same vector. They mean nothing a person would
// call meaning, so the tests that judge meaning use the real model (test/support/real-embedder.ts); the
// others use this, because the real model would embed about 1.7 million characters (about two minutes on one
// core) in every pull of the fixture.

/** [CLS] and [SEP] are in the ids of every text and say nothing about it. */
const SPECIAL_TOKEN_IDS: ReadonlySet<number> = new Set([101, 102]);

/** A small hash that gives the same place for the same token id in every process. */
function placeOf(id: number): number {
  return (Math.imul(id, 0x9e3779b1) >>> 0) % VECTOR_DIMENSIONS;
}

const fakeRunner: ModelRunner = {
  modelId: "fake-hashed-tokens-384",
  run(ids) {
    const vector = new Float32Array(VECTOR_DIMENSIONS);
    for (const id of ids) {
      if (!SPECIAL_TOKEN_IDS.has(id)) vector[placeOf(id)] = (vector[placeOf(id)] ?? 0) + 1;
    }
    let sum = 0;
    for (const value of vector) sum += value * value;
    if (sum === 0) {
      vector[0] = 1;
      return Promise.resolve(vector);
    }
    const length = Math.sqrt(sum);
    return Promise.resolve(vector.map((value) => value / length));
  },
};

let shared: Promise<Embedder> | undefined;

/**
 * The fake embedder: the real tokenizer and a fake session. The tokenizer's files are read once for each test
 * file. It fails, naming `npm run model:fetch`, when the model's files are missing.
 */
export function createFakeEmbedder(): Promise<Embedder> {
  shared ??= loadEmbedder({ modelPath: modelPath(), lockPath: modelLockPath }, () => Promise.resolve(fakeRunner));
  return shared;
}
