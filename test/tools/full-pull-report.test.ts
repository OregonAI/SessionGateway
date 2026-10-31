// Seam 1 (test/CLAUDE.md): what the operator reads of a full pull in `build-report.json` (ADR-0005, ADR-0030): which
// sets the pull read, how many rows the feed counted for each and how many came, and whether the pull counted as
// complete. A pull is complete only when every set's rows match its `$count`; a pull that is not is refused whole,
// so the index goes on answering from the last complete one (get-measure-feed.test.ts, "a pull that is refused").
// Each case builds its own system, because the feed it needs is the thing under test; the documents are off, since
// nothing here reads one.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 2026-08-01 10:00 in Oregon: every row of the fixture exists by then (a history action is created in 2026).
const clockAt = "2026-08-01T17:00:00Z";

async function start(): Promise<System> {
  const system = await startSystem({ clockAt });
  started.push(system);
  return system;
}

/** The as-of time an agent reads from `get_measure`: the last complete pull's. */
async function asOfSeenByAgents(system: System): Promise<unknown> {
  const connected = await connectClient("2026-07-28", system.handler);
  try {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });
    expect(outcome.isError, outcome.text).toBe(false);
    return outcome.structured?.["as_of"];
  } finally {
    await connected.close();
  }
}

type SetReport = {
  entity_set: string;
  counted: number;
  read: number;
  complete: boolean;
  listed?: number;
  no_longer_listed?: number;
};
const setsOf = (report: Record<string, unknown>): Record<string, SetReport> => {
  const pull = report["pull"] as { entity_sets: SetReport[] };
  return Object.fromEntries(pull.entity_sets.map((set) => [set.entity_set, set]));
};

// The rows of each set at that clock are the lengths of the fixture's own files (test/fixtures/olis-2025R1/feed/):
// CommitteePublicTestimonies.json holds 84 rows, 42 of them HB 3131's (spec #1, case (d)). The fixture has no
// CommitteeMembers file (its README says why), so that set is empty here.
const fixtureRows = {
  Measures: 8,
  Legislators: 90,
  MeasureSponsors: 49,
  MeasureHistoryActions: 144,
  CommitteeVotes: 88,
  MeasureVotes: 509,
  Committees: 12,
  CommitteeMeetings: 36,
  CommitteeAgendaItems: 36,
  MeasureDocuments: 23,
  MeasureAnalysisDocuments: 34,
  CommitteeMeetingDocuments: 86,
  CommitteeProposedAmendments: 15,
  CommitteePublicTestimonies: 84,
  CommitteeMembers: 0,
} as const;

describe("a full pull that is short of the feed's counts", () => {
  // `withholdLastRows(1)` is a feed that counted its rows and then paged one fewer of each set: every set that has
  // a row is short by one, and the empty one is not.
  it("is refused, and build-report.json names each short set with the rows counted and the rows read", async () => {
    const system = await start();
    system.olis.withholdLastRows(1);

    await expect(system.pullAgain()).rejects.toThrow(/counted 8.*read 7/);

    const report = system.buildReport();
    expect(report).toMatchObject({ session: "2025R1", attempted_at: "2026-08-01T10:00:00-07:00" });
    expect(report["pull"]).toMatchObject({ complete: false });
    const sets = setsOf(report);
    expect(Object.keys(sets).toSorted()).toEqual(Object.keys(fixtureRows).toSorted());
    for (const [name, counted] of Object.entries(fixtureRows)) {
      expect(sets[name]).toEqual(
        counted === 0
          ? { entity_set: name, counted: 0, read: 0, complete: true }
          : { entity_set: name, counted, read: counted - 1, complete: false },
      );
    }
  });
});

// The pull reads every set before it decides, so a set that is short anywhere refuses it, and the report names that set
// and no other. These are the sets after the first one (Measures) the worker reads: CommitteePublicTestimonies, one of
// the last, and Legislators, the second. A worker that looked at the first set alone would store both pulls.
describe("a full pull that is short in one set other than the first", () => {
  it.for(["CommitteePublicTestimonies", "Legislators"] as const)(
    "is refused for %s alone, and the index stays as the last complete pull left it",
    async (shortSet) => {
      const system = await start();
      const before = await asOfSeenByAgents(system);
      system.olis.withholdLastRows(1, shortSet);
      system.clock.set("2026-08-02T17:00:00Z");

      await expect(system.pullAgain()).rejects.toThrow(
        new RegExp(
          `Short read of ${shortSet}: OLIS counted ${fixtureRows[shortSet]}.*read ${fixtureRows[shortSet] - 1}`,
        ),
      );

      const sets = setsOf(system.buildReport());
      for (const [name, counted] of Object.entries(fixtureRows)) {
        expect(sets[name], name).toEqual({
          entity_set: name,
          counted,
          read: name === shortSet ? counted - 1 : counted,
          complete: name !== shortSet,
        });
      }
      expect(system.buildReport()["pull"]).toMatchObject({ complete: false });
      expect(await asOfSeenByAgents(system)).toBe(before);
    },
  );
});

describe("a full pull that matches the feed's counts", () => {
  it("says so in build-report.json, with the rows counted, read and listed for every set it read", async () => {
    const system = await start();

    const report = system.buildReport();

    expect(report).toMatchObject({ session: "2025R1", as_of: "2026-08-01T10:00:00-07:00" });
    expect(report["pull"]).toMatchObject({ complete: true });
    const sets = setsOf(report);
    expect(Object.keys(sets).toSorted()).toEqual(Object.keys(fixtureRows).toSorted());
    for (const [name, counted] of Object.entries(fixtureRows)) {
      expect(sets[name]).toEqual({
        entity_set: name,
        counted,
        read: counted,
        complete: true,
        listed: counted,
        no_longer_listed: 0,
      });
    }
  });
});
