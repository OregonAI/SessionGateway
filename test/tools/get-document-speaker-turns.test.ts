// Seam 1 (test/CLAUDE.md): the speaker-turn index of the fixture's real Recording Logs, as an agent sees it through
// `get_document` and `meetings` (ticket #126, ADR-0052). A fake OLIS serves the committed fixture and its documents
// (the 34 real Recording Logs among them, ticket #124), the worker reads each log's text and link annotations, and an
// MCP client calls the tools in-process. Nothing here is made up: the made-up logs (gaps, a page read by timecode) are in
// get-document-speaker-turns-pull.test.ts.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md, Database,
// Templates). The clock is the fixture's, 2026-08-05 10:00 in Oregon (every Recording Log exists by then).
//
// Expected values are literals from the fixture, never from a tool's output:
// - the turns are lines of the logs' text (documents/committee-meeting-documents/<id>.pdf) as the pdf-text package
//   extracts it; a turn's second is the `startStreamAt` of the player link that PDF.js reads on its line, which equals the
//   line's timecode in hours, minutes and seconds in every row below (00:01:47 = 107);
// - the event IDs are the `eventID` of those links;
// - a Legislator Code is the CommitteeMembers row of the meeting's committee whose Legislators row (feed/Legislators.json)
//   has the name the line gives: "Co-Chair Helm" is "Rep Helm", Ken Helm;
// - the turn counts are the log's timecoded lines minus the ones that are not speaker lines: 288741 has 48 timecoded
//   lines, of which 10 are the call to order, "Adoption of Committee Rules", the motion, its vote, the five hearings
//   (HB 2167, 2168, 2166, 3131, 2164) and the adjournment, so 38 are turns;
// - the player link is the address those logs use, with the log's own clientID (4879615486).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({ clockAt: "2026-08-05T17:00:00Z", documents: true });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type Turn = {
  timecode: string;
  offset_seconds: number;
  offset_source: string;
  speaker: string;
  legislator_code: string | null;
  legislator: { id: string; name: string } | null;
  agenda_item: string | null;
  measure_id: string | null;
  player_link: string;
};
type SpeakerTurns = {
  indexed: boolean;
  event_id: string | null;
  gap: string | null;
  turn_count: number;
  pages_read_by_timecode: number[];
  turns: Turn[];
};

const PLAYER = "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486";

function playerLink(eventId: string, seconds: number): string {
  return `${PLAYER}&eventID=${eventId}&startStreamAt=${seconds}`;
}

