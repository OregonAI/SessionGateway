// Verifies the committed snapshot fixture (test/fixtures/oregonai-snapshot/), the way
// scripts/fixture/verify.ts verifies the 2025R1 fixture, and needs no ERF checkout:
//   - snapshot.json is the file trim.json hashed, so it was not edited by hand;
//   - it parses as a snapshot, whose own checks cover duplicates and the table naming only known Agencies;
//   - the ORS chapters the 2025R1 fixture cites, read again from that fixture, are the ones trim.json
//     recorded, so a Measure added to the 2025R1 fixture that cites a new chapter fails here until the
//     snapshot fixture is rebuilt;
//   - the snapshot holds the sections of exactly the cited chapters it could, and exactly the Agencies
//     the fixture names or the table of a kept chapter lists.
// What a verify without the ERF checkout cannot see is whether the trim kept every section ERF has of a
// kept chapter; rebuilding from the checkout (see the folder's README.md) is what shows that.
//
//   node scripts/snapshot/verify.ts [<snapshot fixture folder>]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orsChaptersOf } from "#/packages/domain/oregonai.ts";
import { parseSnapshot } from "#/packages/oregonai-snapshot/index.ts";
import { agenciesNamedIn, citedOrsChapters, readFixtureTexts, trimRecordSchema } from "./touched.ts";

const folder = process.argv[2] ?? "test/fixtures/oregonai-snapshot";
const problems: string[] = [];

function same(what: string, found: readonly string[], recorded: readonly string[]): void {
  const left = [...found].sort();
  const right = [...recorded].sort();
  if (left.join("\n") !== right.join("\n")) {
    const missing = right.filter((item) => !left.includes(item));
    const extra = left.filter((item) => !right.includes(item));
    problems.push(
      `${what}: ${extra.length} not expected (${extra.slice(0, 5).join(", ")}), ${missing.length} missing (${missing.slice(0, 5).join(", ")})`,
    );
  }
}

try {
  const snapshotText = readFileSync(join(folder, "snapshot.json"), "utf8");
  const record = trimRecordSchema.parse(JSON.parse(readFileSync(join(folder, "trim.json"), "utf8")));
  if (createHash("sha256").update(snapshotText).digest("hex") !== record.snapshotSha256) {
    problems.push("snapshot.json is not the file trim.json hashed: it was edited, or rebuilt without its record");
  }
  const snapshot = parseSnapshot(JSON.parse(snapshotText));

  const texts = await readFixtureTexts(record.derivedFrom);
  const cited = citedOrsChapters(texts);
  same("the ORS chapters the fixture cites", cited, record.orsChaptersCited);

  const held: ReadonlySet<string> = orsChaptersOf(snapshot.orsSections);
  same(
    "the chapters the snapshot holds sections of",
    [...held],
    record.orsChaptersCited.filter((id) => !record.orsChaptersNotInSnapshot.includes(id)),
  );
  for (const id of record.orsChaptersNotInSnapshot) {
    if (held.has(id)) problems.push(`${id} is recorded as not in the snapshot, and the snapshot holds sections of it`);
  }

  const named = agenciesNamedIn(texts, snapshot.agencies);
  same("the Agencies the fixture names", named, record.agenciesNamedInText);
  same(
    "the Agencies kept",
    snapshot.agencies.map((agency) => agency.slug),
    [...new Set([...record.agenciesNamedInText, ...[...snapshot.chapterAgencies.values()].flat()])],
  );

  const kept = {
    agencies: snapshot.agencies.length,
    orsSections: snapshot.orsSections.length,
    chaptersWithAgencies: snapshot.chapterAgencies.size,
  };
  if (JSON.stringify(kept) !== JSON.stringify(record.kept)) {
    problems.push(
      `trim.json says it kept ${JSON.stringify(record.kept)} and the snapshot holds ${JSON.stringify(kept)}`,
    );
  }

  if (problems.length === 0) {
    console.log(
      `verify: OK ${folder}: version ${snapshot.version.commit.slice(0, 7)} (${snapshot.version.commitDate}), ${kept.agencies} of ${record.of.agencies} agencies, ${kept.orsSections} of ${record.of.orsSections} ORS sections, ${kept.chaptersWithAgencies} of ${record.of.chaptersWithAgencies} chapters with agencies, ${cited.length} chapters cited by ${record.derivedFrom}`,
    );
  }
} catch (error) {
  problems.push(
    error instanceof Error
      ? `${error.message}${error.cause instanceof Error ? ` (${error.cause.message})` : ""}`
      : String(error),
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`verify: FAIL ${folder}: ${problem}`);
  console.error(
    "verify: rebuild the fixture from an ERF checkout, as the folder's README.md says; never edit it by hand",
  );
  process.exit(1);
}
