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

describe("agenda items that name no Measure", () => {
  // MADE UP FOR THIS TEST. Every agenda item in the committed fixture is about a Measure, but 3,598 of the
  // 9,275 in the full 2025R1 feed are not (.cache/olis-2025R1/feed/CommitteeAgendaItems.json): executive
  // appointments with a BoardName and an ExecutiveAppointee (row 202186 is one), and notices with only
  // Comments. These three rows, with the made-up ids 900201 to 900203, are shaped like those and added to
  // SLB's meeting of 2025-01-30. The PrintOrder is a string: "10" comes after "2", and an item with none is last.
  it("shows an appointment's board and appointee, and puts the items in print order (made-up rows)", async () => {
    const itemRow = (id: number, fields: Record<string, unknown>): Record<string, unknown> => ({
      CommitteeAgendaItemId: id,
      SessionKey: "2025R1",
      CommitteCode: "SLB",
      MeetingDate: "2025-01-30T08:00:00",
      MeasurePrefix: null,
      MeasureNumber: null,
      BoardName: null,
      ExecutiveAppointee: null,
      MeetingType: null,
      Action: null,
      PrintOrder: null,
      Comments: null,
      ...fields,
    });
    const { connected } = await start({
      clockAt: "2025-01-29T20:00:00Z",
      documents: false,
      olis: {
        strayRows: {
          CommitteeAgendaItems: [
            itemRow(900203, { Comments: "<b>A notice with no print order.</b>" }),
            itemRow(900202, {
              PrintOrder: "10",
              Comments: '<b>A notice.</b>\n<a href="https://example.org/">link</a>',
            }),
            itemRow(900201, {
              PrintOrder: "2",
              BoardName: "Commission on Example Affairs",
              ExecutiveAppointee: "PatExample",
              MeetingType: "Public Hearing and Work Session    (Executive Appointment)",
            }),
          ],
        },
      },
    });

    const outcome = await callTool(connected, "meetings", { committee: "SLB", from: "2025-01-30", to: "2025-01-30" });

    const meetings = outcome.structured?.["meetings"] as { id: string; agenda_items: unknown[] }[];
    expect(meetings.map((meeting) => meeting.id)).toEqual(["meeting-2025r1-slb-2025-01-30-0800"]);
    expect(meetings[0]?.agenda_items).toEqual([
      expect.objectContaining({ print_order: "1", measure_id: "measure-2025r1-sb69" }),
      {
        print_order: "2",
        measure_id: null,
        meeting_type: "Public Hearing and Work Session    (Executive Appointment)",
        action: null,
        comments: null,
        board_name: "Commission on Example Affairs",
        executive_appointee: "PatExample",
      },
      expect.objectContaining({
        print_order: "10",
        measure_id: null,
        comments: '<b>A notice.</b>\n<a href="https://example.org/">link</a>',
      }),
      expect.objectContaining({ print_order: null, measure_id: null }),
    ]);
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

describe("the tool-call rate limit", () => {
  // The MCP specification requires servers to rate-limit tool calls, over every tool together
  // (get-measure-rate-limit.test.ts shows the other three). A third `meetings` call in a limit of two is refused.
  it("counts meetings calls with the others, and refuses the one past the limit", async () => {
    const { connected } = await start({
      clockAt: "2025-01-29T20:00:00Z",
      documents: false,
      serverEnv: { MCP_RATE_LIMIT: "2", MCP_RATE_WINDOW_SECONDS: "60" },
    });

    const first = await callTool(connected, "meetings", { measure: "SB 69" });
    const second = await callTool(connected, "get_measure", { measure: "SB 69" });
    const refused = await callTool(connected, "meetings", { measure: "SB 69" });

    expect([first.isError, second.isError]).toEqual([false, false]);
    expect(refused.isError).toBe(true);
    expect(refused.structured).toBeUndefined();
    expect(refused.text).toMatch(/rate limit/i);
  });
});
