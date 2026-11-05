// Seam 1 (test/CLAUDE.md): `meetings` shows the Recording Log of each Meeting the 2025R1 fixture holds
// (ticket #124). A Recording Log names no Measure, so the fixture build takes it from its Meeting, as a
// rule of its own (test/fixtures/olis-2025R1/README.md). The clock is after every row's CreatedDate (the
// latest, SRULES's log 317265, was created 2026-08-04), so the pull lists them all. No file is served: the
// cases read the listing, and the worker lists each document as not fetched.
//
// Expected values are literals from outside the fixture: the full feed cache's CommitteeMeetingDocuments
// rows of DocumentType "Recording Log", counted against the fixture's 36 meetings on 2026-11-05 (34 have
// exactly one, and HHED 2025-02-13 and SHS 2025-05-22 have none), and the id of HALNRW's log of 2025-01-22
// (row 288741, titled "HALNRW 1-22-2025 (recording log)").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({ clockAt: "2026-09-01T19:00:00Z", documents: false });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type Listed = { id: string; title: string; source_url: string };
type MeetingOutput = { id: string; at: string; recording_logs: Listed[] };

describe.for(eras)("meetings and the fixture's Recording Logs, for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  it("lists one Recording Log for 34 of the fixture's 36 meetings, and none for HHED 02-13 and SHS 05-22", async () => {
    // A call returns whole days up to a size limit, so ask again from the day after the last one returned.
    const meetings: MeetingOutput[] = [];
    for (let from = "2025-01-01"; from !== ""; ) {
      const outcome = await callTool(connected, "meetings", { from, to: "2025-12-31" });
      expect(outcome.isError).toBe(false);
      const page = outcome.structured?.["meetings"] as MeetingOutput[];
      meetings.push(...page);
      const last = page.at(-1)?.at ?? "";
      from =
        outcome.structured?.["truncated"] === true
          ? new Date(Date.parse(`${last.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
          : "";
    }
    expect(meetings).toHaveLength(36);
    expect(meetings.filter((meeting) => meeting.recording_logs.length === 1)).toHaveLength(34);
    expect(meetings.filter((meeting) => meeting.recording_logs.length === 0).map((meeting) => meeting.id)).toEqual([
      "meeting-2025r1-hhed-2025-02-13-0800",
      "meeting-2025r1-shs-2025-05-22-0800",
    ]);
  });

  it("names HALNRW's Recording Log of 2025-01-22 with the title and address OLIS gives", async () => {
    const outcome = await callTool(connected, "meetings", { committee: "HALNRW", from: "2025-01-22", to: "2025-01-22" });

    const meetings = outcome.structured?.["meetings"] as MeetingOutput[];
    expect(meetings.map((meeting) => meeting.id)).toEqual(["meeting-2025r1-halnrw-2025-01-22-0800"]);
    expect(meetings[0]?.recording_logs).toMatchObject([
      {
        id: "recording-log-2025r1-288741",
        title: "HALNRW 1-22-2025 (recording log)",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/288741",
      },
    ]);
  });
});
