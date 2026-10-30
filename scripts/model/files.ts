// What the two model scripts share: where the pinned files are kept and how one is checked against the
// lock (src/packages/embedder/data/model-lock.json). Dependency-free: node: built-ins and the lock's reader.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { defaultModelPath, type ModelFile, type ModelLock } from "../../src/packages/embedder/lock.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");

/** MODEL_PATH when the environment sets it, else `.cache/models/<repo>/<revision>` below the repository. */
export function modelDirectory(lock: ModelLock): string {
  return env["MODEL_PATH"] ?? defaultModelPath(lock, repositoryRoot);
}

/** The sha256 of a file, read as a stream so a 34 MB model is not held in memory. */
export async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Why a file does not match the lock, naming it, or undefined when it does. */
export async function problemWith(directory: string, file: ModelFile): Promise<string | undefined> {
  const path = join(directory, file.path);
  if (!existsSync(path)) return `MISSING ${file.path}: not found at ${path}`;
  const size = statSync(path).size;
  if (size !== file.bytes) return `MISMATCH ${file.path}: ${size} bytes, the lock pins ${file.bytes}`;
  const actual = await sha256Of(path);
  if (actual !== file.sha256) return `MISMATCH ${file.path}: sha256 ${actual}, the lock pins ${file.sha256}`;
  return undefined;
}
