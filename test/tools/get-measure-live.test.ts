// Seam 1 (test/CLAUDE.md): the live status block of get_measure, as an agent sees it, with the whole
// system behind it (ticket #21; spec #1, module 11 and story 43). A fake OLIS serves the committed
// fixture as the feed stood at the injected clock's time, the ingest worker pulls it into a database
// on 2025-04-10, and then the clock moves to 2025-12-15, so the fake serves rows it did not have at the
// pull. The tool reads the Measure's location, history, schedule and votes from the fake when the call
// arrives, and the result shows them next to the cache's, dated by the clock at the read.
//
// Expected values are literals from outside the code: the fixture's feed rows for SB 69 and HB 3795
// (test/fixtures/olis-2025R1/feed/), the same ones get-measure-location.test.ts and
// get-measure-votes.test.ts read.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hb3795Hechs,
  hb3795FloorVotes,
  hb3795Shs,
  rollOf,
  sb69FloorVotes,
  sb69Hlws,
  sb69Slb,
} from "../support/expected-votes.ts";
import { liveStatusOf } from "../support/live-status.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";
import { committeeVotesOf, floorVotesOf, tuplesOf } from "../support/votes.ts";

// 2025-04-10 10:00 in Oregon: the cache is pulled then. SB 69 has been heard by SLB, and has passed the
// Senate (its floor vote of 2025-02-06 is in the cache); HB 3795, which OLIS created on 2025-02-25, has
// had its HECHS hearing and work session (2025-04-03) and has not yet been voted on by the House.
const pulledAt = "2025-04-10T17:00:00Z";
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
    // day following adjournment sine die." (2025-05-20T10:38:02). The cache, pulled on 2025-04-10, holds
    // the ten that had been created by then, the last "Referred to Labor and Workplace Standards."
    // (2025-02-12T13:25:30).
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

      expect(outcome.structured).toMatchObject({ as_of: "2025-04-10T10:00:00-07:00" });
      const cached = outcome.structured?.["history"] as { text: string }[];
      expect(cached).toHaveLength(10);
      expect(cached.at(-1)?.text).toBe("Referred to Labor and Workplace Standards.");
    });

    // The votes are the rows of CommitteeVotes and MeasureVotes the fixture holds for each Measure, which
    // get-measure-votes.test.ts reads once the whole Session is in the cache. In the cache of 2025-04-10
    // SB 69 has its SLB roll (created 2025-01-23) and its Senate floor vote (created 2025-02-06) and not
    // its HLWS roll (created 2025-04-21) or its House floor vote (created 2025-05-05); HB 3795 has its
    // HECHS roll (created 2025-03-17) and none of its three floor votes (the first was created 2025-04-14)
    // or its SHS roll (created 2025-05-14).
    it.for([
      ["SB 69", [sb69Slb, sb69Hlws], sb69FloorVotes, 1, 1],
      ["HB 3795", [hb3795Hechs, hb3795Shs], hb3795FloorVotes, 1, 0],
    ] as const)(
      "shows %s's committee and floor votes as OLIS has them now, each voter as the Legislator the code names",
      async ([measure, committeeRolls, floorVotes, cachedCommitteeVotes, cachedFloorVotes]) => {
        const outcome = await callTool(connected, "get_measure", { measure });

        const live = liveStatusOf(outcome);
        expect(live?.source).toBe("olis");
        expect(live?.committee_votes.map((vote) => tuplesOf(vote.votes))).toEqual(committeeRolls);
        expect(
          live?.floor_votes.map((vote) => ({ chamber: vote.chamber, date: vote.date, roll: rollOf(vote.votes) })),
        ).toEqual(floorVotes.map(({ chamber, date, roll }) => ({ chamber, date, roll })));
        // The cache, from before those rows existed, has fewer.
        expect(committeeVotesOf(outcome)).toHaveLength(cachedCommitteeVotes);
        expect(floorVotesOf(outcome)).toHaveLength(cachedFloorVotes);
      },
    );
  });
});

// The schedule is the Measure's upcoming committee agenda items: the feed's CommitteeAgendaItems rows for
// the Measure whose MeetingDate is at or after the time of the read. The rows, from the fixture:
//   SB 69    201898  SLB    2025-01-21T08:00:00  Informational Meeting             created 2025-01-17
//            202157  SLB    2025-01-28T08:00:00  Public Hearing                    created 2025-01-23
//            202165  SLB    2025-01-30T08:00:00  Public Hearing and Work Session   created 2025-01-23
//            209474  HLWS   2025-04-21T15:00:00  Public Hearing                    created 2025-04-11
//            210203  HLWS   2025-04-28T15:00:00  Work Session                      created 2025-04-23
//   HB 3795  208761  HECHS  2025-04-03T08:00:00  Public Hearing and Work Session   created 2025-04-02
//            210517  SHS    2025-04-29T08:45:00  Public Hearing                    created 2025-04-25
//            211461  SHS    2025-05-15T08:00:00  Work Session                      created 2025-05-08
//            211739  SHS    2025-05-22T08:00:00  Work Session                      created 2025-05-15
//            211740  SHS    2025-05-20T08:00:00  Public Hearing and Work Session   created 2025-05-15
// (The property that names the committee is spelled `CommitteCode` in the feed.) The fake OLIS serves only
// the rows created by its clock's time.
describe("the schedule with OLIS answering", () => {
  let system: System;

  beforeAll(async () => {
    system = await startSystem({ clockAt: pulledAt });
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

    // 2025-04-26 10:00 in Oregon. SB 69's HLWS hearing (04-21) is past and its work session (04-28) is
    // ahead; HB 3795's SHS hearing (04-29) was created the day before and is ahead, and its later SHS
    // rows do not exist yet.
    it.for([
      ["SB 69", [{ committee_code: "HLWS", meeting_date: "2025-04-28T15:00:00-07:00", meeting_type: "Work Session" }]],
      [
        "HB 3795",
        [{ committee_code: "SHS", meeting_date: "2025-04-29T08:45:00-07:00", meeting_type: "Public Hearing" }],
      ],
    ] as const)("lists the meetings still ahead of %s at the time of the read", async ([measure, ahead]) => {
      system.clock.set("2025-04-26T17:00:00Z");

      const outcome = await callTool(connected, "get_measure", { measure });

      expect(liveStatusOf(outcome)?.schedule).toEqual(ahead);
    });

    it("lists a meeting that starts at the very time of the read, and not one that started a second before", async () => {
      // SB 69's HLWS work session is at 2025-04-28 15:00 Pacific, which is 22:00:00 UTC.
      system.clock.set("2025-04-28T22:00:00Z");
      const atTheTime = await callTool(connected, "get_measure", { measure: "SB 69" });
      system.clock.set("2025-04-28T22:00:01Z");
      const aSecondLater = await callTool(connected, "get_measure", { measure: "SB 69" });

      expect(liveStatusOf(atTheTime)?.schedule?.map((item) => item.meeting_date)).toEqual([
        "2025-04-28T15:00:00-07:00",
      ]);
      expect(liveStatusOf(aSecondLater)?.schedule).toEqual([]);
    });

    it("lists nothing for a Measure with no meeting ahead", async () => {
      system.clock.set("2025-12-15T17:00:00Z");

      const outcome = await callTool(connected, "get_measure", { measure: "HB 3795" });

      expect(liveStatusOf(outcome)).toMatchObject({ source: "olis", schedule: [] });
    });
  });
});
