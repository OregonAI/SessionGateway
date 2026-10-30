// Checks that the pinned embedding model is on disk, offline.
//
//   node scripts/model/verify.ts
//
// Reads src/packages/embedder/data/model-lock.json and checks each file under the model directory
// (MODEL_PATH when it is set, else .cache/models/<repo>/<revision> below the repository): it must
// exist, have the pinned size and have the pinned sha256. Every problem is printed with the file's
// name, and the exit status is 1. It sends no request. `npm run model:fetch` downloads what is
// missing. Dependency-free: node: built-ins and relative .ts files only.
import { argv, exit } from "node:process";
import { readModelLock } from "../../src/packages/embedder/lock.ts";
import { modelDirectory, problemWith } from "./files.ts";

if (argv.length > 2) {
  console.error("usage: node scripts/model/verify.ts");
  exit(2);
}

const lock = readModelLock();
const directory = modelDirectory(lock);
const problems: string[] = [];
for (const file of lock.files) {
  const problem = await problemWith(directory, file);
  if (problem !== undefined) problems.push(problem);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`model:verify: ${problem}`);
  console.error(`model:verify: ${problems.length} of ${lock.files.length} files are wrong; run npm run model:fetch`);
  exit(1);
}
console.log(
  `verify: ${lock.repo}@${lock.revision.slice(0, 7)}, ${lock.files.length} files, sizes and sha256 match the lock`,
);
