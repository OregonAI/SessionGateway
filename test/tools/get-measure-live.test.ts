// Seam 1 (test/CLAUDE.md): the live status block of get_measure, as an agent sees it, with the whole
// system behind it (ticket #21; spec #1, module 11 and story 43). A fake OLIS serves the committed
// fixture as the feed stood at the injected clock's time, the ingest worker pulls it into a database
// on 2025-01-29, and then the clock moves to 2025-12-15, so the fake serves rows it did not have at the
// pull. The tool reads the Measure's location, history, schedule and votes from the fake when the call
// arrives, and the result shows them next to the cache's, dated by the clock at the read.
//
// Expected values are literals from outside the code: the fixture's feed rows for SB 69 and HB 3795
// (test/fixtures/olis-2025R1/feed/), the same ones get-measure-location.test.ts and
// get-measure-votes.test.ts read.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveStatusOf } from "../support/live-status.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

// 2025-01-29 09:00 in Oregon, the day before SLB heard SB 69: the cache is pulled then.
const pulledAt = "2025-01-29T17:00:00Z";
// 2025-12-15 09:00 in Oregon, after every row these Measures have was created.
const readAt = "2025-12-15T17:00:00Z";

describe("the live status with OLIS answering", () => {
  let system: System;

  beforeAll(async () => {
    system = await startSystem({ clockAt: pulledAt });
    system.clock.set(readAt);
  });

  afterAll(async () => {
    await system.stop();
  });

  describe.for(eras)("for a %s client", (era) => {
    let connected: ConnectedClient;

    beforeAll(async () => {
      connected = await connectClient(era, system.handler);
    });

    afterAll(async () => {
      await connected.close();
    });

    // SB 69's MeasureHistoryActions rows in the fixture: 20 in all, the first "Introduction and first
    // reading. Referred to President's desk." (2025-01-13T09:07:30) and the last "Effective on the 91st
    // day following adjournment sine die." (2025-05-20T10:38:02). The cache, pulled on 2025-01-29, holds
    // the four that had been created by then (the first four of those, to "Public Hearing held.").
    it("shows SB 69's location and history as OLIS has them now, dated by the clock at the read", async () => {
      const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

      expect(outcome.isError).toBe(false);
      const live = liveStatusOf(outcome);
      expect(live).toMatchObject({
        source: "olis",
        lookup_failed: false,
        as_of: "2025-12-15T09:00:00-08:00",
        location: { current: "Chapter Number Assigned", committee_code: null },
      });
      expect(live?.history).toHaveLength(20);
      expect(live?.history[0]).toEqual({
        chamber: "senate",
        date: "2025-01-13T09:07:30-08:00",
        text: "Introduction and first reading. Referred to President's desk.",
      });
      expect(live?.history.at(-1)).toEqual({
        chamber: "senate",
        date: "2025-05-20T10:38:02-07:00",
        text: "Effective on the 91st day following adjournment sine die.",
      });
    });

    it("leaves the cache's own values as the last full pull had them, with the index's as-of time", async () => {
      const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

      expect(outcome.structured).toMatchObject({ as_of: "2025-01-29T09:00:00-08:00" });
      const cached = outcome.structured?.["history"] as { text: string }[];
      expect(cached).toHaveLength(4);
      expect(cached.at(-1)?.text).toBe("Public Hearing held.");
    });
  });
});
