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

  /**
   * Runs the model on one text and returns its unit-length CLS vector. A text is always run alone: the quantized
   * model scales its activations over the whole tensor it is given, so the vector of a text run with others
   * differs a little from its vector alone, and a vector that is kept under the hash of its text and reused
   * (ADR-0025) must be a function of that text and nothing else. On one thread batching gains no speed, and
   * it raises the peak memory with the padding and the activations of the batch.
   */
  async function runModel(ids: readonly number[]): Promise<Float32Array> {
    const shape = [1, ids.length];
    const output = await session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), shape),
      attention_mask: new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape),
      token_type_ids: new ort.Tensor("int64", new BigInt64Array(ids.length), shape),
    });
    const hidden = output["last_hidden_state"];
    if (hidden === undefined || hidden.type !== "float32")
      throw new Error("The model gave no float32 last_hidden_state");
    // CLS pooling: the vector of the first token.
    return normalized((hidden.data as Float32Array).slice(0, VECTOR_DIMENSIONS));
  }

  return {
    modelId: modelIdOf(),
    maxPassageTokens: MAX_PASSAGE_TOKENS,
    countTokens: (text) => tokenizer.encode(text, { add_special_tokens: false }).ids.length,
    async embedPassages(texts) {
      const vectors: Float32Array[] = [];
      for (const text of texts) {
        const ids = tokenizer.encode(text).ids;
        if (ids.length > MODEL_INPUT_TOKENS) {
          throw new Error(`A passage is ${ids.length} tokens; the model reads at most ${MODEL_INPUT_TOKENS}`);
        }
        vectors.push(await runModel(ids));
      }
      return vectors;
    },
    async embedQuestion(text) {
      let ids = tokenizer.encode(`${QUESTION_INSTRUCTION}${text}`).ids;
      // A question longer than the model reads is cut, keeping [SEP] last, rather than refused.
      if (ids.length > MODEL_INPUT_TOKENS) ids = [...ids.slice(0, MODEL_INPUT_TOKENS - 1), SEP_TOKEN_ID];
      return runModel(ids);
    },
  };
}
