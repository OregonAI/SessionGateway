// Seam 1 (test/CLAUDE.md): the worker reads the feed's CommitteeMembers and keeps every row, though the set's
// declared key (CommitteeCode, CreatedDate, Title) is not unique (docs/research/olis-odata.md section 8, gotcha 5).
// No tool shows the set yet, so a case reads what the operator reads: the counts in build-report.json and the
// Unresolved Legislator Codes of the pull.
//
// The committed fixture has no CommitteeMembers (test/fixtures/olis-2025R1/README.md says why), so every row here is
// MADE UP, added to the fake OLIS after the first pull with `addRows`. Two of them share a declared key as Rep Helm
// and Rep Owens do for HALNRW in the full cache ("HALNRW", "2024-12-30T15:22:02", "Co-Chair"), and the third is a
// task-force member who is no Legislator, as the cache's JOCSS has ("Shanbo Zhang").
import { afterEach, describe, expect, it } from "vitest";
import { startSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 2026-08-01 10:00 in Oregon: the committee members were all created before it.
const clockAt = "2026-08-01T17:00:00Z";

function madeUpMember(row: { code: string; title: string; createdDate: string; legislatorCode: string }) {
  return {
    SessionKey: "2025R1",
    CommitteeCode: row.code,
    LegislatorCode: row.legislatorCode,
    Title: row.title,
    CreatedDate: row.createdDate,
    ModifiedDate: null,
  };
}

const helm = madeUpMember({
  code: "HALNRW",
  title: "Co-Chair",
  createdDate: "2024-12-30T15:22:02",
  legislatorCode: "Rep Helm",
});
const owens = { ...helm, LegislatorCode: "Rep Owens" };
const taskForceMember = madeUpMember({
  code: "JOCSS",
  title: "Member",
  createdDate: "2025-05-30T16:19:00",
  legislatorCode: "Made Up Person",
});

async function startWithMembers(): Promise<System> {
  const system = await startSystem({ clockAt });
  started.push(system);
  system.olis.addRows("CommitteeMembers", [helm, owens, taskForceMember]);
  return system;
}

type SetReport = { entity_set: string; counted: number; read: number; listed: number; no_longer_listed: number };
function committeeMembersOf(system: System): SetReport | undefined {
  const pull = system.buildReport()["pull"] as { entity_sets: SetReport[] };
  return pull.entity_sets.find((set) => set.entity_set === "CommitteeMembers");
}

describe("CommitteeMembers rows that share a declared key", () => {
  it("are all kept: the build report counts three rows read and three listed", async () => {
    const system = await startWithMembers();

    await system.pullAgain();

    expect(committeeMembersOf(system)).toEqual({
      entity_set: "CommitteeMembers",
      counted: 3,
      read: 3,
      complete: true,
      listed: 3,
      no_longer_listed: 0,
    });
  });

  it("go on the build report as unresolved when the code names no Legislator, and are not an error", async () => {
    const system = await startWithMembers();

    const pull = await system.pullAgain();

    expect(pull.unresolvedLegislatorCodes).toEqual([
      { code: "Made Up Person", references: [{ source: "CommitteeMembers", count: 1 }] },
    ]);
  });

  // The two-pull rule (ADR-0005) is by the whole row: Rep Owens's row stops being listed after two complete pulls,
  // and Rep Helm's, which has the same declared key, is listed all the same.
  it("fall under the two-pull rule row by row", async () => {
    const system = await startWithMembers();
    await system.pullAgain();

    stopListing(system.olis, "CommitteeMembers", (row) => row["LegislatorCode"] === "Rep Owens");
    await system.pullAgain();
    expect(committeeMembersOf(system)).toMatchObject({ counted: 2, read: 2, listed: 3, no_longer_listed: 0 });
    await system.pullAgain();

    expect(committeeMembersOf(system)).toMatchObject({ counted: 2, read: 2, listed: 2, no_longer_listed: 1 });
  });
});
