// Seam 1: what the live status shows depends on what OLIS said at the read, and that is the thing under
// test here. Each case builds its own system: the cache is pulled from the committed fixture on 2025-04-10,
// the clock moves to 2025-12-15, and the case changes what the fake OLIS says after the pull, with rows made
// up for the case (test/CLAUDE.md; the fixture holds each row's final state, so a Measure's location is the
// same in the cache and at OLIS until a case moves it). Cases that read the fixture as it stands are in
// get-measure-live.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { liveStatusOf, type ToolLiveStatus } from "../support/live-status.ts";
import { callTool, connectClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";
import { floorVoteRow, floorVotesOf, tuplesOf } from "../support/votes.ts";

const pulledAt = "2025-04-10T17:00:00Z";
const readAt = "2025-12-15T17:00:00Z";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

/** Pulls the cache on 2025-04-10, moves the clock to 2025-12-15 and lets the case change the fake OLIS. */
async function systemWhere(changeOlis: (system: System) => void): Promise<System> {
  const system = await startSystem({ clockAt: pulledAt });
  started.push(system);
  system.clock.set(readAt);
  changeOlis(system);
  return system;
}

async function getMeasure(system: System, reference: string): Promise<ToolOutcome> {
  const connected = await connectClient("2026-07-28", system.handler);
  try {
    return await callTool(connected, "get_measure", { measure: reference });
  } finally {
    await connected.close();
  }
}

describe("a location that has changed since the pull", () => {
  it("shows OLIS's location in the live block and the pull's in the cache's own field", async () => {
    // SB 69's Measures row in the fixture says "Chapter Number Assigned" and no committee, and the cache
    // has that. OLIS is made to move it after the pull, to a place made up for the case.
    const system = await systemWhere((s) => {
      s.olis.amendRows("Measures", (row) => row["MeasurePrefix"] === "SB" && row["MeasureNumber"] === 69, {
        CurrentLocation: "In House Committee",
        CurrentCommitteeCode: "HLWS",
      });
    });

    const outcome = await getMeasure(system, "SB 69");

    expect(liveStatusOf(outcome)).toMatchObject({
      source: "olis",
      location: { current: "In House Committee", committee_code: "HLWS" },
    });
    expect(outcome.structured?.["location"]).toEqual({ current: "Chapter Number Assigned", committee_code: null });
  });
});

describe("a floor vote OLIS gained since the pull", () => {
  // A roll made up for the case: SB 69, Senate, 2025-02-07 10:00, MeasureHistoryId 900002 (above every real
  // id), of "Sen Bonham", whom the cache's Legislators rows name, and "Sen Newcomer", a code no row, alias or
  // vote of the cache has ever had.
  const roll = [
    floorVoteRow(9000001, "Sen Bonham", "Nay", { historyId: 900002, actionText: "Reconsidered. Passed." }),
    floorVoteRow(9000002, "Sen Newcomer", "Aye", { historyId: 900002, actionText: "Reconsidered. Passed." }),
  ];

  it("shows the roll in the live block, a voter the index knows as the Legislator and one it does not as the code alone", async () => {
    const system = await systemWhere((s) => {
      s.olis.addRows("MeasureVotes", roll);
    });

    const outcome = await getMeasure(system, "SB 69");

    const live = liveStatusOf(outcome);
    const reconsidered = live?.floor_votes.find((vote) => vote.action === "Reconsidered. Passed.");
    expect(reconsidered?.date).toBe("2025-02-07T10:00:00-08:00");
    expect(tuplesOf(reconsidered?.votes ?? [])).toEqual([
      ["Sen Bonham", "Nay", "legislator-2025r1-bonham", "Daniel Bonham"],
      ["Sen Newcomer", "Aye", undefined, undefined],
    ]);
    // It sits between the Senate's vote of 2025-02-06 and the House's of 2025-05-05.
    expect(live?.floor_votes.map((vote) => vote.date)).toEqual([
      "2025-02-06T11:21:32-08:00",
      "2025-02-07T10:00:00-08:00",
      "2025-05-05T11:30:33-07:00",
    ]);
    // The cache, pulled before OLIS had it, has the one floor vote.
    expect(floorVotesOf(outcome)).toHaveLength(1);
  });
});

describe("a live read that is not a trustworthy answer", () => {
  /** What the lookup came to when OLIS did that: the cache answered, and the block says why. */
  function expectCacheAnswered(live: ToolLiveStatus | undefined, reason: RegExp): void {
    expect(live).toMatchObject({ source: "cache", lookup_failed: true, as_of: "2025-04-10T10:00:00-07:00" });
    expect(live?.notice).toMatch(reason);
  }

  it("falls back to the cache when OLIS lists no such Measure", async () => {
    // The key of SB 69's row is moved to a number no Measure has, so a read for SB 69 finds none.
    const system = await systemWhere((s) => {
      s.olis.amendRows("Measures", (row) => row["MeasurePrefix"] === "SB" && row["MeasureNumber"] === 69, {
        MeasureNumber: 99999,
      });
    });

    const outcome = await getMeasure(system, "SB 69");

    expect(outcome.isError).toBe(false);
    expectCacheAnswered(liveStatusOf(outcome), /OLIS lists no Measure SB 69 in 2025R1/);
  });

  it("falls back to the cache when OLIS sends a page that is not what the client reads", async () => {
    // CurrentLocation is a string in every row of the feed; null is not a shape the client accepts.
    const system = await systemWhere((s) => {
      s.olis.amendRows("Measures", (row) => row["MeasurePrefix"] === "SB" && row["MeasureNumber"] === 69, {
        CurrentLocation: null,
      });
    });

    const outcome = await getMeasure(system, "SB 69");

    expect(outcome.isError).toBe(false);
    expectCacheAnswered(liveStatusOf(outcome), /page of Measures that is not what the client reads/);
  });

  it("falls back to the cache rather than show a partial read as complete: OLIS counts more rows than it sends", async () => {
    const system = await systemWhere((s) => {
      s.olis.withholdLastRows(1);
    });

    const outcome = await getMeasure(system, "SB 69");

    expect(outcome.isError).toBe(false);
    expectCacheAnswered(liveStatusOf(outcome), /Short read of \w+: OLIS counted \d+ rows \(\$inlinecount\); read \d+/);
  });
});
