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
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2025-12-15, after every row these Measures have was created: the fake OLIS hides a row created
  // after its clock.
  system = await startSystem({ clockAt: "2025-12-15T17:00:00Z" });
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
});
