// The embedder: the one thing that turns text into the vectors search compares, and counts the tokens
// that decide where a passage ends. Spec #1 module 9; docs/adr/0006-local-embedding-model.md and
// docs/adr/0025-search-is-passages-fts5-and-int8-vectors-fused-by-rank.md. This entry point holds the
// interfaces only, so the ingest worker, the server and the tests depend on them and not on a runtime:
// `onnx.ts` is the real embedder, run in-process, and `load.ts` makes one over any `ModelRunner`, which is
// how the tests' fake (test/support/fake-embedder.ts) replaces the ONNX session and nothing else.

/** What a passage holds at most: the model reads 512 tokens, and [CLS] and [SEP] take two of them. */
export const MAX_PASSAGE_TOKENS = 510;

/** How many numbers a vector has: bge-small-en-v1.5 gives 384. */
export const VECTOR_DIMENSIONS = 384;

export type Embedder = {
  /**
   * Names the model, its revision, its pooling and the instruction a question carries. A vector is kept
   * under the hash of its passage and this id, so a change to any of them never reuses an old vector.
   */
  modelId: string;
  /** The most tokens a passage may hold, [CLS] and [SEP] left out. */
  maxPassageTokens: number;
  /** How many tokens the model reads in the text, [CLS] and [SEP] left out. */
  countTokens(text: string): number;
  /** One unit-length vector of `VECTOR_DIMENSIONS` numbers for each passage, in the order given. */
  embedPassages(texts: readonly string[]): Promise<Float32Array[]>;
  /** The unit-length vector of a question, which the model reads with its retrieval instruction in front. */
  embedQuestion(text: string): Promise<Float32Array>;
};

/**
 * What runs the model: the token ids of one text in, its unit-length vector out. The text is tokenized by the
 * model's own tokenizer before it gets here, whatever runs the model, so the passages and the questions an
 * embedder sees are cut and read the same way by the real session and by a test's fake.
 */
export type ModelRunner = {
  /** Names what this runner's vectors mean, as `Embedder.modelId` does. */
  modelId: string;
  /** The vector of one text, run alone: it depends on the ids and on nothing else. */
  run(ids: readonly number[]): Promise<Float32Array>;
};

/** Where the embedder's files are, handed in by the entry script (src/CLAUDE.md, "Dependencies are passed in"). */
export type EmbedderFiles = {
  /** The directory that holds the pinned model files: the MODEL_PATH variable. */
  modelPath: string;
  /** The lock file that pins them (`embedder/lock.ts` says where the committed one is). */
  lockPath: string;
};
