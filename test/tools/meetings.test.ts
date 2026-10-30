// Seam 1 (test/CLAUDE.md): `meetings` as an agent sees it, with the whole system behind it. A fake
// OLIS serves the committed fixture and its 278 documents as the feed stood at noon Pacific on
// 2025-01-29 (rows created by then), the ingest worker pulls them into a database, and an MCP client
// calls the tool in-process. One database serves every case in this file because none of them
// changes it. The cases that need the Session after the fact are in meetings-past.test.ts, and the
// one that needs a row the fixture lacks is in meetings-recording-log.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // Spec #1 case (c): "with the clock at 2025-01-29". Noon in Oregon.
  system = await startSystem({ clockAt: "2025-01-29T20:00:00Z", documents: true });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("meetings for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Expected values are literals from outside the code: the meeting rows of SB 69 in
  // test/fixtures/olis-2025R1/feed/CommitteeAgendaItems.json and CommitteeMeetings.json, and spec #1's
  // case (c): "SLB's 2025-01-30 Public Hearing and Work Session, with -1 and -2 posted". The fixture
  // holds SB 69's later meetings too (HLWS, in April), but their rows were created after the clock.
  it("names SLB's 2025-01-30 Public Hearing and Work Session as the next meeting on SB 69", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 69" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["next_meeting_id"]).toBe("meeting-2025r1-slb-2025-01-30-0800");
    const meetings = outcome.structured?.["meetings"] as { id: string; upcoming: boolean }[];
    expect(meetings.map((meeting) => [meeting.id, meeting.upcoming])).toEqual([
      ["meeting-2025r1-slb-2025-01-21-0800", false],
      ["meeting-2025r1-slb-2025-01-28-0800", false],
      ["meeting-2025r1-slb-2025-01-30-0800", true],
    ]);
    expect(meetings[2]).toMatchObject({
      committee: { id: "committee-2025r1-slb", code: "SLB", name: "Labor and Business" },
      at: "2025-01-30T08:00:00-08:00",
      status: "Scheduled",
    });
  });

  // An unknown Measure is an expected outcome, so it is a tool error that tells the agent what to give
  // (src/CLAUDE.md, "Errors"). The fixture holds no SB 9999.
  it("answers a Measure the Session does not have with an error that says what to give", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 9999" });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('No Measure "SB 9999" in the 2025R1 Session.');
  });
});
