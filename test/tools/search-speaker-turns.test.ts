// Seam 1 (test/CLAUDE.md): speaker turns in `search` and in `get_measure`, as an agent sees them (ticket #127, ADR-0052's
// "Turns and Passages"). A fake OLIS serves the committed fixture and its documents (the 34 real Recording Logs among
// them), the worker reads each log, and an MCP client calls the tools in-process. Nothing here is made up.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md, Database,
// Templates): the fake embedder, because a Recording Log is Keyword-only and the claim is about words. The clock is the
// fixture's, 2026-08-05 10:00 in Oregon (every Recording Log exists by then). The cases that move a stored database
// are in search-speaker-turns-pull.test.ts.
//
// Expected values are literals from the fixture, never from a tool's output:
// - the lines of the logs are the lines of their pdf-text extraction (documents/committee-meeting-documents/<id>.pdf). The
//   second of a turn is the `startStreamAt` of the player link on its line, which equals the timecode in hours, minutes and
//   seconds in every row below (00:02:49 = 169; see get-document-speaker-turns.test.ts for how the links were read from the
//   raw PDF); the clientID (4879615486) and the event IDs (2025011038 for 288741, 2025011111 for 289259) are the logs' own;
// - 288741 is HALNRW 2025-01-22 and 289259 is HALNRW 2025-01-27 (feed/CommitteeMeetings.json, 08:00 Pacific, in winter time
//   -08:00). Kurt Williams, "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
//   speaks once in the 34 logs, at 00:02:49 of 288741, under "HB 2167 - Public Hearing" (00:01:37), which the index does not
//   hold (feed/Measures.json), so his turn has no Measure. He is not a Legislator;
// - "Vice-Chair Finger McDonald" speaks twice in 288741, at 00:21:43 (1303 s) and 00:53:00 (3180 s), and is Rep. Sarah
//   McDonald, the feed's "Rep McDonald" (feed/CommitteeMembers.json and feed/Legislators.json, which hold "Finger McDonald"
//   as "McDonald"). The log's motion line
//   "MOTION: VICE-CHAIR FINGER MCDONALD MOVES ADOPTION OF COMMITTEE RULES" (00:00:52) is not a turn: its words are in the log's
//   other text;
// - HB 3131 is taken up at three HALNRW meetings, the two hearings and a work session (feed/CommitteeMeetings.json lists the
//   committee's three: 2025-01-22, 2025-01-27 and 2025-02-12, and the third's log, 292588, has "00:08:43 HB 3131 - Work
//   Session" and "00:08:44 Co-Chair Helm", 524 s, event 2025021177 from the raw PDF's /URI: `startStreamAt=524` with
//   `/Rect[ 69.75 637.21 122.29 651.01]`; no other log of the 34 names HB 3131 on an Agenda item line). In 288741 its Agenda item is "01:15:48 HB 3131 - Public Hearing" and the first turn
//   after it is "01:15:49 Co-Chair Helm" (4549 s, Rep. Ken Helm, "Rep Helm"). In 289259 the item is "00:00:27 HB 3131 - Public
//   Hearing" and the first turn is "00:00:28 Co-Chair Owens" (28 s, Rep. Mark Owens, "Rep Owens");
// - HB 3124 and HB 3723 are in the index (feed/Measures.json) and no log of the fixture names either.
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

const PLAYER = "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486";
const player = (eventId: string, seconds: number): string => `${PLAYER}&eventID=${eventId}&startStreamAt=${seconds}`;

type Turn = {
  speaker: string;
  legislator_code: string | null;
  legislator: { id: string; name: string } | null;
  meeting: string | null;
  agenda_item: string | null;
  measure_id: string | null;
  timecode: string;
  offset_seconds: number;
  player_link: string;
};
type Hit = { id: string; document_id: string; kind: string; snippet: string; turn: Turn | null };

