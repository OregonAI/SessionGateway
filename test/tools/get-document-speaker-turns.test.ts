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
// - a Legislator Code is the CommitteeMembers row (feed/CommitteeMembers.json) of the meeting's committee whose Legislators row
//   (feed/Legislators.json) has the name the line gives: "Co-Chair Helm" is "Rep Helm", Ken Helm;
// - the turn count of SLB 2025-01-30 (302332) is its timecoded lines minus the ones that are not speaker lines: 50 lines, of
//   which 16 are the call to order, six Agenda items (SB 69 hearing, SB 69 work session, SB 858, SB 605, SB 651, SB 588),
//   four motions, four votes and the adjournment, so 34 are turns;
// - the player link is the address those logs use, with the log's own clientID (4879615486).
//
// One caution about the fixture: it is a slice, and for a meeting it holds only the CommitteeAgendaItems rows of its chosen
// Measures. The parser reads a log's Agenda items from the feed's, and from its own text only when none of the feed's
// matches a line (owner decision Q5 of ticket #125). So where the slice has some of a meeting's items and not all, the
// other items' lines are read as turns and the turns after them keep the last item the feed matched: that is HALNRW
// 2025-01-22 (288741, the feed has HB 3131 of its five items) and HALNRW 2025-01-27 (289259). The rows below that name an Agenda item are
// the ones of SLB 2025-01-30, whose feed items are all in the slice (SB 69, 858, 605, 651, 588). The rows of the other logs
// assert no Agenda item. The made-up counterpart is in ADR-0052.
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

  it("gives HALNRW 2025-01-22's log (288741) its event ID and its turns, with the envelope's as-of time and notice", async () => {
    const { speakerTurns, structured } = await turnsOf("recording-log-2025r1-288741");

    expect(speakerTurns).toMatchObject({ indexed: true, event_id: "2025011038", gap: null });
    expect(speakerTurns.turn_count).toBe(speakerTurns.turns.length);
    expect(speakerTurns.pages_read_by_timecode).toEqual([]);
    expect(structured["kind"]).toBe("recording_log");
    expect.soft(structured["as_of"]).toBe("2026-08-05T10:00:00-07:00");
    expect.soft(structured["notice"]).toMatch(/not the official record/i);
    expect(String(structured["text"])).toContain("00:00:04 Co-Chair Helm");
  });

  it("returns the turns in media-clock order", async () => {
    for (const id of ["recording-log-2025r1-288741", "recording-log-2025r1-289259", "recording-log-2025r1-302332"]) {
      const { speakerTurns } = await turnsOf(id);
      const seconds = speakerTurns.turns.map((turn) => turn.offset_seconds);

      expect(seconds, id).toEqual(seconds.toSorted((a, b) => a - b));
    }
  });

  it("gives a Legislator turn its Legislator Code and Legislator, and the second and player link of its line", async () => {
    const { speakerTurns } = await turnsOf("recording-log-2025r1-288741");
    const at = (timecode: string): Turn | undefined => speakerTurns.turns.find((turn) => turn.timecode === timecode);

    expect(at("00:00:04")).toMatchObject({
      timecode: "00:00:04",
      offset_seconds: 4,
      offset_source: "link",
      speaker: "Co-Chair Helm",
      legislator_code: "Rep Helm",
      legislator: { id: expect.stringMatching(/^legislator-2025r1-/) as unknown, name: "Ken Helm" },
      agenda_item: null,
      measure_id: null,
      player_link: playerLink("2025011038", 4),
    });
    // 00:11:29 and 00:21:43: a first-name initial, and a compound surname the feed holds as "McDonald".
    expect(at("00:11:29")).toMatchObject({
      offset_seconds: 689,
      speaker: "Rep. B. Levy",
      legislator_code: "Rep Levy B",
      player_link: playerLink("2025011038", 689),
    });
    expect(at("00:21:43")).toMatchObject({
      offset_seconds: 1303,
      speaker: "Vice-Chair Finger McDonald",
      legislator_code: "Rep McDonald",
    });
  });

  it("gives a turn of someone who is not a Legislator its text as logged and no Legislator", async () => {
    const { speakerTurns } = await turnsOf("recording-log-2025r1-288741");

    expect(speakerTurns.turns.find((turn) => turn.timecode === "00:01:47")).toMatchObject({
      timecode: "00:01:47",
      offset_seconds: 107,
      offset_source: "link",
      speaker: "Anna Glueder, LPRO Analyst",
      legislator_code: null,
      legislator: null,
      player_link: playerLink("2025011038", 107),
    });
  });

  it("gives SLB 2025-01-30's log (302332, event 2025011109) its 34 turns, each with the Agenda item and Measure it was spoken under", async () => {
    const { speakerTurns } = await turnsOf("recording-log-2025r1-302332");
    const at = (timecode: string): Turn | undefined => speakerTurns.turns.find((turn) => turn.timecode === timecode);

    expect(speakerTurns).toMatchObject({ indexed: true, event_id: "2025011109", turn_count: 34 });
    expect(speakerTurns.turns).toHaveLength(34);
    // 00:00:07, before the log's first Agenda item (SB 69 at 00:00:59).
    expect(at("00:00:07")).toEqual({
      timecode: "00:00:07",
      offset_seconds: 7,
      offset_source: "link",
      speaker: "Chair Taylor",
      legislator_code: "Sen Taylor",
      legislator: { id: expect.stringMatching(/^legislator-2025r1-/) as unknown, name: "Kathleen Taylor" },
      agenda_item: null,
      measure_id: null,
      player_link: playerLink("2025011109", 7),
    });
    // 00:01:05, staff, under SB 69.
    expect(at("00:01:05")).toEqual({
      timecode: "00:01:05",
      offset_seconds: 65,
      offset_source: "link",
      speaker: "Whitney Perez, LPRO Analyst",
      legislator_code: null,
      legislator: null,
      agenda_item: "SB 69 - Public Hearing",
      measure_id: "measure-2025r1-sb69",
      player_link: playerLink("2025011109", 65),
    });
    // 00:07:03 and 00:16:12, members, under SB 605.
    expect(at("00:07:03")).toMatchObject({
      offset_seconds: 423,
      speaker: "Vice-Chair Bonham",
      legislator_code: "Sen Bonham",
      legislator: { name: "Daniel Bonham" },
      agenda_item: "SB 605 - Public Hearing",
      measure_id: "measure-2025r1-sb605",
    });
    expect(at("00:16:12")).toMatchObject({
      offset_seconds: 972,
      speaker: "Sen. Hayden",
      legislator_code: "Sen Hayden",
      agenda_item: "SB 605 - Public Hearing",
      measure_id: "measure-2025r1-sb605",
    });
  });

  it("keeps a turn whose speaker it cannot resolve, with its text: a Legislator who is not on the committee, a line in capitals", async () => {
    // SLB 2025-01-30 at 00:13:13 (793 s): "Rep. Nathan Sosa, House District 30", a Representative testifying to a Senate
    // committee, and at 01:08:58 (4138 s) "Sen. Mark Meek, Senate District 20", who is not on SLB.
    const slb = (await turnsOf("recording-log-2025r1-302332")).speakerTurns;
    expect(slb.turns.find((turn) => turn.timecode === "00:13:13")).toMatchObject({
      offset_seconds: 793,
      speaker: "Rep. Nathan Sosa, House District 30",
      legislator_code: null,
      legislator: null,
      agenda_item: "SB 605 - Public Hearing",
    });
    expect(slb.turns.find((turn) => turn.timecode === "01:08:58")).toMatchObject({
      offset_seconds: 4138,
      speaker: "Sen. Mark Meek, Senate District 20",
      legislator_code: null,
      legislator: null,
      agenda_item: "SB 588 - Public Hearing",
    });
    // HALNRW 2025-01-27 (289259, event 2025011111): at 00:47:33 (2853 s) the line "REP. SCHARF DECLARES POTENTIAL CONFLICT
    // OF INTEREST" is a turn like any other, and "Sen. Todd Nash, Senate District 29" at 00:27:19 (1639 s) is not a member.
    const halnrw = (await turnsOf("recording-log-2025r1-289259")).speakerTurns;
    expect(halnrw.event_id).toBe("2025011111");
    expect(halnrw.turns.find((turn) => turn.timecode === "00:47:33")).toMatchObject({
      offset_seconds: 2853,
      speaker: "REP. SCHARF DECLARES POTENTIAL CONFLICT OF INTEREST",
      legislator_code: null,
      legislator: null,
      player_link: playerLink("2025011111", 2853),
    });
    expect(halnrw.turns.find((turn) => turn.timecode === "00:27:19")).toMatchObject({
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
    });
    expect(at("00:13:48")).toMatchObject({
      offset_seconds: 828,
      speaker: "Sen. Starr",
      legislator_code: "Sen Starr",
      legislator: { name: "Bruce Starr" },
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

  it("says SLB 2025-01-30's log has an index: its event ID and 34 turns; and HALNRW 2025-01-22's, its event ID", async () => {
    const slb = await callTool(connected, "meetings", { committee: "SLB", from: "2025-01-30", to: "2025-01-30" });
    const halnrw = await callTool(connected, "meetings", { committee: "HALNRW", from: "2025-01-22", to: "2025-01-22" });

    expect((slb.structured?.["meetings"] as MeetingOutput[])[0]).toMatchObject({
      id: "meeting-2025r1-slb-2025-01-30-0800",
      has_speaker_turn_index: true,
      recording_logs: [
        { id: "recording-log-2025r1-302332", speaker_turn_index: { event_id: "2025011109", turn_count: 34 } },
      ],
    });
    expect((halnrw.structured?.["meetings"] as MeetingOutput[])[0]).toMatchObject({
      id: "meeting-2025r1-halnrw-2025-01-22-0800",
      has_speaker_turn_index: true,
      recording_logs: [
        {
          id: "recording-log-2025r1-288741",
          speaker_turn_index: { event_id: "2025011038", turn_count: expect.any(Number) as unknown },
        },
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
