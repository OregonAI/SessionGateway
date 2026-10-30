import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultModelPath, modelLockPath, readModelLock } from "#/packages/embedder/lock.ts";
import { loadOnnxEmbedder } from "#/packages/embedder/onnx.ts";
import type { Embedder } from "#/packages/embedder/index.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");

/**
 * Where the pinned model's files are: MODEL_PATH when the environment sets it, else the directory
 * `npm run model:fetch` fills below the repository's `.cache/models`. Nothing is read from it here.
 */
export function modelPath(): string {
  return process.env["MODEL_PATH"] ?? defaultModelPath(readModelLock(), repositoryRoot);
}

/**
 * The real embedder, bge-small-en-v1.5 run on one thread, for the seam-1 tests of how well search
 * ranks. It fails with a message that names `npm run model:fetch` when the model's files are missing.
 */
export async function loadRealEmbedder(): Promise<Embedder> {
  const path = modelPath();
  const missing = readModelLock().files.filter((file) => !existsSync(join(path, file.path)));
  if (missing.length > 0) {
    throw new Error(
      `The embedding model is not in ${path} (missing ${missing.map((file) => file.path).join(", ")}). Run npm run model:fetch, then try again.`,
    );
  }
  return loadOnnxEmbedder({ modelPath: path, lockPath: modelLockPath, intraOpThreads: 1 });
}
