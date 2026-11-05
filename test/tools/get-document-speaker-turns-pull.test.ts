// Seam 1 (test/CLAUDE.md): what the worker does with a Recording Log's links when the log is not a clean one, and when the
// index is missing from a database a worker left before it existed (ticket #126). The real logs are in
// get-document-speaker-turns.test.ts, and every one of them reads cleanly (34 with a link on every line), so the cases
// here need logs the fixture lacks.
//
// EVERY LOG BELOW IS MADE UP: its row (CommitteeMeetingDocumentId 9990xx, at the meeting of HALNRW 2025-01-22, the
// fixture's), its lines and its links are written by this file with test/support/made-up-pdf.ts. What is real is the
// meeting: its committee members and its Legislators rows, from which "Co-Chair Helm" is "Rep Helm", Ken Helm. A made-up log's
// text is not a quotation of OLIS's.
//
// Which cases copy (test/CLAUDE.md, "Templates"): the first describe copies the run's template of the fixture's pull
// (documents served), adds the made-up rows, serves their bytes and pulls, which fetches only what it adds; it reads
// only. The second copies the template, makes the database look as one before the index with `forgetSpeakerTurns`
// (test/support/old-database.ts, SQL that only arranges), and pulls again: that pull is the subject.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { madeUpPdf, type MadeUpLink } from "../support/made-up-pdf.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { forgetSpeakerTurns } from "../support/old-database.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const clockAt = "2026-08-05T17:00:00Z";
const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument";
const PLAYER = "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486";

/** A made-up CommitteeMeetingDocuments row for a Recording Log of the meeting of HALNRW on 2025-01-22. */
function logRow(id: number): Record<string, unknown> {
  return {
    CommitteeMeetingDocumentId: id,
    SessionKey: "2025R1",
    CommitteeCode: "HALNRW",
    MeetingDate: "2025-01-22T08:00:00",
    ExhibitReference: null,
    ExhibitTitle: "MADE UP recording log",
    Submitter: "staff",
    DocumentType: "Recording Log",
    MeasurePrefix: null,
    MeasureNumber: null,
    DocumentUrl: `${root}/${id}`,
    CreatedDate: "2025-01-29T13:13:06.5416935",
    ModifiedDate: null,
  };
}

const pageTop = 760;
const lineHeight = 12;

/**
 * A made-up log: one page of these lines, and for each line that starts with a timecode the two player links the real logs
 * print (one over the timecode and one over the text), at the line's height, each to `eventId` at the timecode's second
 * plus `skew`. `linked` lists the indexes of the lines that get links (every timecode line by default).
 */
function madeUpLog(
  lines: readonly string[],
  eventIds: readonly string[],
  options: { skew?: number; linked?: readonly number[] } = {},
): Uint8Array {
  const links: MadeUpLink[] = [];
  lines.forEach((line, index) => {
    const timecode = /^(\d\d):(\d\d):(\d\d) /.exec(line);
    if (timecode === null || (options.linked !== undefined && !options.linked.includes(index))) return;
    const second = Number(timecode[1]) * 3600 + Number(timecode[2]) * 60 + Number(timecode[3]) + (options.skew ?? 0);
    const y = pageTop - index * lineHeight;
    // With two events, the lines take turns: an odd second links the second event.
    const eventId = eventIds[second % eventIds.length];
    if (eventId === undefined) return;
    for (const x of [40, 120]) {
      links.push({
        page: 1,
        url: `${PLAYER}&eventID=${eventId}&startStreamAt=${second}`,
        rect: [x, y - 2, x + 60, y + 10],
      });
    }
  });
  return madeUpPdf([lines], { links });
}

const lines = [
  "MADE UP RECORDING LOG",
  "00:00:05 Meeting Called to Order",
  "00:00:06 Co-Chair Helm",
  "00:00:30 HB 2167 - Public Hearing",
  "00:00:31 Jane Q. Witness, MADE UP Association",
  "00:01:00 Meeting Adjourned",
];

type SpeakerTurns = {
  indexed: boolean;
  event_id: string | null;
  gap: string | null;
  conflicting_event_ids: string[];
  turn_count: number;
  pages_read_by_timecode: number[];
  turns: { offset_seconds: number; offset_source: string; speaker: string; legislator_code: string | null }[];
};

