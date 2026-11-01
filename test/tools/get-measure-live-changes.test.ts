// Seam 1 (test/CLAUDE.md): what get_measure's `live_status` block says compared with the top level of
// the same result (ticket #48; ADR-0038). The block says only what the top level does not: a value OLIS
// gives as the top level shows it is `unchanged`, a list that OLIS gives as the top level's entries plus
// new ones at the end shows `new_entries`, and any other difference shows the value `full`.
//
// Every describe here changes what the fake OLIS says, so the read-only case (OLIS answering exactly as
// the Index) is in get-measure-live.test.ts and a moved location is in get-measure-live-feed.test.ts.
//
// The pull and the read are at one clock (2026-08-01, after every row of the fixture exists), so with
// the fake OLIS as the pull left it, OLIS gives exactly what the Index holds. A case then changes what
// the fake says, with rows MADE UP for the case. Each case has a system of its own, and is read with both
// kinds of client. The pull is not the subject, so each case copies the run's template for this clock (test/CLAUDE.md,
// "Templates") and changes the fake after the copy.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveStatusOf, type ToolLiveStatus } from "../support/live-status.ts";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import { floorVoteRow, tuplesOf } from "../support/votes.ts";

const clockAt = "2026-08-01T17:00:00Z";
// 2026-08-01 10:00 in Oregon.
const asOf = "2026-08-01T10:00:00-07:00";

const unchanged = { status: "unchanged" } as const;

/** One get_measure call, with a client of the given era. */
async function getMeasure(system: System, era: Era, measure: string) {
  const connected = await connectClient(era, system.handler);
  try {
    return await callTool(connected, "get_measure", { measure });
  } finally {
    await connected.close();
  }
}

/** A MeasureHistoryActions row in the feed's shape, MADE UP: SB 69's, Senate, with an id above every real one. */
function madeUpHistoryRow(id: number, actionDate: string, text: string): Record<string, unknown> {
  return {
    MeasureHistoryId: id,
    SessionKey: "2025R1",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    Chamber: "S",
    ActionDate: actionDate,
    ActionText: text,
    VoteText: null,
    CreatedDate: "2025-06-10T10:00:05",
    ModifiedDate: null,
    PublicNotification: false,
  };
}

describe("OLIS giving one more History action and one more floor vote than the Index", () => {
  let system: System;

  // MADE UP: SB 69, Senate, one action after its last real one (2025-05-20), and a roll at it with
  // "Sen Bonham", whom the Index's Legislators name, and "Sen Newcomer", a code no row of the Index has.
  const newAction = { chamber: "senate", date: "2025-06-10T10:00:00-07:00", text: "MADE UP: Reconsidered. Passed." };
  const roll = [
    floorVoteRow(9000001, "Sen Bonham", "Nay", {
      historyId: 900002,
      actionDate: "2025-06-10T10:00:00",
      actionText: "MADE UP: Reconsidered. Passed.",
    }),
    floorVoteRow(9000002, "Sen Newcomer", "Aye", {
      historyId: 900002,
      actionDate: "2025-06-10T10:00:00",
      actionText: "MADE UP: Reconsidered. Passed.",
    }),
  ];

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt });
    system.olis.addRows("MeasureHistoryActions", [
      madeUpHistoryRow(900002, "2025-06-10T10:00:00", "MADE UP: Reconsidered. Passed."),
    ]);
    system.olis.addRows("MeasureVotes", roll);
  });

  afterAll(async () => {
    await system.stop();
  });

  describe.for(eras)("for a %s client", (era) => {
    it("shows exactly that action and that vote, and says the rest is unchanged", async () => {
      const outcome = await getMeasure(system, era, "SB 69");

      const live = liveStatusOf(outcome);
      expect(live?.source).toBe("olis");
      expect(live?.location).toEqual(unchanged);
      expect(live?.committee_votes).toEqual(unchanged);
      expect(live?.history).toEqual({ status: "new_entries", entries: [newAction] });
      expect(live?.floor_votes.status).toBe("new_entries");
      const entries = live?.floor_votes.status === "unchanged" ? [] : live?.floor_votes.entries;
      expect(entries).toHaveLength(1);
      expect(entries?.[0]).toMatchObject({
        chamber: "senate",
        date: "2025-06-10T10:00:00-07:00",
        action: "MADE UP: Reconsidered. Passed.",
      });
      expect(tuplesOf(entries?.[0]?.votes ?? [])).toEqual([
        ["Sen Bonham", "Nay", "legislator-2025r1-bonham", "Daniel Bonham"],
        ["Sen Newcomer", "Aye", undefined, undefined],
      ]);
      // The top level is the Index's: 20 actions, the last the fixture's.
      const top = outcome.structured?.["history"] as { text: string }[];
      expect(top).toHaveLength(20);
      expect(top.at(-1)?.text).toBe("Effective on the 91st day following adjournment sine die.");
    });
  });
});

