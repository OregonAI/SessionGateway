// Builds the OregonAI snapshot (spec #1, module 6; ADR-0004) from a local checkout of OregonAI's
// executive-regulatory-frameworks repository, and writes it as one JSON file. Run by an operator when
// a database is built, with the checkout's path as an argument. The path is never in the code, the
// checkout is only read, and nothing here uses the network.
//
//   node scripts/snapshot/build.ts --erf <checkout of executive-regulatory-frameworks> --out <snapshot.json>
//
// With --trim-to <the 2025R1 fixture> --trim-record <trim.json> it writes the trimmed copy that is
// committed as the test fixture instead, cut down to what that fixture touches (touched.ts), and a
// record of what was kept.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { parseSnapshot } from "#/packages/oregonai-snapshot/index.ts";
import { readErfSnapshot } from "./erf.ts";
import { readFixtureTexts, trimSnapshot, type TrimRecord } from "./touched.ts";

const usage =
  "usage: node scripts/snapshot/build.ts --erf <checkout of executive-regulatory-frameworks> --out <snapshot.json> [--trim-to <olis fixture> --trim-record <trim.json>]";

function fail(error: unknown): never {
  let message = "";
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    message += `${message === "" ? "" : "\n  caused by: "}${current.message}`;
  }
  console.error(`build: ${message === "" ? String(error) : message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    erf: { type: "string" },
    out: { type: "string" },
    "trim-to": { type: "string" },
    "trim-record": { type: "string" },
  },
  strict: true,
});
const fixture = values["trim-to"];
const recordPath = values["trim-record"];
if (values.erf === undefined || values.out === undefined || (fixture === undefined) !== (recordPath === undefined)) {
  console.error(usage);
  process.exit(2);
}

try {
  const full = readErfSnapshot(values.erf);
  const trim = fixture === undefined ? undefined : trimSnapshot(full, await readFixtureTexts(fixture));
  const snapshot = trim?.trimmed ?? full;
  parseSnapshot(snapshot);
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, text);
  if (trim !== undefined && fixture !== undefined && recordPath !== undefined) {
    const record: TrimRecord = {
      derivedFrom: fixture,
      ...trim.record,
      snapshotSha256: createHash("sha256").update(text).digest("hex"),
    };
    mkdirSync(dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  }
  console.log(
    `build: wrote ${values.out}: ${snapshot.agencies.length} agencies, ${snapshot.orsSections.length} ORS sections, ${Object.keys(snapshot.chapterAgencies).length} chapters with agencies; version ${snapshot.version.commit} (${snapshot.version.commitDate})`,
  );
} catch (error) {
  fail(error);
}