describe.for(eras)("made-up Recording Logs for a %s client", (era) => {
  let system: System;
  let connected: ConnectedClient;

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    system.olis.addRows("CommitteeMeetingDocuments", [logRow(999001), logRow(999002), logRow(999003)]);
    // 999001: no player link at all. 999002: links to two events. 999003: three timecode lines and links on two of them.
    system.olis.serveDocument("/liz/2025R1/Downloads/CommitteeMeetingDocument/999001", madeUpLog(lines, []));
    system.olis.serveDocument(
      "/liz/2025R1/Downloads/CommitteeMeetingDocument/999002",
      madeUpLog(lines, ["2099000001", "2099000002"]),
    );
    system.olis.serveDocument(
      "/liz/2025R1/Downloads/CommitteeMeetingDocument/999003",
      madeUpLog(lines, ["2099000003"], { linked: [1, 2] }),
    );
    await system.pullAgain();
    connected = await connectClient(era, system.handler);
  }, 60_000);

  afterAll(async () => {
    await connected.close();
    await system.stop();
  });

  async function turnsOf(id: number): Promise<SpeakerTurns> {
    const outcome = await callTool(connected, "get_document", { id: `recording-log-2025r1-${id}` });
    expect(outcome.isError).toBe(false);
    return outcome.structured?.["speaker_turns"] as SpeakerTurns;
  }

  it("a log with no player link has no index, says why, and keeps its text", async () => {
    expect(await turnsOf(999001)).toEqual({
      indexed: false,
      event_id: null,
      gap: "no_event_id",
      conflicting_event_ids: [],
      turn_count: 0,
      pages_read_by_timecode: [],
      turns: [],
    });
    const outcome = await callTool(connected, "get_document", { id: "recording-log-2025r1-999001" });
    expect(String(outcome.structured?.["text"])).toContain("00:00:06 Co-Chair Helm");
  });

  it("a log whose links name two events has no index, and says both", async () => {
    const turns = await turnsOf(999002);

    expect(turns).toMatchObject({ indexed: false, event_id: null, gap: "conflicting_event_ids", turn_count: 0 });
    expect([...turns.conflicting_event_ids].sort()).toEqual(["2099000001", "2099000002"]);
  });

  it("a page whose links cannot be matched to its lines is read from its timecodes, and a turn nobody resolves keeps its text", async () => {
    const turns = await turnsOf(999003);

    expect(turns).toMatchObject({ indexed: true, event_id: "2099000003", gap: null, pages_read_by_timecode: [1] });
    expect(turns.turns).toMatchObject([
      { offset_seconds: 6, offset_source: "timecode", speaker: "Co-Chair Helm", legislator_code: "Rep Helm" },
      {
        offset_seconds: 31,
        offset_source: "timecode",
        speaker: "Jane Q. Witness, MADE UP Association",
        legislator_code: null,
      },
    ]);
  });

  it("the meetings tool says the meeting has an index through its log 999003, and that 999001 and 999002 have none", async () => {
    const outcome = await callTool(connected, "meetings", {
      committee: "HALNRW",
      from: "2025-01-22",
      to: "2025-01-22",
    });

    const logs = (
      outcome.structured?.["meetings"] as { recording_logs: { id: string; speaker_turn_index: unknown }[] }[]
    )[0]?.recording_logs;
    expect(Object.fromEntries((logs ?? []).map((log) => [log.id, log.speaker_turn_index]))).toMatchObject({
      "recording-log-2025r1-288741": { event_id: "2025011038", turn_count: expect.any(Number) },
      "recording-log-2025r1-999001": null,
      "recording-log-2025r1-999002": null,
      "recording-log-2025r1-999003": { event_id: "2099000003", turn_count: 2 },
    });
  });

  it("the build report names the logs left with no index and the pages read by timecode", () => {
    const report = system.buildReport();

    expect(report["recording_log_gaps"]).toEqual([
      { id: "recording-log-2025r1-999001", source_url: `${root}/999001`, kind: "no_event_id", event_ids: [] },
      {
        id: "recording-log-2025r1-999002",
        source_url: `${root}/999002`,
        kind: "conflicting_event_ids",
        // In the order the links first name them: the first timecode line (00:00:05) takes the second event.
        event_ids: ["2099000002", "2099000001"],
      },
    ]);
    expect(report["recording_log_pages_read_by_timecode"]).toEqual([
      { id: "recording-log-2025r1-999003", source_url: `${root}/999003`, pages: [1] },
    ]);
  });
});

describe("a database a worker left before the index existed", () => {
  it("fetches each stored Recording Log once more to read its links, and never again after that", async () => {
    const system = await startCopiedSystem({ clockAt, documents: true });
    try {
      forgetSpeakerTurns(system.database.path);

      await system.pullAgain();
      const logFetches = system.olis.documentRequests().filter((path) => path.includes("/CommitteeMeetingDocument/"));
      await system.pullAgain();
      const logFetchesAfterAnother = system.olis
        .documentRequests()
        .filter((path) => path.includes("/CommitteeMeetingDocument/"));

      // The fixture's 34 Recording Logs are among its CommitteeMeetingDocuments; the Exhibits are not fetched again.
      expect(logFetches.filter((path) => path.endsWith("/288741"))).toHaveLength(1);
      expect(logFetches).toHaveLength(34);
      expect(logFetchesAfterAnother).toEqual(logFetches);
      const connected = await connectClient("legacy", system.handler);
      try {
        const outcome = await callTool(connected, "get_document", { id: "recording-log-2025r1-288741" });
        expect(outcome.structured?.["speaker_turns"]).toMatchObject({
          indexed: true,
          event_id: "2025011038",
          turn_count: expect.any(Number),
        });
      } finally {
        await connected.close();
      }
    } finally {
      await system.stop();
    }
  });
});
