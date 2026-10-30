import { readModelLock, type ModelLock } from "../lock.ts";
import type { Embedder, EmbedderFiles, ModelRunner } from "../index.ts";
import { createEmbedder } from "./embedder.ts";
import { checkModelFiles, loadTokenizer } from "./files.ts";

/**
 * Loads the lock, checks every file it pins in the model directory against its sha256, reads the model's
 * tokenizer there, starts a runner for the model, and makes the embedder of the two. The tokenizer is the model's own whatever the runner is, so that passages are
 * cut at the same places in production and in a test whose runner is a fake.
 */
export async function loadEmbedder(
  files: EmbedderFiles,
  startRunner: (modelPath: string, lock: ModelLock) => Promise<ModelRunner>,
): Promise<Embedder> {
  const lock = readModelLock(files.lockPath);
  await checkModelFiles(files.modelPath, lock);
  const tokenizer = loadTokenizer(files.modelPath);
  return createEmbedder(tokenizer, await startRunner(files.modelPath, lock));
}
