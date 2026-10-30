import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as ort from "onnxruntime-node";
import { readModelLock } from "../lock.ts";
import { MAX_PASSAGE_TOKENS, VECTOR_DIMENSIONS, type Embedder } from "../index.ts";
import { createTokenizer } from "./tokenizer.ts";

export type OnnxEmbedderOptions = {
  /** The directory that holds the pinned files (`npm run model:fetch` puts them in .cache/models/...). */
  modelPath: string;
  /**
   * How many threads one model run may use. The server uses one, because the deploy box has two cores
   * shared with seven corpora; the worker takes the number the deployment sets (MODEL_THREADS).
   */
  intraOpThreads: number;
};

/** The model file inside the model directory. The other files are named by the lock. */
const MODEL_FILE = "onnx/model_quantized.onnx";

/**
 * What the model card says to put before a question when the passages are retrieved by it, and before no
 * passage (BAAI/bge-small-en-v1.5 model card, note [1]).
 */
const QUESTION_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

/** The most tokens the model reads, [CLS] and [SEP] included. */
const MODEL_INPUT_TOKENS = MAX_PASSAGE_TOKENS + 2;

/** Passages are run together a few at a time; more only adds padding and memory (docs/research/embeddings-and-storage.md §1.1). */
const BATCH_SIZE = 8;

const SEP_TOKEN_ID = 102;

function parseJsonObject(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Scales a vector to length 1; a vector of zeros stays zeros. */
function normalized(values: Float32Array): Float32Array {
  let sum = 0;
  for (const value of values) sum += value * value;
  const length = Math.sqrt(sum);
  return length === 0 ? values : values.map((value) => value / length);
}

/** Names the model, its revision, its pooling, its normalization and the question instruction (`Embedder.modelId`). */
function modelIdOf(): string {
  const lock = readModelLock();
  const instruction = createHash("sha256").update(QUESTION_INSTRUCTION).digest("hex").slice(0, 8);
  return `${lock.repo}@${lock.revision.slice(0, 12)}|q8|cls|l2|i-${instruction}`;
}

/**
 * Loads the model and its tokenizer from the model directory. It throws, naming the missing file and
 * `npm run model:fetch`, when a pinned file is not there; whether the files are the pinned ones is
 * `npm run model:verify`'s check and is not repeated on every start.
 */
export async function loadOnnxEmbedder(options: OnnxEmbedderOptions): Promise<Embedder> {
  const lock = readModelLock();
  for (const file of lock.files) {
    if (!existsSync(join(options.modelPath, file.path))) {
      throw new Error(
        `The embedding model file ${file.path} is not in ${options.modelPath}. Run npm run model:fetch to download the pinned files.`,
      );
    }
  }
  const tokenizer = createTokenizer(
    parseJsonObject(join(options.modelPath, "tokenizer.json")),
    parseJsonObject(join(options.modelPath, "tokenizer_config.json")),
  );
  const session = await ort.InferenceSession.create(join(options.modelPath, MODEL_FILE), {
    executionProviders: ["cpu"],
    intraOpNumThreads: options.intraOpThreads,
    interOpNumThreads: 1,
  });

  /** Runs one batch and returns the unit-length CLS vector of each text. */
  async function runBatch(idLists: readonly (readonly number[])[]): Promise<Float32Array[]> {
    const width = Math.max(...idLists.map((ids) => ids.length));
    const ids = new BigInt64Array(idLists.length * width);
    const mask = new BigInt64Array(idLists.length * width);
    idLists.forEach((list, row) => {
      list.forEach((id, column) => {
        ids[row * width + column] = BigInt(id);
        mask[row * width + column] = 1n;
      });
    });
    const shape = [idLists.length, width];
    const output = await session.run({
      input_ids: new ort.Tensor("int64", ids, shape),
      attention_mask: new ort.Tensor("int64", mask, shape),
      token_type_ids: new ort.Tensor("int64", new BigInt64Array(idLists.length * width), shape),
    });
    const hidden = output["last_hidden_state"];
    if (hidden === undefined || hidden.type !== "float32")
      throw new Error("The model gave no float32 last_hidden_state");
    const data = hidden.data as Float32Array;
    // CLS pooling: the vector of each text's first token.
    return idLists.map((_, row) =>
      normalized(data.slice(row * width * VECTOR_DIMENSIONS, row * width * VECTOR_DIMENSIONS + VECTOR_DIMENSIONS)),
    );
  }

  return {
    modelId: modelIdOf(),
    maxPassageTokens: MAX_PASSAGE_TOKENS,
    countTokens: (text) => tokenizer.encode(text, { add_special_tokens: false }).ids.length,
    async embedPassages(texts) {
      const encoded = texts.map((text, index) => ({ index, ids: tokenizer.encode(text).ids }));
      for (const item of encoded) {
        if (item.ids.length > MODEL_INPUT_TOKENS) {
          throw new Error(`A passage is ${item.ids.length} tokens; the model reads at most ${MODEL_INPUT_TOKENS}`);
        }
      }
      // Texts of a length run together, so that a batch carries little padding; the vectors go back in order.
      encoded.sort((a, b) => a.ids.length - b.ids.length);
      const vectors: Float32Array[] = new Array<Float32Array>(texts.length);
      for (let from = 0; from < encoded.length; from += BATCH_SIZE) {
        const batch = encoded.slice(from, from + BATCH_SIZE);
        const results = await runBatch(batch.map((item) => item.ids));
        batch.forEach((item, row) => {
          vectors[item.index] = results[row] as Float32Array;
        });
      }
      return vectors;
    },
    async embedQuestion(text) {
      let ids = tokenizer.encode(`${QUESTION_INSTRUCTION}${text}`).ids;
      // A question longer than the model reads is cut, keeping [SEP] last, rather than refused.
      if (ids.length > MODEL_INPUT_TOKENS) ids = [...ids.slice(0, MODEL_INPUT_TOKENS - 1), SEP_TOKEN_ID];
      const [vector] = await runBatch([ids]);
      if (vector === undefined) throw new Error("The model gave no vector for the question");
      return vector;
    },
  };
}
