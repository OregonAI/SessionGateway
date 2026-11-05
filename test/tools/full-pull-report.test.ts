// Seam 1 (test/CLAUDE.md): what the operator reads of a full pull in `build-report.json` (ADR-0005, ADR-0030): which
// sets the pull read, how many rows the feed counted for each and how many came, and whether the pull counted as
// complete. A pull is complete only when every set's rows match its `$count`; a pull that is not is refused whole,
// so the index goes on answering from the last complete one (get-measure-feed.test.ts, "a pull that is refused").
// Each case builds its own system, because the feed it needs is the thing under test; the documents are off, since
// nothing here reads one.
//
// It covers what the report says of the sets a pull read, of a pull it refused, and of one that is short in a set
// other than the first; and, for the two sets the schedule reads (ticket #67, ADR-0042), MADE UP ConveneTimes and
// LegislativeSessions rows counted against $count, a pull short in either refused, and the two-pull rule on a convening;
// and MADE UP FloorLetters rows (ticket #64) counted against $count, and a pull short in FloorLetters refused.
import { afterEach, describe, expect, it } from "vitest";
import { withFloorLetters, type MadeUpFloorLetter } from "../support/floor-letters.ts";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

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
// CommitteePublicTestimonies.json holds 84 rows, 42 of them HB 3131's (spec #1, case (d)), and CommitteeMembers.json
// the 99 members of the fixture's 12 committees (ticket #81).
const fixtureRows = {
  Measures: 10,
  Legislators: 90,
  MeasureSponsors: 63,
  MeasureHistoryActions: 150,
  CommitteeVotes: 88,
  MeasureVotes: 509,
  Committees: 12,
  CommitteeMeetings: 36,
  CommitteeAgendaItems: 36,
  MeasureDocuments: 25,
  MeasureAnalysisDocuments: 34,
  CommitteeMeetingDocuments: 119,
  CommitteeProposedAmendments: 15,
  CommitteePublicTestimonies: 84,
  CommitteeMembers: 99,
  // The fixture holds no file for either set (its README says why), so the fake serves both empty (ticket #67).
  ConveneTimes: 0,
  LegislativeSessions: 0,
  // The fixture holds no FloorLetters file (ticket #64 leaves real rows to a later rebuild), so the fake serves it empty.
  FloorLetters: 0,
} as const;

