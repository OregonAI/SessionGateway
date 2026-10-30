// Builds the OregonAI snapshot (spec #1, module 6; ADR-0004) from a local checkout of OregonAI's
// executive-regulatory-frameworks repository, and writes it as one JSON file. Run by an operator when
// a database is built, with the checkout's path as an argument. The path is never in the code, the
// checkout is only read, and nothing here uses the network.
//
//   node scripts/snapshot/build.ts --erf <checkout of executive-regulatory-frameworks> --out <snapshot.json>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { readErfSnapshot } from "./erf.ts";

const usage =
  "usage: node scripts/snapshot/build.ts --erf <checkout of executive-regulatory-frameworks> --out <snapshot.json>";

function fail(error: unknown): never {
  let message = "";
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    message += `${message === "" ? "" : "\n  caused by: "}${current.message}`;
  }
  console.error(`build: ${message === "" ? String(error) : message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: { erf: { type: "string" }, out: { type: "string" } },
  strict: true,
});
if (values.erf === undefined || values.out === undefined) {
  console.error(usage);
  process.exit(2);
}

try {
  const snapshot = readErfSnapshot(values.erf);
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `build: wrote ${values.out}: ${snapshot.agencies.length} agencies, ${snapshot.orsSections.length} ORS sections, ${Object.keys(snapshot.chapterAgencies).length} chapters with agencies; version ${snapshot.version.commit} (${snapshot.version.commitDate})`,
  );
} catch (error) {
  fail(error);
}
