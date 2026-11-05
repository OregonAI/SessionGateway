// Seam 1 (test/CLAUDE.md): what an agent sees of a Measure's hearings and of the turns of a Recording Log when the log is not
// one the fixture holds (ticket #127, owner decision of 2026-11-05: a Measure's hearings are every Agenda item naming it).
// The fixture's 34 real Recording Logs name one Measure on each Agenda line ("HB 3131 - Public Hearing"): none has a line
// like the 2026R1 logs' "SB 1542 and SB 1543 - Public Hearing" (log 315069), "HB 4077 and HB 4076 A - Public Hearing" (log
// 316088) or "SB 1542 and SB 1543 - Informational Meeting" (log 312105), whose lines are quoted in seam 2
// (src/packages/recording-log/tests/turn-context.test.ts). So EVERY LOG HERE IS MADE UP, in the shape of those lines: its
// row (CommitteeMeetingDocumentId 9991xx, at the fixture's meeting of HALNRW 2025-01-22), its lines and its links are
// written by this file with test/support/made-up-pdf.ts. HB 3124 and HB 3723 are Measures of the fixture's index
// (feed/Measures.json) that no real log names. A made-up log's text is not a quotation of OLIS's.
//
// Which cases copy (test/CLAUDE.md, "Templates"): the describe copies the run's template of the fixture's pull (documents
// served), adds the made-up rows, serves their bytes and pulls, which fetches only what it adds; its cases only read.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { madeUpPdf, type MadeUpLink } from "../support/made-up-pdf.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const clockAt = "2026-08-05T17:00:00Z";
const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument";
const PLAYER = "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486";

