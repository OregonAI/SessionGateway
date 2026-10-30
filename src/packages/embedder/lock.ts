// The pinned embedding model: which Hugging Face repository, at which revision, and the sha256 of each
// file the service reads (docs/adr/0026-the-embedding-model-is-pinned-by-a-lock-file-and-run-with-onnxruntime-node.md;
// the file is data/model-lock.json). This entry point has no
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

function fail(path: string, problem: string): never {
  throw new Error(`The model lock at ${path} is not valid: ${problem}`);
}

function textField(path: string, record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || value === "") fail(path, `"${name}" must be a non-empty string`);
  return value;
}

function parseFile(path: string, value: unknown): ModelFile {
  if (typeof value !== "object" || value === null) fail(path, "each file must be an object");
  const record = value as Record<string, unknown>;
  const filePath = textField(path, record, "path");
  const bytes = record["bytes"];
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) {
    fail(path, `"${filePath}": "bytes" must be a count`);
  }
  const sha256 = textField(path, record, "sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail(path, `"${filePath}": "sha256" must be 64 lower-case hex digits`);
  if (filePath.startsWith("/") || filePath.split("/").includes("..")) {
    fail(path, `"${filePath}" must stay below the model directory`);
  }
  return { path: filePath, bytes, sha256 };
}

/**
 * Reads and checks the lock at `path`. It throws, naming what is wrong, when the file is not as this reader
 * expects. The path defaults to the committed lock for the scripts; the entry scripts pass it down.
 */
export function readModelLock(path: string = modelLockPath): ModelLock {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`The model lock at ${path} could not be read as JSON`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null) fail(path, "it must be an object");
  const record = parsed as Record<string, unknown>;
  const revision = textField(path, record, "revision");
  if (!/^[0-9a-f]{40}$/.test(revision)) fail(path, '"revision" must be a 40-digit commit id');
  const files = record["files"];
  if (!Array.isArray(files) || files.length === 0) fail(path, '"files" must list the pinned files');
  return {
    repo: textField(path, record, "repo"),
    revision,
    baseModel: textField(path, record, "baseModel"),
    baseModelLicense: textField(path, record, "baseModelLicense"),
    files: files.map((file) => parseFile(path, file)),
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
