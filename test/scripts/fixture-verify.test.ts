// The fixture verify script (scripts/fixture/verify.ts), run as a child process the way
// `npm run fixture:verify` runs it, against a temporary copy of the committed 2025R1 fixture.
//
// Like snapshot-build.test.ts, this is not one of the four agreed seams (test/CLAUDE.md): no MCP
// tool shows what the fixture build recorded, so the script's command line is the only place the
// ticket's box "fixture:verify accepts a non-Legislator committee member" can be seen. It follows
// that file's pattern and is a PROVISIONAL seam in the same way: approved by the owner in the
// comment on #87 of 2026-11-02, and deliberately not added to test/CLAUDE.md's list of agreed seams.
// The copy links every committed file and replaces two: feed/CommitteeMembers.json (one row
// added) and unresolved.json.
//
// The added member is MADE UP ("Made Up Task Force Member"), put in HALNRW, a committee the fixture
// keeps. The reasons are literals copied from scripts/fixture/schema.ts (legislatorGapReason and
// nonLegislatorMemberReason), which cite docs/research/olis-odata.md section 8, gotchas 4 and 5.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const committed = resolve("test/fixtures/olis-2025R1");
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const gotcha4Reason =
  "No Legislators row with this LegislatorCode in the full 2025R1 feed cache: Legislators is a current snapshot (docs/research/olis-odata.md section 8, gotcha 4).";
const gotcha5Reason =
  "No Legislators row with this LegislatorCode in the full 2025R1 feed cache: the member is no Legislator but a member of a task force, whose LegislatorCode is a personal name (docs/research/olis-odata.md section 8, gotcha 5).";

const madeUpMember = (code: string) => ({
  SessionKey: "2025R1",
  CommitteeCode: "HALNRW",
  LegislatorCode: code,
  Title: "Member",
  CreatedDate: "2025-04-21T17:22:14",
  ModifiedDate: null,
});

function entryFor(reason: string, code = "Made Up Task Force Member"): Record<string, unknown> {
  return {
    entity_set: "CommitteeMembers",
    row_key: {
      CommitteeCode: "HALNRW",
      CreatedDate: "2025-04-21T17:22:14",
      Title: "Member",
      LegislatorCode: code,
    },
    property: "LegislatorCode",
    refers_to: "Legislators",
    target_key: { SessionKey: "2025R1", LegislatorCode: code },
    reason,
  };
}

/** A copy of the committed fixture with the made-up member added, and these entries added to unresolved.json. */
function fixtureWithMadeUpMember(entries: Record<string, unknown>[], code = "Made Up Task Force Member"): string {
  const directory = mkdtempSync(join(tmpdir(), "fixture-verify-"));
  cleanups.push(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  for (const name of readdirSync(committed))
    if (name !== "feed" && name !== "unresolved.json") symlinkSync(join(committed, name), join(directory, name));
  mkdirSync(join(directory, "feed"));
  for (const name of readdirSync(join(committed, "feed")))
    if (name === "CommitteeMembers.json") {
      const rows = JSON.parse(readFileSync(join(committed, "feed", name), "utf8")) as unknown[];
      writeFileSync(join(directory, "feed", name), JSON.stringify([...rows, madeUpMember(code)]));
    } else copyFileSync(join(committed, "feed", name), join(directory, "feed", name));
  const listed = JSON.parse(readFileSync(join(committed, "unresolved.json"), "utf8")) as { unresolved: unknown[] };
  writeFileSync(join(directory, "unresolved.json"), JSON.stringify({ unresolved: [...listed.unresolved, ...entries] }));
  return directory;
}

function verify(fixture: string): { status: number | null; stdout: string; stderr: string } {
  const finished = spawnSync(process.execPath, ["scripts/fixture/verify.ts", "--fixture", fixture], {
    env: { PATH: process.env["PATH"] ?? "", TZ: process.env["TZ"] ?? "UTC" },
    encoding: "utf8",
  });
  return { status: finished.status, stdout: finished.stdout, stderr: finished.stderr };
}

describe("fixture:verify and a committee member who is no Legislator", () => {
  it("accepts the member's row when unresolved.json lists it with gotcha 5's reason", () => {
    const finished = verify(fixtureWithMadeUpMember([entryFor(gotcha5Reason)]));
    expect(finished.stderr).toBe("");
    expect(finished.status).toBe(0);
  });

  it("refuses the same entry when it carries gotcha 4's reason, which is about Legislators being a snapshot", () => {
    const finished = verify(fixtureWithMadeUpMember([entryFor(gotcha4Reason)]));
    expect(finished.status).toBe(1);
    expect(finished.stderr).toContain("is not a documented gap");
  });

  it("refuses the member's row when unresolved.json does not list it", () => {
    const finished = verify(fixtureWithMadeUpMember([]));
    expect(finished.status).toBe(1);
    expect(finished.stderr).toContain("Made Up Task Force Member");
    expect(finished.stderr).toContain("is not in the fixture, but 1 row(s) refer to it");
  });

  it("refuses a member whose code starts \"Rep \" even with gotcha 5's reason, because gotcha 5 covers no legislator's code", () => {
    const code = "Rep Made Up";
    const finished = verify(fixtureWithMadeUpMember([entryFor(gotcha5Reason, code)], code));
    expect(finished.status).toBe(1);
    expect(finished.stderr).toContain("is not a documented gap");
  });
});
