// Seam 1 (test/CLAUDE.md): `meetings` where a case needs a database of its own: a clock the shared
// databases of meetings.test.ts and meetings-past.test.ts do not have, or a row the committed fixture
// lacks. Each case builds its own system, and the harness serves a made-up row to that one worker; the
// committed fixture is never edited by hand (test/fixtures/CLAUDE.md).
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: { system: System; connected: ConnectedClient }[] = [];

async function start(options: SystemOptions): Promise<{ system: System; connected: ConnectedClient }> {
  const system = await startSystem(options);
  const entry = { system, connected: await connectClient("2026-07-28", system.handler) };
  started.push(entry);
  return entry;
}

afterEach(async () => {
  for (const { system, connected } of started.splice(0)) {
    await connected.close();
    await system.stop();
  }
});

type MeetingOutput = { id: string; [field: string]: unknown };

async function meetingsOnSb69(connected: ConnectedClient): Promise<MeetingOutput[]> {
  const outcome = await callTool(connected, "meetings", { measure: "SB 69" });
  expect(outcome.isError).toBe(false);
  return outcome.structured?.["meetings"] as MeetingOutput[];
}

describe("a Recording Log", () => {
  // MADE UP FOR THIS TEST. The committed fixture has no Recording Log row: of the 86
  // CommitteeMeetingDocuments rows, none has the type "Recording Log" (#5 found it, and ADR-0011 says how
  // the row is read when there is one). The full 2025R1 feed has 1,492 of them, one for most meetings, and
  // adding one Measure's to the fixture is a download run the owner has to approve. So this case adds a row
  // of that shape, with the made-up id 900101, to SLB's meeting of 2025-01-30, and serves a fixture file
  // (Exhibit 288650's) as its document. It shows the wiring from the row to the tool, not a real log.
  const recordingLogUrl = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/900101";

  it("is listed with the meeting it belongs to, apart from the Exhibits (made-up row)", async () => {
    const { connected } = await start({
      clockAt: "2025-01-29T20:00:00Z",
      documents: true,
      olis: {
        strayRows: {
          CommitteeMeetingDocuments: [
            {
              SessionKey: "2025R1",
              CommitteeMeetingDocumentId: 900101,
              CommitteeCode: "SLB",
              MeetingDate: "2025-01-30T08:00:00",
              DocumentType: "Recording Log",
              MeasurePrefix: null,
              MeasureNumber: null,
              DocumentUrl: recordingLogUrl,
            },
          ],
        },
        strayDocuments: { [new URL(recordingLogUrl).pathname]: "committee-meeting-documents/288650.pdf" },
      },
    });

    const meetings = await meetingsOnSb69(connected);

    const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
    expect(byId.get("meeting-2025r1-slb-2025-01-30-0800")?.["recording_logs"]).toEqual([
      { id: "recording-log-2025r1-900101", label: "Recording Log", source_url: recordingLogUrl },
    ]);
    // It is the meeting's Recording Log and not an Exhibit, and no other meeting has it.
    expect(
      (byId.get("meeting-2025r1-slb-2025-01-30-0800")?.["exhibits"] as { id: string }[]).map((exhibit) => exhibit.id),
    ).toEqual(["exhibit-2025r1-288650"]);
    expect(byId.get("meeting-2025r1-slb-2025-01-28-0800")?.["recording_logs"]).toEqual([]);
    // Its id is one get_document resolves, to a document of its own kind.
    const served = await callTool(connected, "get_document", { id: "recording-log-2025r1-900101" });
    expect(served.isError).toBe(false);
    expect(served.structured).toMatchObject({ kind: "recording_log", source_url: recordingLogUrl });
  });
});

describe("the next meeting", () => {
  // The clock is noon in Oregon on 2025-02-12. HHED's meeting of 2025-02-13 is ahead of it, and the feed's row
  // for it says "Cancelled" (feed/CommitteeMeetings.json; the fixture holds each row's final state, so the
  // row says what it says now). The committee's next meeting is the one on 2025-02-20, which is "Scheduled".
  it("is not a cancelled meeting, which is still listed as ahead", async () => {
    const { connected } = await start({ clockAt: "2025-02-12T20:00:00Z", documents: false });

    const outcome = await callTool(connected, "meetings", { committee: "HHED" });

    const meetings = outcome.structured?.["meetings"] as { id: string; status: string; upcoming: boolean }[];
    expect(meetings.map((meeting) => [meeting.id, meeting.status, meeting.upcoming])).toEqual([
      ["meeting-2025r1-hhed-2025-02-06-0800", "Scheduled", false],
      ["meeting-2025r1-hhed-2025-02-13-0800", "Cancelled", true],
      ["meeting-2025r1-hhed-2025-02-20-0800", "Scheduled", true],
    ]);
    expect(outcome.structured?.["next_meeting_id"]).toBe("meeting-2025r1-hhed-2025-02-20-0800");
  });
});
