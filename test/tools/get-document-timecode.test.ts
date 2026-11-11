// Seam 1 (test/CLAUDE.md): `get_document`'s `timecode` (ticket #174, ADR-0061, amending ADR-0055). An agent that knows a
// turn's timecode asks a Recording Log for it and is given the part that holds the turn's line and the start of its transcript,
// instead of paging blindly: a long log's transcript pages with the log (ADR-0055), and a turn's words can be in a later part.
//
// Its database is shared by every case and is a copy of the run's template for its options: the fake embedder, the fixture's
// clock, documents served, and one transcript file, the options of transcripts-paged.test.ts (so the two share one build). One
// system has the gate on; a second with the gate unset shares the same built database and answers as a server with it off.
//
// THE TRANSCRIPT IS MADE UP (test/support/made-up-transcript.ts, `longHalnrwSegments`): invented words, labelled as such, timed to
// the real turns of HALNRW 2025-01-22's Recording Log 288741 (Invintus event 2025011038), whose text is one part (3,620
// characters) and which has 38 turns, from 00:00:04 to 01:21:19 (`halnrwTurnTimecodes`, read from the log itself). Turn n's
// first passage is `fillerSentence(n, 0)` (none for the second turn), and the last turn has 150 passages, more than a part holds.
// The expected values are the log's own lines (a turn's line begins with its timecode) and those made-up words, never a tool's
// output.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fillerSentence,
  halnrwEventId,
  halnrwTurnTimecodes,
  longHalnrwSegments,
  longTurn,
  madeUpTranscript,
} from "../support/made-up-transcript.ts";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const LOG = "recording-log-2025r1-288741";
const options = {
  clockAt: "2026-08-05T17:00:00Z",
  documents: true,
  transcripts: {
    [`${halnrwEventId}.transcript.json`]: madeUpTranscript({ eventId: halnrwEventId, segments: longHalnrwSegments() }),
  },
};

type Part = {
  part: number;
  part_count: number;
  text: string;
  speaker_turns: { turns: { timecode: string; transcript?: { text: string }[] }[] };
};

let published: System;
let unpublished: System;
let on: ConnectedClient;
let off: ConnectedClient;

beforeAll(async () => {
  published = await startCopiedSystem({ ...options, serverEnv: { TRANSCRIPTS_PUBLISHED: "true" } });
  unpublished = await startCopiedSystem(options);
  on = await connectClient("2026-07-28", published.handler);
  off = await connectClient("2026-07-28", unpublished.handler);
}, 120_000);

afterAll(async () => {
  await on.close();
  await off.close();
  await published.stop();
  await unpublished.stop();
});

async function atTimecode(connected: ConnectedClient, timecode: string): Promise<Part> {
  const outcome = await callTool(connected, "get_document", { id: LOG, timecode });
  expect(outcome.isError, `the turn at ${timecode}: ${outcome.text}`).toBe(false);
  return outcome.structured as unknown as Part;
}

const turnAt = (part: Part, timecode: string) => part.speaker_turns.turns.find((turn) => turn.timecode === timecode);

describe("get_document with a timecode, the gate on", () => {
  it("gives the part that holds a later turn's line and the start of its words, which is not the first part", async () => {
    const timecode = halnrwTurnTimecodes[longTurn] ?? "";

    const found = await atTimecode(on, timecode);

    expect(timecode).toBe("01:21:19");
    expect(found.part).toBeGreaterThan(1);
    expect(`\n${found.text}`).toContain(`\n${timecode} `);
    expect(turnAt(found, timecode)?.transcript?.[0]?.text).toBe(fillerSentence(longTurn, 0));
  });

  it("gives, for every turn of the log, the part its line is in, with its first words", async () => {
    for (const [turn, timecode] of halnrwTurnTimecodes.entries()) {
      const found = await atTimecode(on, timecode);

      expect(`\n${found.text}`, `the turn at ${timecode}`).toContain(`\n${timecode} `);
      // The second turn has no words (its range holds the motion and the vote): it is listed with an empty list.
      expect(turnAt(found, timecode)?.transcript?.[0]?.text, `the turn at ${timecode}`).toBe(
        turn === 1 ? undefined : fillerSentence(turn, 0),
      );
    }
  });
});

describe("get_document with a timecode it cannot answer", () => {
  it("refuses a timecode on a document that is not a Recording Log, and says what the document is", async () => {
    const outcome = await callTool(on, "get_document", { id: "version-2025r1-sb69-introduced", timecode: "00:02:49" });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("version-2025r1-sb69-introduced");
    expect(outcome.text).toContain("is a Version, not a Recording Log");
  });

  it("refuses a timecode no turn of the log has, and names the turns either side of it", async () => {
    // The log's lines "00:20:14 Robert Greenway, resident, Dallas" and "00:21:43 Vice-Chair Finger McDonald": no line between.
    const between = await callTool(on, "get_document", { id: LOG, timecode: "00:20:41" });
    // The first turn is "00:00:04 Co-Chair Helm", and the last "01:21:19", before "Meeting Adjourned" at 01:29:10.
    const before = await callTool(off, "get_document", { id: LOG, timecode: "00:00:01" });
    const after = await callTool(on, "get_document", { id: LOG, timecode: "01:29:10" });

    expect(between.isError).toBe(true);
    expect(between.text).toContain("No speaker turn of");
    expect(between.text).toContain("00:20:41");
    expect(between.text).toContain("00:20:14 (Robert Greenway, resident, Dallas)");
    expect(between.text).toContain("00:21:43 (Vice-Chair Finger McDonald)");
    expect(before.isError).toBe(true);
    expect(before.text).toContain("before the first turn, 00:00:04 (Co-Chair Helm)");
    expect(after.isError).toBe(true);
    expect(after.text).toContain("after the last turn, 01:21:19");
  });
});
