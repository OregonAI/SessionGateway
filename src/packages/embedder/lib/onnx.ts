import { join } from "node:path";
import * as ort from "onnxruntime-node";
import type { ModelLock } from "../lock.ts";
import { VECTOR_DIMENSIONS, type Embedder, type EmbedderFiles, type ModelRunner } from "../index.ts";
import { questionInstructionId } from "./embedder.ts";
import { loadEmbedder } from "./load.ts";

export type OnnxEmbedderOptions = EmbedderFiles & {
  /**
   * How many threads one model run may use. The server uses one, because the deploy box has two cores
   * shared with seven corpora; the worker takes the number the deployment sets (MODEL_THREADS).
   */
  intraOpThreads: number;
};

/** The model file inside the model directory. The other files are named by the lock. */
const MODEL_FILE = "onnx/model_quantized.onnx";

/** Scales a vector to length 1; a vector of zeros stays zeros. */
function normalized(values: Float32Array): Float32Array {
  let sum = 0;
  for (const value of values) sum += value * value;
  const length = Math.sqrt(sum);
  return length === 0 ? values : values.map((value) => value / length);
}

/** Names the model, its revision, its pooling, its normalization and the question instruction (`Embedder.modelId`). */
function modelIdOf(lock: ModelLock): string {
  return `${lock.repo}@${lock.revision.slice(0, 12)}|q8|cls|l2|i-${questionInstructionId}`;
}

/** The ONNX session of the q8 model: CLS pooling (the vector of the first token), then L2 normalization. */
async function startOnnxRunner(modelPath: string, lock: ModelLock, intraOpThreads: number): Promise<ModelRunner> {
  const session = await ort.InferenceSession.create(join(modelPath, MODEL_FILE), {
    executionProviders: ["cpu"],
    intraOpNumThreads: intraOpThreads,
    interOpNumThreads: 1,
  });
  return {
    modelId: modelIdOf(lock),
    async run(ids) {
      const shape = [1, ids.length];
      const output = await session.run({
        input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), shape),
        attention_mask: new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape),
        token_type_ids: new ort.Tensor("int64", new BigInt64Array(ids.length), shape),
      });
      const hidden = output["last_hidden_state"];
      if (hidden === undefined || hidden.type !== "float32")
        throw new Error("The model gave no float32 last_hidden_state");
      return normalized((hidden.data as Float32Array).slice(0, VECTOR_DIMENSIONS));
    },
  };
}

/**
 * Loads the model and its tokenizer from the model directory, after checking every file the lock pins against
 * its sha256. It throws, naming each file that is missing or is not the pinned one, MODEL_PATH and
 * `npm run model:fetch`, and never the directory.
 */
export function loadOnnxEmbedder(options: OnnxEmbedderOptions): Promise<Embedder> {
  return loadEmbedder(options, (modelPath, lock) => startOnnxRunner(modelPath, lock, options.intraOpThreads));
}
