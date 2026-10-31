// Seam 1 (test/CLAUDE.md): where a Measure is and what has happened to it, as get_measure shows it
// with the whole system behind it. A fake OLIS serves the committed fixture, the ingest worker pulls
// it into a database, and an MCP client calls the tool in-process. One database serves every case
// here because none changes it; cases that change the feed are in get-measure-votes-feed.test.ts.
//
// This is what the last full pull stored, dated by the result's `as_of`. The live status block, read
// from OLIS when the request arrives, is ticket #21's.
//
// Expected values are literals from the fixture's feed rows (test/fixtures/olis-2025R1/feed/): the
// Measures rows' CurrentLocation and CurrentCommitteeCode, and the MeasureHistoryActions rows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2025-12-15, after every row these Measures have was created: the fake OLIS hides a row created
  // after its clock.
  system = await startCopiedSystem({ clockAt: "2025-12-15T17:00:00Z" });
});

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("get_measure location for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // The Measures rows, as the fixture holds them:
  //   SB 69    "CurrentLocation":"Chapter Number Assigned",   "CurrentCommitteeCode":null
  //   HB 3795  "CurrentLocation":"House Desk - Vetoed",       "CurrentCommitteeCode":null
  //   SB 921   "CurrentLocation":"In Senate Committee",       "CurrentCommitteeCode":"JWM"
  //   HB 3131  "CurrentLocation":"In House Committee",        "CurrentCommitteeCode":"JWM"
  it.for([
    ["SB 69", "Chapter Number Assigned", null],
    ["HB 3795", "House Desk - Vetoed", null],
    ["SB 921", "In Senate Committee", "JWM"],
    ["HB 3131", "In House Committee", "JWM"],
  ] as const)("shows where %s is: %s, in committee %s", async ([measure, current, committeeCode]) => {
    const outcome = await callTool(connected, "get_measure", { measure });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["location"]).toEqual({ current, committee_code: committeeCode });
  });

  // SB 69's MeasureHistoryActions rows in the fixture, as OLIS prints the history: oldest first, each
  // with the chamber and the time the action happened. The feed's ActionDate carries no offset and is
  // Pacific local time (olis-odata.md section 6); Oregon moved from UTC-8 to UTC-7 on 2025-03-09, so
  // January and February read -08:00 and April and May -07:00. The text is the feed's, spaces and all
  // ("Recommendation: Do pass with amendments.  (Printed A-Eng.)" has two spaces after its full stop).
  const sb69History = [
    {
      chamber: "senate",
      date: "2025-01-13T09:07:30-08:00",
      text: "Introduction and first reading. Referred to President's desk.",
    },
    { chamber: "senate", date: "2025-01-17T14:13:22-08:00", text: "Referred to Labor and Business." },
    { chamber: "senate", date: "2025-01-21T08:01:00-08:00", text: "Informational Meeting held." },
    { chamber: "senate", date: "2025-01-28T08:01:00-08:00", text: "Public Hearing held." },
    { chamber: "senate", date: "2025-01-30T08:02:00-08:00", text: "Public Hearing and Work Session held." },
    {
      chamber: "senate",
      date: "2025-02-03T10:37:16-08:00",
      text: "Recommendation: Do pass with amendments.  (Printed A-Eng.)",
    },
    { chamber: "senate", date: "2025-02-04T10:49:12-08:00", text: "Second reading." },
    { chamber: "senate", date: "2025-02-06T11:21:32-08:00", text: "Third reading.  Carried by Bonham.  Passed." },
    { chamber: "house", date: "2025-02-11T11:19:12-08:00", text: "First reading. Referred to Speaker's desk." },
    { chamber: "house", date: "2025-02-12T13:25:30-08:00", text: "Referred to Labor and Workplace Standards." },
    { chamber: "house", date: "2025-04-21T15:01:00-07:00", text: "Public Hearing held." },
    { chamber: "house", date: "2025-04-28T15:02:00-07:00", text: "Work Session held." },
    { chamber: "house", date: "2025-05-01T10:21:28-07:00", text: "Recommendation: Do pass." },
    { chamber: "house", date: "2025-05-01T12:23:04-07:00", text: "Second reading." },
    { chamber: "house", date: "2025-05-05T11:30:33-07:00", text: "Third reading. Carried by Grayber. Passed." },
    { chamber: "senate", date: "2025-05-06T12:30:33-07:00", text: "President signed." },
    { chamber: "house", date: "2025-05-06T15:00:36-07:00", text: "Speaker signed." },
    { chamber: "senate", date: "2025-05-14T16:15:43-07:00", text: "Governor signed." },
    { chamber: "senate", date: "2025-05-20T10:32:36-07:00", text: "Chapter 85, 2025 Laws." },
    {
      chamber: "senate",
      date: "2025-05-20T10:38:02-07:00",
      text: "Effective on the 91st day following adjournment sine die.",
    },
  ];

  it("shows SB 69's whole history, oldest first, with each action's time in Pacific time and its offset", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

    expect(outcome.structured?.["history"]).toEqual(sb69History);
  });

  // HB 3795 has 30 rows in the fixture, from "First reading. Referred to Speaker's desk." (House,
  // 2025-02-27T11:29:00) to the veto's end. Its last three rows say what happened to it:
  //   "Governor vetoed."                                      2025-06-24T16:46:24 H
  //   "Governor's message read in the House."                 2025-06-25T11:45:00 H (row created 2025-07-14)
  //   "Veto sustained in accordance with Article V, Section 15b, Oregon Constitution."
  //                                                           2025-06-27T23:16:00 H (row created 2025-08-25)
  // The last two were created long after they happened, which the history's order must not care about.
  it("shows HB 3795's history ending in the veto, with its first and last actions", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3795" });

    const history = outcome.structured?.["history"] as { chamber: string; date: string; text: string }[];
    expect(history).toHaveLength(30);
    expect(history[0]).toEqual({
      chamber: "house",
      date: "2025-02-27T11:29:00-08:00",
      text: "First reading. Referred to Speaker's desk.",
    });
    expect(history.slice(-3)).toEqual([
      { chamber: "house", date: "2025-06-24T16:46:24-07:00", text: "Governor vetoed." },
      { chamber: "house", date: "2025-06-25T11:45:00-07:00", text: "Governor's message read in the House." },
      {
        chamber: "house",
        date: "2025-06-27T23:16:00-07:00",
        text: "Veto sustained in accordance with Article V, Section 15b, Oregon Constitution.",
      },
    ]);
  });
});