describe("a full pull that is short of the feed's counts", () => {
  // `withholdLastRows(1)` is a feed that counted its rows and then paged one fewer of each set: every set that has
  // a row is short by one, and the empty one is not.
  it("is refused, and build-report.json names each short set with the rows counted and the rows read", async () => {
    const system = await start();
    system.olis.withholdLastRows(1);

    await expect(system.pullAgain()).rejects.toThrow(/counted 10.*read 9/);

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

// Ticket #67: the sets the schedule reads, ConveneTimes and LegislativeSessions, are counted against `$count` like every
// other set. The fixture holds no rows for them, so these cases add MADE UP rows with `strayRows` (the first pull sees
// them): two floor convenings of 2025-01-29 and the Session's own row.
const madeUpFeed = {
  ConveneTimes: [
    // MADE UP: a House and a Senate convening, in the feed's shape (olis-odata.md section 2).
    { SessionKey: "2025R1", SessionDate: "2025-01-29T08:30:00", Chamber: "H", RecessUntil: null, ModifiedDate: null },
    { SessionKey: "2025R1", SessionDate: "2025-01-29T09:00:00", Chamber: "S", RecessUntil: null, ModifiedDate: null },
  ],
  LegislativeSessions: [
    // MADE UP: the Session's row. The real 2025R1 row has BeginDate 2025-01-13 and a null EndDate.
    {
      SessionKey: "2025R1",
      SessionName: "2025 Regular Session",
      BeginDate: "2025-01-13T00:00:00",
      EndDate: "2025-03-14T00:00:00",
      ModifiedDate: "2026-06-09T11:05:09",
      DefaultSession: false,
    },
  ],
};

describe("the sets the schedule reads (ticket #67)", () => {
  async function startWithMadeUpFeed(): Promise<System> {
    const system = await startSystem({ clockAt, olis: { strayRows: madeUpFeed } });
    started.push(system);
    return system;
  }

  it("counts ConveneTimes and LegislativeSessions in the build report, listed like every other set", async () => {
    const system = await startWithMadeUpFeed();

    const sets = setsOf(system.buildReport());

    expect(sets["ConveneTimes"]).toEqual({
      entity_set: "ConveneTimes",
      counted: 2,
      read: 2,
      complete: true,
      listed: 2,
      no_longer_listed: 0,
    });
    expect(sets["LegislativeSessions"]).toEqual({
      entity_set: "LegislativeSessions",
      counted: 1,
      read: 1,
      complete: true,
      listed: 1,
      no_longer_listed: 0,
    });
  });

  it.for(["ConveneTimes", "LegislativeSessions"] as const)(
    "refuses a pull that is short in %s alone, and names it",
    async (shortSet) => {
      const system = await startWithMadeUpFeed();
      const counted = madeUpFeed[shortSet].length;
      system.olis.withholdLastRows(1, shortSet);
      system.clock.set("2026-08-02T17:00:00Z");

      await expect(system.pullAgain()).rejects.toThrow(
        new RegExp(`Short read of ${shortSet}: OLIS counted ${counted}.*read ${counted - 1}`),
      );

      const sets = setsOf(system.buildReport());
      expect(sets[shortSet]).toEqual({ entity_set: shortSet, counted, read: counted - 1, complete: false });
      expect(sets["Measures"]).toMatchObject({ complete: true });
      expect(system.buildReport()["pull"]).toMatchObject({ complete: false });
    },
  );

  it("applies the two-pull rule to ConveneTimes rows: a convening OLIS stops listing is no longer listed after two pulls", async () => {
    // `stopListing` moves a row of the fake's feed, which `strayRows` are not part of, so the rows are added after the first pull.
    const system = await start();
    system.olis.addRows("ConveneTimes", madeUpFeed.ConveneTimes);
    system.clock.set("2026-08-02T17:00:00Z");
    await system.pullAgain();
    expect(setsOf(system.buildReport())["ConveneTimes"]).toMatchObject({ counted: 2, listed: 2, no_longer_listed: 0 });

    stopListing(system.olis, "ConveneTimes", (row) => row["Chamber"] === "S");
    system.clock.set("2026-08-03T17:00:00Z");
    await system.pullAgain();
    expect(setsOf(system.buildReport())["ConveneTimes"]).toMatchObject({ counted: 1, listed: 2, no_longer_listed: 0 });

    system.clock.set("2026-08-04T17:00:00Z");
    await system.pullAgain();
    expect(setsOf(system.buildReport())["ConveneTimes"]).toMatchObject({ counted: 1, listed: 1, no_longer_listed: 1 });
  });
});

// Ticket #64: the full pull reads FloorLetters with `$count` like every other set. The fixture holds none, so these
// cases give the fake two MADE UP rows (`madeUpRows`, test/support/floor-letters.ts), which the pull's filter applies to.
const madeUpLetters: MadeUpFloorLetter[] = [
  {
    floorLetterId: 900001,
    measure: { prefix: "SB", number: 69 },
    letterDate: "2025-03-04T00:00:00",
    chamber: "S",
    title: "Made-up letter on SB 69",
    description: "Made-up letter of support",
    lines: ["A made-up floor letter."],
  },
  {
    floorLetterId: 900002,
    measure: null,
    letterDate: "2025-03-05T00:00:00",
    chamber: "H",
    title: "Made-up petition",
    description: "Made-up petition",
    lines: ["A made-up petition."],
  },
];

describe("FloorLetters (ticket #64)", () => {
  async function startWithLetters(): Promise<System> {
    const system = await startSystem({ clockAt, olis: withFloorLetters(madeUpLetters) });
    started.push(system);
    return system;
  }

  it("counts FloorLetters in the build report, read against $count and listed like every other set", async () => {
    const system = await startWithLetters();

    expect(setsOf(system.buildReport())["FloorLetters"]).toEqual({
      entity_set: "FloorLetters",
      counted: 2,
      read: 2,
      complete: true,
      listed: 2,
      no_longer_listed: 0,
    });
    const letterRequests = system.olis.requests().filter((request) => request.entitySet === "FloorLetters");
    expect(letterRequests.some((request) => request.isCount)).toBe(true);
  });

  it("refuses a pull that is short in FloorLetters alone, and names it", async () => {
    const system = await startWithLetters();
    system.olis.withholdLastRows(1, "FloorLetters");
    system.clock.set("2026-08-02T17:00:00Z");

    await expect(system.pullAgain()).rejects.toThrow(/Short read of FloorLetters: OLIS counted 2.*read 1/);

    const sets = setsOf(system.buildReport());
    expect(sets["FloorLetters"]).toEqual({ entity_set: "FloorLetters", counted: 2, read: 1, complete: false });
    expect(sets["Measures"]).toMatchObject({ complete: true });
    expect(system.buildReport()["pull"]).toMatchObject({ complete: false });
  });
});
