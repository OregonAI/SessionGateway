// Downloads the pinned embedding model.
//
//   node scripts/model/fetch.ts
//
// Reads src/packages/embedder/data/model-lock.json and, for each file, checks the copy under the model
// directory (MODEL_PATH when it is set, else .cache/models/<repo>/<revision> below the repository).
// A file that is there with the pinned size and sha256 is left alone and no request is sent for it, so
// a run with every file present and verified touches no network. Any other file is downloaded from
// https://huggingface.co/<repo>/resolve/<revision>/<path> into a `.partial` file, checked against the
// lock, and moved into place only if it matches: a download that does not match is deleted and the run
// fails naming the file. CI runs this before `npm run check`; nothing in `npm test` does.
// Dependency-free: node: built-ins and relative .ts files only.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { modelFileUrl, readModelLock, type ModelFile, type ModelLock } from "../../src/packages/embedder/lock.ts";
import { modelDirectory, problemWith } from "./files.ts";

/** Streams one file into `destination` and returns its size and sha256. */
async function download(url: URL, destination: string): Promise<{ bytes: number; sha256: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok || response.body === null) {
    throw new Error(`${url.href} answered ${response.status} ${response.statusText}`);
  }
  const hash = createHash("sha256");
  let bytes = 0;
  const out = createWriteStream(destination);
  const source = Readable.fromWeb(response.body);
  source.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
  });
  source.pipe(out);
  await finished(out);
  return { bytes, sha256: hash.digest("hex") };
}

/** Fetches one file that is missing or wrong, and throws naming it if what arrives is not what the lock pins. */
async function fetchFile(lock: ModelLock, directory: string, file: ModelFile): Promise<void> {
  const destination = join(directory, file.path);
  const partial = `${destination}.partial`;
  await mkdir(dirname(destination), { recursive: true });
  const url = modelFileUrl(lock, file);
  try {
    const got = await download(url, partial);
    if (got.bytes !== file.bytes || got.sha256 !== file.sha256) {
      throw new Error(
        `${file.path}: downloaded ${got.bytes} bytes with sha256 ${got.sha256}; the lock pins ${file.bytes} bytes and ${file.sha256}`,
      );
    }
    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

/** An error's message with its cause's, since fetch reports a refused connection only as "fetch failed". */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

if (argv.length > 2) {
  console.error("usage: node scripts/model/fetch.ts");
  exit(2);
}

const lock = readModelLock();
const directory = modelDirectory(lock);
let present = 0;
let downloaded = 0;
for (const file of lock.files) {
  if ((await problemWith(directory, file)) === undefined) {
    present += 1;
    continue;
  }
  console.log(`fetch: ${file.path} is missing or wrong; downloading ${modelFileUrl(lock, file).href}`);
  try {
    await fetchFile(lock, directory, file);
  } catch (error) {
    console.error(`model:fetch: could not fetch ${file.path}: ${describe(error)}`);
    exit(1);
  }
  downloaded += 1;
}
console.log(
  `fetch: ${lock.repo}@${lock.revision.slice(0, 7)}, ${lock.files.length} files in ${directory}: ${present} already present and verified, ${downloaded} downloaded`,
);
