import { MAX_PASSAGE_TOKENS, VECTOR_DIMENSIONS, type Embedder } from "#/packages/embedder/index.ts";

// A test double for the embedder, and labelled as one: its model id says "fake". The vectors are
// deterministic and unit length, derived from the words of the text (each word adds to one of the 384
// places, chosen by a hash of the word), so two texts that share words have vectors that point the same
// way, and the same text always has the same vector. They mean nothing a person would call meaning. Every
// seam-1 test that is not about how well search ranks uses this embedder: with the real model, every pull
// of the fixture would embed about 1.9 million characters, about two minutes on one core
// (test/support/real-embedder.ts is the real one, for the tests of ranking).

/** What the fake counts as a token: a run of letters, a run of digits, or one other mark. */
const tokenPattern = /\p{L}+|\p{N}+|[^\s\p{L}\p{N}]/gu;

/** FNV-1a: a small hash that gives the same number for the same word in every process. */
function hashOf(word: string): number {
  let hash = 0x811c9dc5;
  for (const character of word) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function vectorOf(text: string): Float32Array {
  const vector = new Float32Array(VECTOR_DIMENSIONS);
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const hash = hashOf(match[0]);
    const place = hash % VECTOR_DIMENSIONS;
    vector[place] = (vector[place] ?? 0) + 1;
  }
  let sum = 0;
  for (const value of vector) sum += value * value;
  if (sum === 0) {
    vector[0] = 1;
    return vector;
  }
  const length = Math.sqrt(sum);
  return vector.map((value) => value / length);
}

export function createFakeEmbedder(): Embedder {
  return {
    modelId: "fake-hashed-words-384",
    maxPassageTokens: MAX_PASSAGE_TOKENS,
    countTokens: (text) => (text.match(tokenPattern) ?? []).length,
    embedPassages: (texts) => Promise.resolve(texts.map(vectorOf)),
    embedQuestion: (text) => Promise.resolve(vectorOf(text)),
  };
}
