// Seam 1 (test/CLAUDE.md): machine transcripts in the tools with the publication gate ON (ticket #134, ADR-0055). A fake OLIS
// serves the committed fixture and its documents (the 34 real Recording Logs among them), the worker reads each log and
// then the transcript file in its folder, and an MCP client calls the tools in-process with TRANSCRIPTS_PUBLISHED=true.
// The same files with the gate off are transcripts-unpublished.test.ts.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md, Database,
// Templates): the fake embedder (a transcript passage is embedded like Testimony, and the claims are about words), the
// fixture's clock (2026-08-05 10:00 in Oregon), and one transcript file. The gate is the server's setting and is not part of
// the template's key, so this file and the gate-off one share the one built database. The cases that change the files or
// the database are in transcripts-pull.test.ts.
//
// THE TRANSCRIPT IS MADE UP (test/support/made-up-transcript.ts, halnrwSegments): its words were never said, and they are
// timed to the real lines of HALNRW 2025-01-22's Recording Log, 288741 (Invintus event 2025011038, meeting
// meeting-2025r1-halnrw-2025-01-22-0800). Expected values are worked from those lines and those made-up words, never from
// a tool's output:
// - the log's real turns (documents/committee-meeting-documents/288741.pdf, as the pdf-text package extracts it; the
//   second of a turn is the line's timecode, which equals the `startStreamAt` of its link, see
//   get-document-speaker-turns.test.ts): Co-Chair Helm 00:00:04 (4 s), Anna Glueder 00:01:47 (107 s), Kurt Williams
//   00:02:49 (169 s), Melissa Rice 00:06:15 (375 s), Vice-Chair Finger McDonald 00:21:43 (1303 s, Rep McDonald, Sarah McDonald,
//   under "HB 2167 - Public Hearing", which the index does not hold), Co-Chair Helm 01:15:49 (4549 s, under
//   "HB 3131 - Public Hearing" at 01:15:48, which the index holds: measure-2025r1-hb3131);
// - the log's other lines: MOTION at 00:00:52 (52 s), VOTE 7-0-2 at 00:01:09 (69 s), "Meeting Adjourned" at 01:29:10 (5350 s);
// - the made-up segments (halnrwSegments): "Okay then" at 0.5 s and 1.5 s, "welcome everyone" at 4.2 s and 5.2 s in the
//   first; "I move the marmalade amendment as printed" from 53 s; "that concludes the staff summary" from 164.5 s and "Good
//   morning members the quokka laboratory tests samples" from 169.5 s in one segment; "The platypus bill needs a hearing"
//   from 1310 s; "The petunia bill is open" from 4560 s; "Thanks everyone gooseberry adjourned" from 5352 s. A word falls
//   in the last turn or entry that began at or before it, so each of those is whose it is below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { halnrwEventId, halnrwSegments, madeUpTranscript } from "../support/made-up-transcript.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({
    clockAt: "2026-08-05T17:00:00Z",
    documents: true,
    transcripts: {
      [`${halnrwEventId}.transcript.json`]: madeUpTranscript({ eventId: halnrwEventId, segments: halnrwSegments }),
    },
    serverEnv: { TRANSCRIPTS_PUBLISHED: "true" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

const PLAYER = "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486";
const player = (seconds: number): string => `${PLAYER}&eventID=${halnrwEventId}&startStreamAt=${seconds}`;
const MEETING = "meeting-2025r1-halnrw-2025-01-22-0800";
const LOG = "recording-log-2025r1-288741";
const MACHINE_NOTICE = "machine transcript of the official recording, not an official record";

type Transcript = {
  speaker: string;
  speaker_kind: string;
  procedural: string | null;
  turn: {
    timecode: string;
    speaker: string;
    legislator_code: string | null;
    legislator: { name: string } | null;
  } | null;
  meeting: string;
  agenda_item: string | null;
  measure_id: string | null;
  start_seconds: number;
  end_seconds: number;
  timecode: string;
  player_link: string;
};
type Hit = {
  id: string;
  kind: string;
  snippet: string;
  source_url: string;
  turn: unknown;
  transcript: Transcript | null;
};

describe.for(eras)("transcripts with the gate on, for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  async function search(args: Record<string, unknown>): Promise<{ hits: Hit[]; structured: Record<string, unknown> }> {
    const outcome = await callTool(connected, "search", args);
    expect(outcome.isError).toBe(false);
    const structured = outcome.structured ?? {};
    return { hits: structured["results"] as Hit[], structured };
  }

  it("finds a phrase of the transcript and answers with the speaker, Meeting, timecode, player link and the machine-transcript notice", async () => {
    const { hits, structured } = await search({ query: "quokka laboratory" });

    // The meaning side may offer other passages of the transcript after it: the one that holds the words is first.
    const found = hits.filter((hit) => hit.transcript !== null);
    expect(found[0]).toMatchObject({
      id: LOG,
      kind: "recording_log",
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/288741",
      turn: null,
      transcript: {
        speaker: "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
        speaker_kind: "turn",
        procedural: null,
        turn: { timecode: "00:02:49", legislator_code: null, legislator: null },
        meeting: MEETING,
        agenda_item: "HB 2167 - Public Hearing",
        measure_id: null,
        start_seconds: 169.5,
        end_seconds: 177,
        timecode: "00:02:49",
        player_link: player(169),
      },
    });
    expect(found[0]?.snippet).toContain("quokka laboratory tests samples");
    expect(String(structured["notice"]).toLowerCase()).toContain(MACHINE_NOTICE);
    // It sits beside the non-official notice, which keeps its source_url clause: the result holds a source_url.
    expect(structured["notice"]).toMatch(/not the official record.*use source_url/i);
    expect(structured["as_of"]).toBe("2026-08-05T10:00:00-07:00");
  });

  it("names a Legislator's Legislator Code when the words are a Legislator's turn", async () => {
    const { hits } = await search({ query: "platypus bill" });

    const found = hits.find((hit) => hit.transcript !== null);
    expect(found?.transcript).toMatchObject({
      speaker: "Vice-Chair Finger McDonald",
      speaker_kind: "turn",
      turn: { timecode: "00:21:43", legislator_code: "Rep McDonald", legislator: { name: "Sarah McDonald" } },
      start_seconds: 1310,
      timecode: "00:21:50",
      player_link: player(1310),
    });
  });

  it("gives the words of a segment that spans a turn change to each speaker: the staff summary to Anna Glueder, the rest to Kurt Williams", async () => {
    const staff = await search({ query: "concludes the staff summary" });
    const kurt = await search({ query: "quokka" });

    expect(staff.hits.find((hit) => hit.transcript !== null)?.transcript).toMatchObject({
      speaker: "Anna Glueder, LPRO Analyst",
      turn: { timecode: "00:01:47" },
      start_seconds: 164.5,
    });
    expect(kurt.hits.find((hit) => hit.transcript !== null)?.transcript).toMatchObject({
      speaker: "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
    });
    // The two are different passages: the staff words are not in Kurt's.
    expect(kurt.hits.find((hit) => hit.transcript !== null)?.snippet).not.toContain("staff summary");
  });

  it("gives the words said during the motion to the motion line, with no speaker", async () => {
    const { hits } = await search({ query: "marmalade amendment" });

    expect(hits.find((hit) => hit.transcript !== null)?.transcript).toMatchObject({
      speaker: "speaker not given",
      speaker_kind: "procedural",
      procedural: "motion",
      turn: null,
      start_seconds: 53,
      timecode: "00:00:53",
      player_link: player(53),
    });
  });

  it("says 'speaker not given' for words before the first turn and after the meeting adjourned, and says why for the second", async () => {
    const before = await search({ query: "Okay then" });
    const after = await search({ query: "gooseberry" });

    expect(before.hits.find((hit) => hit.transcript !== null)?.transcript).toMatchObject({
      speaker: "speaker not given",
      speaker_kind: "not_given",
      procedural: null,
      turn: null,
      start_seconds: 0.5,
    });
    expect(after.hits.find((hit) => hit.transcript !== null)?.transcript).toMatchObject({
      speaker: "speaker not given",
      speaker_kind: "not_given",
      procedural: "after_adjournment",
      start_seconds: 5352,
      timecode: "01:29:12",
    });
  });

  it("carries the Agenda item and the Measure of the words, and a search of that Measure finds them", async () => {
    const unfiltered = await search({ query: "petunia bill" });
    const filtered = await search({ query: "petunia bill", measure: "HB 3131" });
    const elsewhere = await search({ query: "petunia bill", measure: "HB 3124" });

    expect(unfiltered.hits.find((hit) => hit.transcript !== null)?.transcript).toMatchObject({
      speaker: "Co-Chair Helm",
      agenda_item: "HB 3131 - Public Hearing",
      measure_id: "measure-2025r1-hb3131",
      start_seconds: 4560,
    });
    expect(filtered.hits.some((hit) => hit.transcript !== null)).toBe(true);
    expect(elsewhere.hits.some((hit) => hit.transcript !== null)).toBe(false);
  });

  it("puts the machine-transcript notice on no result that carries no transcript passage", async () => {
    // A Version of HB 3131: no Recording Log, so no transcript passage, and a source_url.
    const withoutTranscript = await search({ query: "Kurt Williams", kind: "version", measure: "HB 3131" });
    const measure = await callTool(connected, "get_measure", { measure: "HB 3131" });

    expect(withoutTranscript.hits.length).toBeGreaterThan(0);
    expect(withoutTranscript.hits.some((hit) => hit.transcript !== null)).toBe(false);
    expect(String(withoutTranscript.structured["notice"]).toLowerCase()).not.toContain("machine transcript");
    expect(String(measure.structured?.["notice"]).toLowerCase()).not.toContain("machine transcript");
  });

  it("shows each turn's transcript text on the Recording Log, in get_document, with the machine-transcript notice", async () => {
    const outcome = await callTool(connected, "get_document", { id: LOG });

    expect(outcome.isError).toBe(false);
    const turns = outcome.structured?.["speaker_turns"] as {
      turns: { timecode: string; transcript?: { text: string; start_seconds: number; player_link: string }[] }[];
      transcript?: { other_passages: { text: string; speaker: string; procedural: string | null }[] };
    };
    const at = (timecode: string) => turns.turns.find((turn) => turn.timecode === timecode);
    expect(at("00:02:49")?.transcript).toEqual([
      {
        text: "Good morning members the quokka laboratory tests samples",
        start_seconds: 169.5,
        end_seconds: 177,
        timecode: "00:02:49",
        player_link: player(169),
      },
    ]);
    expect(at("00:01:47")?.transcript?.map((passage) => passage.text)).toEqual(["that concludes the staff summary"]);
    expect(at("00:00:04")?.transcript?.map((passage) => passage.text)).toEqual(["welcome everyone"]);
    // A turn no words fall in has an empty list: the log has a transcript, and nothing was said in it.
    expect(at("00:06:15")?.transcript).toEqual([]);
    // The words that are no turn's are listed apart, each saying why no speaker is given.
    expect(
      turns.transcript?.other_passages.map((passage) => [passage.text, passage.speaker, passage.procedural]),
    ).toEqual([
      ["Okay then", "speaker not given", null],
      ["I move the marmalade amendment as printed", "speaker not given", "motion"],
      ["Thanks everyone gooseberry adjourned", "speaker not given", "after_adjournment"],
    ]);
    expect(String(outcome.structured?.["notice"]).toLowerCase()).toContain(MACHINE_NOTICE);
    // The log's own text is still as published.
    expect(String(outcome.structured?.["text"])).toContain("00:02:49 Kurt Williams, Director");
  });

  it("gives a log with no transcript no transcript field, though the gate is on", async () => {
    const outcome = await callTool(connected, "get_document", { id: "recording-log-2025r1-289259" });

    const turns = outcome.structured?.["speaker_turns"] as { turns: Record<string, unknown>[]; transcript?: unknown };
    expect(turns.transcript).toBeUndefined();
    expect(turns.turns.every((turn) => !("transcript" in turn))).toBe(true);
    expect(String(outcome.structured?.["notice"]).toLowerCase()).not.toContain("machine transcript");
  });

  it("says in meetings which Meeting has a transcript", async () => {
    const outcome = await callTool(connected, "meetings", {
      committee: "HALNRW",
      from: "2025-01-22",
      to: "2025-01-27",
    });

    const meetings = outcome.structured?.["meetings"] as { id: string; has_transcript?: boolean }[];
    expect(meetings.map((meeting) => [meeting.id, meeting.has_transcript])).toEqual([
      [MEETING, true],
      ["meeting-2025r1-halnrw-2025-01-27-0800", false],
    ]);
  });
});