describe.for(eras)("the speaker-turn index in get_document for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  async function turnsOf(id: string): Promise<{ speakerTurns: SpeakerTurns; structured: Record<string, unknown> }> {
    const outcome = await callTool(connected, "get_document", { id });
    expect(outcome.isError).toBe(false);
    const structured = outcome.structured ?? {};
    return { speakerTurns: structured["speaker_turns"] as SpeakerTurns, structured };
  }

  it("gives HALNRW 2025-01-22's log (288741) its event ID and 38 turns, with the envelope's as-of time and notice", async () => {
    const { speakerTurns, structured } = await turnsOf("recording-log-2025r1-288741");

    expect(speakerTurns).toMatchObject({ indexed: true, event_id: "2025011038", gap: null, turn_count: 38 });
    expect(speakerTurns.turns).toHaveLength(38);
    expect(speakerTurns.pages_read_by_timecode).toEqual([]);
    expect(structured["kind"]).toBe("recording_log");
    expect.soft(structured["as_of"]).toBe("2026-08-05T10:00:00-07:00");
    expect.soft(structured["notice"]).toMatch(/not the official record/i);
    expect(String(structured["text"])).toContain("00:00:04 Co-Chair Helm");
  });

  it("returns the turns in media-clock order", async () => {
    for (const id of ["recording-log-2025r1-288741", "recording-log-2025r1-289259", "recording-log-2025r1-295094"]) {
      const { speakerTurns } = await turnsOf(id);
      const seconds = speakerTurns.turns.map((turn) => turn.offset_seconds);

      expect(seconds, id).toEqual(seconds.toSorted((a, b) => a - b));
    }
  });

  it("gives a Legislator turn its Legislator Code and Legislator, and the Agenda item and Measure it was spoken under", async () => {
    const { speakerTurns } = await turnsOf("recording-log-2025r1-288741");
    const at = (timecode: string): Turn | undefined => speakerTurns.turns.find((turn) => turn.timecode === timecode);

    // 00:00:04, before the log's first Agenda item.
    expect(at("00:00:04")).toEqual({
      timecode: "00:00:04",
      offset_seconds: 4,
      offset_source: "link",
      speaker: "Co-Chair Helm",
      legislator_code: "Rep Helm",
      legislator: { id: expect.stringMatching(/^legislator-2025r1-/), name: "Ken Helm" },
      agenda_item: null,
      measure_id: null,
      player_link: playerLink("2025011038", 4),
    });
    // 00:11:29 and 00:21:43, under HB 2167: a first-name initial, and a compound surname the feed holds as "McDonald".
    expect(at("00:11:29")).toMatchObject({
      offset_seconds: 689,
      speaker: "Rep. B. Levy",
      legislator_code: "Rep Levy B",
      agenda_item: "HB 2167 - Public Hearing",
      measure_id: "measure-2025r1-hb2167",
      player_link: playerLink("2025011038", 689),
    });
    expect(at("00:21:43")).toMatchObject({
      offset_seconds: 1303,
      speaker: "Vice-Chair Finger McDonald",
      legislator_code: "Rep McDonald",
    });
  });

  it("gives a turn of someone who is not a Legislator its text as logged, no Legislator, and the Agenda item and Measure", async () => {
    const { speakerTurns } = await turnsOf("recording-log-2025r1-288741");

    expect(speakerTurns.turns.find((turn) => turn.timecode === "00:01:47")).toEqual({
      timecode: "00:01:47",
      offset_seconds: 107,
      offset_source: "link",
      speaker: "Anna Glueder, LPRO Analyst",
      legislator_code: null,
      legislator: null,
      agenda_item: "HB 2167 - Public Hearing",
      measure_id: "measure-2025r1-hb2167",
      player_link: playerLink("2025011038", 107),
    });
  });

  it("keeps a turn whose speaker it cannot resolve, with its text: a line in capitals, and a Senator who is not on the committee", async () => {
    // HALNRW 2025-01-27 (289259, event 2025011111): "REP. SCHARF DECLARES POTENTIAL CONFLICT OF INTEREST" at 00:47:33,
    // and "Sen. Todd Nash, Senate District 29" at 00:27:19, a Senator testifying before a House committee.
    const { speakerTurns } = await turnsOf("recording-log-2025r1-289259");
    const at = (timecode: string): Turn | undefined => speakerTurns.turns.find((turn) => turn.timecode === timecode);

    expect(speakerTurns.event_id).toBe("2025011111");
    expect(at("00:47:33")).toMatchObject({
      offset_seconds: 2853,
      speaker: "REP. SCHARF DECLARES POTENTIAL CONFLICT OF INTEREST",
      legislator_code: null,
      legislator: null,
      agenda_item: "HB 2806 - Public Hearing",
      measure_id: "measure-2025r1-hb2806",
      player_link: playerLink("2025011111", 2853),
    });
    expect(at("00:27:19")).toMatchObject({
      offset_seconds: 1639,
      speaker: "Sen. Todd Nash, Senate District 29",
      legislator_code: null,
      legislator: null,
    });
  });

  it("resolves a Senate committee's members by the same rule: SFR 2025-03-17 (295094, event 2025031219)", async () => {
    const { speakerTurns } = await turnsOf("recording-log-2025r1-295094");
    const at = (timecode: string): Turn | undefined => speakerTurns.turns.find((turn) => turn.timecode === timecode);

    expect(speakerTurns.event_id).toBe("2025031219");
    expect(at("00:00:28")).toMatchObject({
      offset_seconds: 28,
      speaker: "Chair Meek",
      legislator_code: "Sen Meek",
      legislator: { name: "Mark Meek" },
      agenda_item: null,
    });
    expect(at("00:13:48")).toMatchObject({
      offset_seconds: 828,
      speaker: "Sen. Starr",
      legislator_code: "Sen Starr",
      legislator: { name: "Bruce Starr" },
      agenda_item: "SB 93 Public Hearing",
      measure_id: "measure-2025r1-sb93",
    });
  });

  it("builds every player link from the log's own address, with the turn's second", async () => {
    const { speakerTurns } = await turnsOf("recording-log-2025r1-288741");

    for (const turn of speakerTurns.turns) {
      expect(turn.player_link).toBe(playerLink("2025011038", turn.offset_seconds));
    }
  });

  it("gives a document that is not a Recording Log no speaker turns", async () => {
    const { speakerTurns } = await turnsOf("version-2025r1-sb69-introduced");

    expect(speakerTurns).toBeUndefined();
  });
});

type Listed = { id: string; speaker_turn_index: { event_id: string; turn_count: number } | null };
type MeetingOutput = { id: string; at: string; has_speaker_turn_index: boolean; recording_logs: Listed[] };

describe.for(eras)("the speaker-turn index in meetings for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  async function allMeetingsOf2025(): Promise<MeetingOutput[]> {
    const meetings: MeetingOutput[] = [];
    let from: string | undefined = "2025-01-01";
    while (from !== undefined) {
      const outcome = await callTool(connected, "meetings", { from, to: "2025-12-31" });
      expect(outcome.isError).toBe(false);
      const page = outcome.structured?.["meetings"] as MeetingOutput[];
      meetings.push(...page);
      const lastDay = Date.parse(`${page.at(-1)?.at.slice(0, 10)}T00:00:00Z`);
      from =
        outcome.structured?.["truncated"] === true
          ? new Date(lastDay + 86_400_000).toISOString().slice(0, 10)
          : undefined;
    }
    return meetings;
  }

  it("says HALNRW 2025-01-22's log has an index: its event ID and 38 turns", async () => {
    const outcome = await callTool(connected, "meetings", { committee: "HALNRW", from: "2025-01-22", to: "2025-01-22" });

    const meetings = outcome.structured?.["meetings"] as MeetingOutput[];
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({
      id: "meeting-2025r1-halnrw-2025-01-22-0800",
      has_speaker_turn_index: true,
      recording_logs: [
        { id: "recording-log-2025r1-288741", speaker_turn_index: { event_id: "2025011038", turn_count: 38 } },
      ],
    });
  });

  it("says that 34 of the 36 meetings have an index, and not HHED 02-13 and SHS 05-22, which have no log", async () => {
    // The two meetings without a Recording Log are the ones meetings-recording-logs.test.ts names, from the feed cache.
    const meetings = await allMeetingsOf2025();

    expect(meetings).toHaveLength(36);
    expect(meetings.filter((meeting) => meeting.has_speaker_turn_index)).toHaveLength(34);
    expect(meetings.filter((meeting) => !meeting.has_speaker_turn_index).map((meeting) => meeting.id)).toEqual([
      "meeting-2025r1-hhed-2025-02-13-0800",
      "meeting-2025r1-shs-2025-05-22-0800",
    ]);
  });
});
