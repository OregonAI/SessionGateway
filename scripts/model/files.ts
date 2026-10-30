// What the two model scripts share: where the pinned files are kept and how one is checked against the
// lock (src/packages/embedder/data/model-lock.json). Dependency-free: node: built-ins and the lock's reader.
import { join } from "node:path";
import { env } from "node:process";
import {
  defaultModelPath,
  modelFileProblem,
  type ModelFile,
  type ModelLock,
} from "../../src/packages/embedder/lock.ts";

const repositoryRoot = join(import.meta.dirname, "..", "..");

/** MODEL_PATH when the environment sets it, else `.cache/models/<repo>/<revision>` below the repository. */
export function modelDirectory(lock: ModelLock): string {
  return env["MODEL_PATH"] ?? defaultModelPath(lock, repositoryRoot);
}

/** Why a file does not match the lock, naming it, or undefined when it does. */
export async function problemWith(directory: string, file: ModelFile): Promise<string | undefined> {
  const problem = await modelFileProblem(directory, file);
  if (problem === undefined) return undefined;
  switch (problem.kind) {
    case "missing":
      return `MISSING ${file.path}: not found at ${join(directory, file.path)}`;
    case "size":
      return `MISMATCH ${file.path}: ${problem.actual} bytes, the lock pins ${file.bytes}`;
    case "sha256":
      return `MISMATCH ${file.path}: sha256 ${problem.actual}, the lock pins ${file.sha256}`;
    default:
      return problem satisfies never;
  }
}
