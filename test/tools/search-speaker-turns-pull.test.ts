// Seam 1 (test/CLAUDE.md): a database that already holds the speaker-turn index (built under schema step 2, ticket #126) gets
// the turns' Passages from the turns it stores, without fetching a log again (ticket #127, ADR-0053's "Turns and Passages").
//
// Each case copies the run's template for its options (documents served, the fixture's clock 2026-08-05 10:00), makes the
// database look as one a worker left at version 2 with `leaveTurnsUnlinkedFromPassages` (test/support/old-database.ts, SQL
// that only arranges: the index is stored, and each Recording Log has one passage holding its whole text) and pulls again:
// that pull is the subject, and every assertion goes through the tools and the fake OLIS's request log.
//
// The expected values are those of search-speaker-turns.test.ts (Kurt Williams's turn at 00:02:49 of 288741, event 2025011038).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { leaveTurnsUnlinkedFromPassages } from "../support/old-database.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;
let connected: ConnectedClient;
let requestsBefore: string[];

type Hit = { id: string; snippet: string; turn: { speaker: string; timecode: string; player_link: string } | null };

async function turnHitsFor(query: string): Promise<Hit[]> {
  const outcome = await callTool(connected, "search", { query });
  expect(outcome.isError).toBe(false);
  return (outcome.structured?.["results"] as Hit[]).filter((hit) => hit.turn !== null);
}

beforeAll(async () => {
  system = await startCopiedSystem({ clockAt: "2026-08-05T17:00:00Z", documents: true });
  leaveTurnsUnlinkedFromPassages(system.database.path);
  requestsBefore = [...system.olis.documentRequests()];
  await system.pullAgain();
  connected = await connectClient("legacy", system.handler);
}, 120_000);

afterAll(async () => {
  await connected.close();
  await system.stop();
});

describe("a database with a speaker-turn index and no turn Passages", () => {
  it("finds a witness's turn after the next pull", async () => {
    const hits = await turnHitsFor("Kurt Williams");

    expect(hits[0]).toMatchObject({
      id: "recording-log-2025r1-288741",
      turn: {
        speaker: "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
        timecode: "00:02:49",
        player_link:
          "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=2025011038&startStreamAt=169",
      },
    });
  });

  it("fetches no Recording Log to do it", () => {
    const fetchedByThePull = system.olis.documentRequests().slice(requestsBefore.length);

    expect(fetchedByThePull.filter((path) => path.includes("/CommitteeMeetingDocument/"))).toEqual([]);
  });

  it("holds the turn once: another pull changes nothing, and fetches nothing", async () => {
    const before = await turnHitsFor("Kurt Williams");
    const requests = system.olis.documentRequests().length;

    await system.pullAgain();

    expect(await turnHitsFor("Kurt Williams")).toEqual(before);
    expect(system.olis.documentRequests()).toHaveLength(requests);
  });

  it("lists HB 3131's three hearings after the next pull, from the Agenda items the turns hold, and fetches no log to do it", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

    const hearings = outcome.structured?.["hearings"] as {
      recording_log_id: string;
      kind: string;
      measure_ids: string[];
    }[];
    expect(hearings.map((hearing) => [hearing.recording_log_id, hearing.kind, hearing.measure_ids])).toEqual([
      ["recording-log-2025r1-288741", "Public Hearing", ["measure-2025r1-hb3131"]],
      ["recording-log-2025r1-289259", "Public Hearing", ["measure-2025r1-hb3131"]],
      ["recording-log-2025r1-292588", "Work Session", ["measure-2025r1-hb3131"]],
    ]);
  });
});
