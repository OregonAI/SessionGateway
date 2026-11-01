// Seam 1 (test/CLAUDE.md): the worker reads the feed's CommitteeMembers and keeps every row, though the set's
// declared key (CommitteeCode, CreatedDate, Title) is not unique (docs/research/olis-odata.md section 8, gotcha 5).
// No tool shows the set yet, so a case reads what the operator reads: the counts in build-report.json and the
// Unresolved Legislator Codes of the pull.
//
// The committed fixture holds the 99 CommitteeMembers rows of its 12 committees, taken from the cache (ticket #81), so
// the cases about shared keys name REAL rows: Rep Helm and Rep Owens, Co-Chairs of HALNRW from one instant
// ("HALNRW", "2024-12-30T15:22:02", "Co-Chair"). The one MADE UP
// row is the task-force member who is no Legislator ("Made Up Person" in JOCSS, a committee the fixture lacks): the
// fixture holds no such member on purpose (its README says why), and the unresolved path needs one.
import { afterEach, describe, expect, it } from "vitest";
import { startSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 2026-08-01 10:00 in Oregon: the committee members were all created before it.
const clockAt = "2026-08-01T17:00:00Z";

// MADE UP: a member of a task force who is no Legislator, as the cache's JOCSS has (olis-odata.md gotcha 5). Added after the first pull with `addRows`.
const taskForceMember = {
  SessionKey: "2025R1",
  CommitteeCode: "JOCSS",
  LegislatorCode: "Made Up Person",
  Title: "Member",
  CreatedDate: "2025-05-30T16:19:00",
  ModifiedDate: null,
};

async function start(): Promise<System> {
  const system = await startSystem({ clockAt });
  started.push(system);
  return system;
}

type SetReport = { entity_set: string; counted: number; read: number; listed: number; no_longer_listed: number };
function committeeMembersOf(system: System): SetReport | undefined {
  const pull = system.buildReport()["pull"] as { entity_sets: SetReport[] };
  return pull.entity_sets.find((set) => set.entity_set === "CommitteeMembers");
}

type StoredReport = {
  committee_code: string;
  rows_stored: number;
  legislator_codes: string[];
  unresolved_legislator_codes: string[];
};
function storedMembersOf(system: System): StoredReport[] {
  return system.buildReport()["committee_members"] as StoredReport[];
}

describe("CommitteeMembers rows that share a declared key", () => {
  // The box is about what the index keeps, so it is read from what the table holds: for each committee, the rows it
  // stored (build-report.json), each by the Legislator Code the feed wrote, ordered by code. The expected lists are
  // HALNRW's nine rows in the cache's CommitteeMembers.json; a table keyed by the declared key stores one of the two
  // Co-Chairs (and one of the six Members, which share ("HALNRW", "2024-12-30T15:22:02", "Member") too) and this fails.
  it("are all stored: HALNRW's two Co-Chairs from one instant, Rep Helm and Rep Owens, are both in the build report", async () => {
    const system = await start();

    const halnrw = storedMembersOf(system).find((committee) => committee.committee_code === "HALNRW");

    expect(halnrw).toEqual({
      committee_code: "HALNRW",
      rows_stored: 9,
      legislator_codes: [
        "Rep Boice",
        "Rep Hartman",
        "Rep Helm",
        "Rep Levy B",
        "Rep Marsh",
        "Rep McDonald",
        "Rep McLain",
        "Rep Owens",
        "Rep Scharf",
      ],
      unresolved_legislator_codes: [],
    });
  });

  // 99 rows in the cache's CommitteeMembers.json for the fixture's 12 committees, 20 declared keys shared by 72 of them.
  it("are all read and listed: the build report counts the fixture's 99 rows read and 99 listed", async () => {
    const system = await start();

    expect(committeeMembersOf(system)).toEqual({
      entity_set: "CommitteeMembers",
      counted: 99,
      read: 99,
      complete: true,
      listed: 99,
      no_longer_listed: 0,
    });
    const stored = storedMembersOf(system);
    expect(stored.map((committee) => committee.committee_code)).toEqual([
      "HALNRW",
      "HECHS",
      "HHED",
      "HLWS",
      "HRULES",
      "JCTE",
      "JWM",
      "SED",
      "SFR",
      "SHS",
      "SLB",
      "SRULES",
    ]);
    expect(stored.map((committee) => committee.rows_stored)).toEqual([9, 9, 7, 7, 7, 12, 23, 5, 5, 5, 5, 5]);
  });

  it("are every one a Legislator: no Unresolved Legislator Code comes from the real rows", async () => {
    const system = await start();

    for (const committee of storedMembersOf(system)) expect(committee.unresolved_legislator_codes).toEqual([]);
    const pull = await system.pullAgain();
    expect(
      pull.unresolvedLegislatorCodes.filter((entry) =>
        entry.references.some((reference) => reference.source === "CommitteeMembers"),
      ),
    ).toEqual([]);
  });

  // MADE UP row: the fixture has no member who is no Legislator.
  it("go on the build report as unresolved when the code names no Legislator, and are not an error", async () => {
    const system = await start();
    system.olis.addRows("CommitteeMembers", [taskForceMember]);

    const pull = await system.pullAgain();

    expect(pull.unresolvedLegislatorCodes).toEqual([
      { code: "Made Up Person", references: [{ source: "CommitteeMembers", count: 1 }] },
    ]);
    expect(storedMembersOf(system).find((committee) => committee.committee_code === "JOCSS")).toEqual({
      committee_code: "JOCSS",
      rows_stored: 1,
      legislator_codes: ["Made Up Person"],
      unresolved_legislator_codes: ["Made Up Person"],
    });
    expect(committeeMembersOf(system)).toMatchObject({ counted: 100, read: 100, listed: 100 });
  });

  // The two-pull rule (ADR-0005) is by the whole row: Rep Owens's HALNRW Co-Chair row stops being listed after two
  // complete pulls, and Rep Helm's, which has the same declared key, is listed all the same.
  it("fall under the two-pull rule row by row", async () => {
    const system = await start();

    stopListing(
      system.olis,
      "CommitteeMembers",
      (row) => row["CommitteeCode"] === "HALNRW" && row["LegislatorCode"] === "Rep Owens",
    );
    await system.pullAgain();
    expect(committeeMembersOf(system)).toMatchObject({ counted: 98, read: 98, listed: 99, no_longer_listed: 0 });
    await system.pullAgain();

    expect(committeeMembersOf(system)).toMatchObject({ counted: 98, read: 98, listed: 98, no_longer_listed: 1 });
    expect(
      storedMembersOf(system).find((committee) => committee.committee_code === "HALNRW")?.legislator_codes,
    ).toContain("Rep Helm");
  });
});
