// The pinned embedding model: which Hugging Face repository, at which revision, and the sha256 of each
// file the service reads (docs/adr/0025-...; the file is data/model-lock.json). This entry point has no
// dependency but node: built-ins, because `scripts/model/fetch.ts` and `scripts/model/verify.ts` run
// without `npm ci` and read the lock through it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ModelFile = {
  /** The file's path below the model directory, with `/` separators: "onnx/model_quantized.onnx". */
  path: string;
  bytes: number;
  sha256: string;
};

export type ModelLock = {
  /** The Hugging Face repository the files are fetched from: "Xenova/bge-small-en-v1.5". */
  repo: string;
  /** The commit of that repository the files are pinned to. */
  revision: string;
  /** The model the repository converts, whose licence applies: "BAAI/bge-small-en-v1.5". */
  baseModel: string;
  baseModelLicense: string;
  files: ModelFile[];
};

/** Where the lock is committed. */
export const modelLockPath: string = join(import.meta.dirname, "data", "model-lock.json");

function fail(problem: string): never {
  throw new Error(`The model lock at ${modelLockPath} is not valid: ${problem}`);
}

function textField(record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || value === "") fail(`"${name}" must be a non-empty string`);
  return value;
}

function parseFile(value: unknown): ModelFile {
  if (typeof value !== "object" || value === null) fail("each file must be an object");
  const record = value as Record<string, unknown>;
  const path = textField(record, "path");
  const bytes = record["bytes"];
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) fail(`"${path}": "bytes" must be a count`);
  const sha256 = textField(record, "sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail(`"${path}": "sha256" must be 64 lower-case hex digits`);
  if (path.startsWith("/") || path.split("/").includes("..")) fail(`"${path}" must stay below the model directory`);
  return { path, bytes, sha256 };
}

/** Reads and checks the lock. It throws, naming what is wrong, when the file is not as this reader expects. */
export function readModelLock(path: string = modelLockPath): ModelLock {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) fail("it must be an object");
  const record = parsed as Record<string, unknown>;
  const revision = textField(record, "revision");
  if (!/^[0-9a-f]{40}$/.test(revision)) fail('"revision" must be a 40-digit commit id');
  const files = record["files"];
  if (!Array.isArray(files) || files.length === 0) fail('"files" must list the pinned files');
  return {
    repo: textField(record, "repo"),
    revision,
    baseModel: textField(record, "baseModel"),
    baseModelLicense: textField(record, "baseModelLicense"),
    files: files.map(parseFile),
  };
}

/** The directory a lock's files are kept in below `cacheRoot`: `Xenova--bge-small-en-v1.5/<revision>`. */
export function modelDirectoryName(lock: ModelLock): string {
  return join(lock.repo.replaceAll("/", "--"), lock.revision);
}

/** Where the files of a lock are downloaded by default, below the repository's `.cache/models`. */
export function defaultModelPath(lock: ModelLock, repositoryRoot: string): string {
  return join(repositoryRoot, ".cache", "models", modelDirectoryName(lock));
}

/** The URL one pinned file is fetched from: Hugging Face's `resolve` address at the pinned revision. */
export function modelFileUrl(lock: ModelLock, file: ModelFile): URL {
  return new URL(`https://huggingface.co/${lock.repo}/resolve/${lock.revision}/${file.path}`);
}