describe("OLIS giving a History that differs before its end", () => {
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt });
    // An earlier action changes: SB 69's "Referred to Labor and Workplace Standards." (2025-02-12) is
    // reworded at OLIS. The wording is MADE UP.
    system.olis.amendRows(
      "MeasureHistoryActions",
      (row) =>
        row["MeasurePrefix"] === "SB" &&
        row["MeasureNumber"] === 69 &&
        row["ActionText"] === "Referred to Labor and Workplace Standards.",
      { ActionText: "MADE UP: Referred to Rules." },
    );
  });

  afterAll(async () => {
    await system.stop();
  });

  describe.for(eras)("for a %s client", (era) => {
    it("shows that History in full, and the rest unchanged", async () => {
      const outcome = await getMeasure(system, era, "SB 69");

      const live = liveStatusOf(outcome);
      expect(live?.history.status).toBe("full");
      const entries = live?.history.status === "unchanged" ? [] : live?.history.entries;
      expect(entries).toHaveLength(20);
      expect(entries?.[0]).toEqual({
        chamber: "senate",
        date: "2025-01-13T09:07:30-08:00",
        text: "Introduction and first reading. Referred to President's desk.",
      });
      expect(entries?.map((entry) => entry.text)).toContain("MADE UP: Referred to Rules.");
      expect(entries?.map((entry) => entry.text)).not.toContain("Referred to Labor and Workplace Standards.");
      expect(live?.floor_votes).toEqual(unchanged);
      expect(live?.committee_votes).toEqual(unchanged);
      expect(live?.location).toEqual(unchanged);
    });
  });
});

describe("OLIS giving a History that is not the top level's with more after it", () => {
  const historyRows = (row: Record<string, unknown>): boolean =>
    row["MeasurePrefix"] === "SB" && row["MeasureNumber"] === 69;

  it("shows OLIS's whole History when it gives fewer entries than the Index holds", async () => {
    const system = await startCopiedSystem({ clockAt });
    try {
      // MADE UP: OLIS no longer gives SB 69's last action (the row now belongs to a Measure the Index does not
      // hold), so it gives 19 actions where the Index holds 20.
      system.olis.amendRows(
        "MeasureHistoryActions",
        (row) => historyRows(row) && row["ActionText"] === "Effective on the 91st day following adjournment sine die.",
        { MeasureNumber: 9999 },
      );
      for (const era of eras) {
        const outcome = await getMeasure(system, era, "SB 69");

        const live = liveStatusOf(outcome);
        expect(live?.source).toBe("olis");
        expect(live?.history.status).toBe("full");
        const entries = live?.history.status === "full" ? live.history.entries : [];
        expect(entries).toHaveLength(19);
        expect(entries.map((entry) => entry.text)).not.toContain(
          "Effective on the 91st day following adjournment sine die.",
        );
        expect(outcome.structured?.["history"]).toHaveLength(20);
      }
    } finally {
      await system.stop();
    }
  });

  it("shows OLIS's whole History when it gives the same actions in another order", async () => {
    const system = await startCopiedSystem({ clockAt });
    try {
      // MADE UP: two actions of SB 69 swap their dates at OLIS, so the same 20 actions come in a different
      // order (the later one now comes first).
      const first = "Introduction and first reading. Referred to President's desk.";
      const second = "Referred to Labor and Workplace Standards.";
      const [firstDate, secondDate] = ["2025-01-13T09:07:30", "2025-02-12T13:25:30"];
      system.olis.amendRows("MeasureHistoryActions", (row) => historyRows(row) && row["ActionText"] === first, {
        ActionDate: secondDate,
      });
      system.olis.amendRows("MeasureHistoryActions", (row) => historyRows(row) && row["ActionText"] === second, {
        ActionDate: firstDate,
      });
      for (const era of eras) {
        const outcome = await getMeasure(system, era, "SB 69");

        const live = liveStatusOf(outcome);
        expect(live?.history.status).toBe("full");
        const entries = live?.history.status === "full" ? live.history.entries : [];
        expect(entries).toHaveLength(20);
        expect(entries[0]?.text).toBe(second);
        expect(entries.map((entry) => entry.text).indexOf(first)).toBeGreaterThan(1);
      }
    } finally {
      await system.stop();
    }
  });
});

describe("a lookup that fails", () => {
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt });
    system.olis.behave({ kind: "fail", status: 503 });
  });

  afterAll(async () => {
    await system.stop();
  });

  describe.for(eras)("for a %s client", (era) => {
    it("says so and why, and repeats none of the top level's values", async () => {
      const outcome = await getMeasure(system, era, "SB 69");

      expect(outcome.isError).toBe(false);
      const live = liveStatusOf(outcome) as ToolLiveStatus;
      expect(live).toMatchObject({
        source: "cache",
        lookup_failed: true,
        as_of: asOf,
        schedule: null,
        location: unchanged,
        history: unchanged,
        floor_votes: unchanged,
        committee_votes: unchanged,
      });
      expect(live.notice).toMatch(/live lookup of OLIS failed/i);
      expect(live.notice).toMatch(/503/);
      // None of the top level's history text is in the block.
      expect(JSON.stringify(live)).not.toContain("Introduction and first reading");
      expect(JSON.stringify(live)).not.toContain("Chapter Number Assigned");
    });
  });
});

describe("what the output schema tells an agent about the live block", () => {
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt });
  });

  afterAll(async () => {
    await system.stop();
  });

  describe.for(eras)("for a %s client", (era) => {
    it("says how to read unchanged, new entries and full, including when the lookup fell back to the cache", async () => {
      const connected = await connectClient(era, system.handler);
      try {
        const { tools } = await connected.client.listTools();

        const schema = JSON.stringify(tools.find((tool) => tool.name === "get_measure")?.outputSchema);
        expect(schema).toContain("read the top-level field of the same name");
        expect(schema).toContain('When source is \\"cache\\", nothing was read from OLIS');
        expect(schema).toContain("the top level's entries, then these");
        expect(schema).toContain("an entry changed, missing or reordered, or fewer entries");
      } finally {
        await connected.close();
      }
    });
  });
});