describe.for(eras)("speaker turns in search and get_measure for a %s client", (era) => {
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

  it("finds a witness's turn by their name, with the speaker, Meeting, Agenda item, timecode and player link, the as-of time and the notice", async () => {
    const { hits, structured } = await search({ query: "Kurt Williams" });

    const turns = hits.filter((hit) => hit.turn !== null);
    expect(turns[0]).toMatchObject({
      id: "recording-log-2025r1-288741",
      document_id: "recording-log-2025r1-288741",
      kind: "recording_log",
      turn: {
        speaker: "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
        legislator_code: null,
        legislator: null,
        meeting: "meeting-2025r1-halnrw-2025-01-22-0800",
        agenda_item: "HB 2167 - Public Hearing",
        measure_id: null,
        timecode: "00:02:49",
        offset_seconds: 169,
        player_link: player("2025011038", 169),
      },
    });
    expect(turns[0]?.snippet).toContain("Kurt Williams");
    expect.soft(structured["as_of"]).toBe("2026-08-05T10:00:00-07:00");
    expect.soft(structured["notice"]).toMatch(/not the official record/i);
  });

  it("returns a turn Hit once: no second Hit for the same words of the same log", async () => {
    const { hits } = await search({ query: "Kurt Williams" });

    const ofTheLog = hits.filter(
      (hit) => hit.id === "recording-log-2025r1-288741" && hit.snippet.includes("Kurt Williams"),
    );
    expect(ofTheLog).toHaveLength(1);
    expect(ofTheLog[0]?.turn).toBeTruthy();
  });

  it("gives a Legislator's turns their Legislator Code, and still finds the log's other lines that hold the same words", async () => {
    const { hits } = await search({
      query: "Finger McDonald",
      kind: "recording_log",
      from: "2025-01-22",
      to: "2025-01-22",
    });

    const turns = hits
      .flatMap((hit) => (hit.turn === null ? [] : [hit.turn]))
      .toSorted((a, b) => a.offset_seconds - b.offset_seconds);
    expect(turns.map((turn) => [turn.timecode, turn.offset_seconds, turn.speaker, turn.legislator_code])).toEqual([
      ["00:21:43", 1303, "Vice-Chair Finger McDonald", "Rep McDonald"],
      ["00:53:00", 3180, "Vice-Chair Finger McDonald", "Rep McDonald"],
    ]);
    expect(turns[0]?.legislator?.name).toBe("Sarah McDonald");
    // The motion line is not a turn: it is found as the log's own text, a Hit with no turn.
    expect(hits.some((hit) => hit.turn === null && hit.snippet.includes("MOVES ADOPTION OF"))).toBe(true);
  });

  it("serves the log's text as published, whole, whatever the index holds of its turns", async () => {
    const outcome = await callTool(connected, "get_document", { id: "recording-log-2025r1-288741" });

    const text = String(outcome.structured?.["text"]);
    expect(text).toContain(
      "00:02:49 Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State\nUniversity (OSU)\n",
    );
    expect(text).toContain("00:00:52 MOTION: VICE-CHAIR FINGER MCDONALD MOVES ADOPTION OF\nCOMMITTEE RULES\n");
    expect(text).toContain("STAFF PRESENT: Anna Glueder, LPRO Analyst");
  });

  type Hearing = {
    meeting_id: string;
    committee_code: string;
    meeting_date: string;
    recording_log_id: string;
    event_id: string;
    agenda_item: string;
    first_turn: Omit<Turn, "meeting" | "agenda_item" | "measure_id">;
  };

  it("lists the hearings at which HB 3131 was taken up, each with its first turn on the Agenda item and that turn's player link", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

    expect(outcome.isError).toBe(false);
    const hearings = outcome.structured?.["hearings"] as Hearing[];
    expect(hearings).toEqual([
      {
        meeting_id: "meeting-2025r1-halnrw-2025-01-22-0800",
        committee_code: "HALNRW",
        meeting_date: "2025-01-22T08:00:00-08:00",
        recording_log_id: "recording-log-2025r1-288741",
        event_id: "2025011038",
        agenda_item: "HB 3131 - Public Hearing",
        first_turn: {
          timecode: "01:15:49",
          offset_seconds: 4549,
          speaker: "Co-Chair Helm",
          legislator_code: "Rep Helm",
          legislator: { id: expect.stringMatching(/^legislator-2025r1-/) as unknown, name: "Ken Helm" },
          player_link: player("2025011038", 4549),
        },
      },
      {
        meeting_id: "meeting-2025r1-halnrw-2025-01-27-0800",
        committee_code: "HALNRW",
        meeting_date: "2025-01-27T08:00:00-08:00",
        recording_log_id: "recording-log-2025r1-289259",
        event_id: "2025011111",
        agenda_item: "HB 3131 - Public Hearing",
        first_turn: {
          timecode: "00:00:28",
          offset_seconds: 28,
          speaker: "Co-Chair Owens",
          legislator_code: "Rep Owens",
          legislator: { id: expect.stringMatching(/^legislator-2025r1-/) as unknown, name: "Mark Owens" },
          player_link: player("2025011111", 28),
        },
      },
      {
        meeting_id: "meeting-2025r1-halnrw-2025-02-12-0800",
        committee_code: "HALNRW",
        meeting_date: "2025-02-12T08:00:00-08:00",
        recording_log_id: "recording-log-2025r1-292588",
        event_id: "2025021177",
        agenda_item: "HB 3131 - Work Session",
        first_turn: {
          timecode: "00:08:44",
          offset_seconds: 524,
          speaker: "Co-Chair Helm",
          legislator_code: "Rep Helm",
          legislator: { id: expect.stringMatching(/^legislator-2025r1-/) as unknown, name: "Ken Helm" },
          player_link: player("2025021177", 524),
        },
      },
    ]);
    expect.soft(outcome.structured?.["as_of"]).toBe("2026-08-05T10:00:00-07:00");
  });

  it.for(["HB 3124", "HB 3723"])(
    "lists no hearing for %s, which the index holds and no Recording Log names",
    async (measure) => {
      const outcome = await callTool(connected, "get_measure", { measure });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured?.["hearings"]).toEqual([]);
    },
  );
});