/** A made-up CommitteeMeetingDocuments row for a Recording Log of a meeting: HALNRW on 2025-01-22 unless it says. */
function logRow(id: number, meeting = { committee: "HALNRW", date: "2025-01-22" }): Record<string, unknown> {
  return {
    CommitteeMeetingDocumentId: id,
    SessionKey: "2025R1",
    CommitteeCode: meeting.committee,
    MeetingDate: `${meeting.date}T08:00:00`,
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

const hearingLog = [
  "MADE UP RECORDING LOG",
  "00:00:05 Meeting Called to Order",
  "00:00:06 Co-Chair Helm",
  "00:00:30 HB 3124 and HB 3723 - Public Hearing",
  "00:00:31 Jane Q. Witness, MADE UP Association",
  "00:01:00 HB 3723 - Work Session",
  "00:01:01 Co-Chair Helm",
  "00:02:00 Meeting Adjourned",
];
const informationalLog = [
  "MADE UP RECORDING LOG",
  "00:00:05 Meeting Called to Order",
  "00:00:20 HB 3124 - Informational Meeting",
  "00:00:21 John Q. Witness, MADE UP Association",
  "00:02:00 Meeting Adjourned",
];
/** A speaker line of 700 words, wrapped onto lines of 15 as the real logs wrap a long title: more than a Passage may hold (510 tokens). */
const longSpeaker = Array.from({ length: 700 }, (_, index) => `W${String(index).padStart(3, "0")}`).reduce<string[]>(
  (lines, word, index) => {
    if (index % 15 === 0) lines.push(index === 0 ? `00:00:07 ${word}` : word);
    else lines[lines.length - 1] += ` ${word}`;
    return lines;
  },
  [],
);
const longLog = [
  "MADE UP RECORDING LOG",
  "00:00:05 Meeting Called to Order",
  "00:00:06 Co-Chair Helm",
  ...longSpeaker,
  "00:02:00 Meeting Adjourned",
];
const citingLog = [
  "MADE UP RECORDING LOG",
  "00:00:05 Meeting Called to Order",
  "00:00:06 Co-Chair Helm",
  "00:00:07 Pat Poe, Counsel, ORS 183.310 rules",
  "00:02:00 Meeting Adjourned",
];

type Hearing = {
  meeting_id: string;
  recording_log_id: string;
  agenda_item: string;
  kind: string;
  measure_ids: string[];
  first_turn: { timecode: string; offset_seconds: number; offset_source: string; speaker: string; player_link: string };
};

describe.for(eras)("made-up Recording Logs that name several Measures, for a %s client", (era) => {
  let system: System;
  let connected: ConnectedClient;

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    system.olis.addRows("CommitteeMeetingDocuments", [logRow(999101), logRow(999102), logRow(999103), logRow(999104)]);
    system.olis.serveDocument(
      `/liz/2025R1/Downloads/CommitteeMeetingDocument/999101`,
      madeUpLog(hearingLog, ["2099010101"]),
    );
    system.olis.serveDocument(
      `/liz/2025R1/Downloads/CommitteeMeetingDocument/999102`,
      madeUpLog(informationalLog, ["2099010102"]),
    );
    system.olis.serveDocument(
      `/liz/2025R1/Downloads/CommitteeMeetingDocument/999103`,
      madeUpLog(longLog, ["2099010103"]),
    );
    system.olis.serveDocument(
      `/liz/2025R1/Downloads/CommitteeMeetingDocument/999104`,
      madeUpLog(citingLog, ["2099010104"]),
    );
    await system.pullAgain();
    connected = await connectClient(era, system.handler);
  }, 60_000);

  afterAll(async () => {
    await connected.close();
    await system.stop();
  });

  async function hearingsOf(measure: string): Promise<Hearing[]> {
    const outcome = await callTool(connected, "get_measure", { measure });
    expect(outcome.isError).toBe(false);
    return outcome.structured?.["hearings"] as Hearing[];
  }

  it("lists an Agenda line that names two Measures as a hearing of each, with the line's kind and both Measures", async () => {
    const [first] = await hearingsOf("HB 3124");

    expect(first).toMatchObject({
      meeting_id: "meeting-2025r1-halnrw-2025-01-22-0800",
      recording_log_id: "recording-log-2025r1-999101",
      agenda_item: "HB 3124 and HB 3723 - Public Hearing",
      kind: "Public Hearing",
      measure_ids: ["measure-2025r1-hb3124", "measure-2025r1-hb3723"],
      first_turn: {
        timecode: "00:00:31",
        offset_seconds: 31,
        offset_source: "link",
        speaker: "Jane Q. Witness, MADE UP Association",
        player_link: `${PLAYER}&eventID=2099010101&startStreamAt=31`,
      },
    });
  });

  it("lists a Measure's hearings by the log, in the order of the recording, labelled by their wording", async () => {
    const hearings = await hearingsOf("HB 3124");
    const work = await hearingsOf("HB 3723");

    expect(hearings.map((hearing) => [hearing.recording_log_id, hearing.agenda_item, hearing.kind])).toEqual([
      ["recording-log-2025r1-999101", "HB 3124 and HB 3723 - Public Hearing", "Public Hearing"],
      ["recording-log-2025r1-999102", "HB 3124 - Informational Meeting", "Informational Meeting"],
    ]);
    expect(work.map((hearing) => [hearing.agenda_item, hearing.kind, hearing.first_turn.offset_seconds])).toEqual([
      ["HB 3124 and HB 3723 - Public Hearing", "Public Hearing", 31],
      ["HB 3723 - Work Session", "Work Session", 61],
    ]);
  });

  it("finds a witness's turn with the second's source, and the turn keeps the first Measure of its line", async () => {
    const outcome = await callTool(connected, "search", { query: "Jane Q. Witness" });

    const hits = outcome.structured?.["results"] as { turn: Record<string, unknown> | null }[];
    expect(hits.find((hit) => hit.turn !== null)?.turn).toMatchObject({
      speaker: "Jane Q. Witness, MADE UP Association",
      measure_id: "measure-2025r1-hb3124",
      offset_seconds: 31,
      offset_source: "link",
    });
  });

  it("counts the turn too long for a Passage in the build report, and counts it again on the next pull without cutting the log again", async () => {
    const entry = [{ id: "recording-log-2025r1-999103", source_url: `${root}/999103`, turns: 1 }];
    expect(system.buildReport()["recording_log_turns_without_passage"]).toEqual(entry);

    await system.pullAgain();

    expect(system.buildReport()["recording_log_turns_without_passage"]).toEqual(entry);
  });

  it("returns one Hit for a turn that a citation and a keyword both find", async () => {
    // The turn's line holds ORS 183.310, which the query cites, and the name "Poe", which it searches for.
    const outcome = await callTool(connected, "search", { query: "ORS 183.310 Poe", kind: "recording_log" });

    const hits = outcome.structured?.["results"] as {
      id: string;
      snippet: string;
      turn: unknown;
      found_by: string[];
    }[];
    const ofTheTurn = hits.filter((hit) => hit.id === "recording-log-2025r1-999104" && hit.turn !== null);
    expect(ofTheTurn).toHaveLength(1);
    expect(ofTheTurn[0]?.found_by).toEqual(["citation", "keyword"]);
  });
});
