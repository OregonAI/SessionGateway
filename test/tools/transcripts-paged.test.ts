// Seam 1 (test/CLAUDE.md): a Recording Log's machine transcript pages with the log (ticket #134, ADR-0055, owner decision 1 of
// 2026-11-05). With the gate on, `get_document` on a Recording Log gives each part the transcript of the turns in that part,
// not the whole transcript in every part, and no part is over the part size (20,000 characters, parts.ts) because of
// transcript text: a part's own text and the transcript passages it carries together stay within it.
//
// Its database is shared by every case and is a copy of the run's template for its options: the fake embedder, the fixture's
// clock, documents served, and one transcript file. A second system with the same options and the gate unset shares the
// same built database; it gives the log's text as published and the answer of a server with the gate off.
//
// THE TRANSCRIPT IS MADE UP (test/support/made-up-transcript.ts, `longHalnrwSegments`): invented words, labelled as such, timed to
// the real turns of HALNRW 2025-01-22's Recording Log 288741 (Invintus event 2025011038), whose text is one part (3,620
// characters) and which has 38 turns. The expected values are worked from how the filler is made: turn n has
// `fillerSentenceCount(n)` sentences, `fillerSentence(n, k)` its k-th, each one segment and so one passage; the second turn has
// none (its range holds the motion and the vote); the last turn has 150, about 36,000 characters, more than a whole part.
// The three passages that are no turn's are the made-up words before the first turn, during the motion and after the
// adjournment. Nothing here is read from a tool's answer except what the case is about.
//
// How the passages are placed (ADR-0055): a turn's passages go in the part its lines are in, and a turn whose passages do not
// fit in what is left of the part carries on in the parts after it, split between passages and never inside one; words that
// are no turn's go after the passages of the turn they follow in time (the first turn's part before any turn).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fillerSentence,
  fillerSentenceCount,
  halnrwEventId,
  halnrwTurnTimecodes,
  longHalnrwOtherPassages,
  longHalnrwSegments,
  longTurn,
  madeUpTranscript,
} from "../support/made-up-transcript.ts";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const LOG = "recording-log-2025r1-288741";
const MACHINE_NOTICE = "machine transcript of the official recording, not an official record";
/** The most characters of a part: PART_SIZE_CHARACTERS in mcp-server/lib/parts.ts. */
const PART_SIZE = 20_000;
const options = {
  clockAt: "2026-08-05T17:00:00Z",
  documents: true,
  transcripts: {
    [`${halnrwEventId}.transcript.json`]: madeUpTranscript({ eventId: halnrwEventId, segments: longHalnrwSegments() }),
  },
};

type Passage = { text: string; start_seconds: number };
type Part = {
  part: number;
  part_count: number;
  text: string;
  notice: string;
  speaker_turns: {
    turn_count: number;
    turns: { timecode: string; transcript?: Passage[] }[];
    transcript?: {
      passage_count: number;
      other_passages: (Passage & { speaker: string; procedural: string | null })[];
    };
  };
};

let published: System;
let unpublished: System;
let on: ConnectedClient;
let off: ConnectedClient;
let parts: Part[];
let referenceText: string;

async function part(connected: ConnectedClient, number: number): Promise<Part> {
  const outcome = await callTool(connected, "get_document", { id: LOG, part: number });
  expect(outcome.isError, `part ${String(number)}`).toBe(false);
  return outcome.structured as unknown as Part;
}

beforeAll(async () => {
  published = await startCopiedSystem({ ...options, serverEnv: { TRANSCRIPTS_PUBLISHED: "true" } });
  unpublished = await startCopiedSystem(options);
  on = await connectClient("2026-07-28", published.handler);
  off = await connectClient("2026-07-28", unpublished.handler);
  const first = await part(on, 1);
  parts = [first];
  for (let number = 2; number <= first.part_count; number += 1) parts.push(await part(on, number));
  referenceText = (await part(off, 1)).text;
}, 120_000);

afterAll(async () => {
  await on.close();
  await off.close();
  await published.stop();
  await unpublished.stop();
});

const transcriptCharacters = (of: Part): number =>
  of.speaker_turns.turns.reduce((n, turn) => n + (turn.transcript ?? []).reduce((m, p) => m + p.text.length, 0), 0) +
  (of.speaker_turns.transcript?.other_passages ?? []).reduce((n, p) => n + p.text.length, 0);

/** The made-up sentences of turn `turn`, in order. */
const sentencesOf = (turn: number): string[] =>
  Array.from({ length: fillerSentenceCount(turn) }, (_, k) => fillerSentence(turn, k));

describe("a long transcript pages with the log", () => {
  it("is cut into several parts: more than the log's own text needs, which is one", async () => {
    const filler = halnrwTurnTimecodes.reduce((n, _, turn) => n + sentencesOf(turn).join("").length, 0);

    expect(referenceText.length).toBe(3620);
    expect(filler).toBeGreaterThan(3 * PART_SIZE);
    expect(parts.length).toBeGreaterThanOrEqual(Math.ceil((filler + referenceText.length) / PART_SIZE));
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts.every((each) => each.part_count === parts.length)).toBe(true);
    // With the gate off the same log is one part, as before.
    expect((await part(off, 1)).part_count).toBe(1);
  });

  it("leaves no part over the part size because of transcript text: a part's text and the passages it carries are within it", () => {
    for (const each of parts) {
      expect(each.text.length + transcriptCharacters(each), `part ${String(each.part)}`).toBeLessThanOrEqual(PART_SIZE);
    }
  });

  it("leaves the log's text exactly as published: the parts' texts joined are the text of the log", () => {
    expect(parts.map((each) => each.text).join("")).toBe(referenceText);
  });

  it("gives each turn the words of its own turn, in order, each passage once, whichever parts it is in", () => {
    halnrwTurnTimecodes.forEach((timecode, turn) => {
      const said = parts.flatMap((each) =>
        (each.speaker_turns.turns.find((entry) => entry.timecode === timecode)?.transcript ?? []).map((p) => p.text),
      );
      expect(said, `the turn at ${timecode}`).toEqual(sentencesOf(turn));
    });
  });

  it("lists a turn's passages in the part its lines are in, and in the parts straight after it when they do not fit", () => {
    for (const [turn, timecode] of halnrwTurnTimecodes.entries()) {
      const where = parts.flatMap((each, index) =>
        each.speaker_turns.turns.find((entry) => entry.timecode === timecode)?.transcript === undefined ? [] : [index],
      );
      // Every turn is listed in some part, including one with no words: the log has a transcript and nothing was said.
      expect(where.length, `the turn at ${timecode}`).toBeGreaterThan(0);
      // The first part it is listed in holds its lines; the others follow it one after another.
      const first = where[0] ?? 0;
      expect(`\n${parts[first]?.text ?? ""}`, `the turn at ${timecode}`).toContain(`\n${timecode} `);
      expect(where, `the turn at ${timecode}`).toEqual(Array.from({ length: where.length }, (_, n) => first + n));
      if (turn !== longTurn) continue;
      // The last turn has more words than a part holds: it is split between passages over several parts.
      expect(where.length).toBeGreaterThanOrEqual(2);
      for (const index of where) {
        expect(
          parts[index]?.speaker_turns.turns.find((entry) => entry.timecode === timecode)?.transcript?.length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("puts the words that are no turn's in one part each, in order, with the speaker not given and why", () => {
    const others = parts.flatMap((each) => each.speaker_turns.transcript?.other_passages ?? []);

    expect(others.map((p) => [p.text, p.speaker, p.procedural])).toEqual([
      [longHalnrwOtherPassages[0], "speaker not given", null],
      [longHalnrwOtherPassages[1], "speaker not given", "motion"],
      [longHalnrwOtherPassages[2], "speaker not given", "after_adjournment"],
    ]);
    // The words after the adjournment come after the last turn's passages: in the last part.
    expect(parts.at(-1)?.speaker_turns.transcript?.other_passages.map((p) => p.text)).toContain(
      longHalnrwOtherPassages[2],
    );
    // The words before the first turn are in the first part.
    expect(parts[0]?.speaker_turns.transcript?.other_passages.map((p) => p.text)).toContain(longHalnrwOtherPassages[0]);
  });

  it("counts, for each part, the passages that part carries, and adds the machine-transcript notice to each part that has one", () => {
    let total = 0;
    for (const each of parts) {
      const carried =
        each.speaker_turns.turns.reduce((n, turn) => n + (turn.transcript?.length ?? 0), 0) +
        (each.speaker_turns.transcript?.other_passages.length ?? 0);
      total += carried;
      expect(each.speaker_turns.transcript?.passage_count, `part ${String(each.part)}`).toBe(carried);
      expect(each.notice.toLowerCase().includes(MACHINE_NOTICE), `part ${String(each.part)}`).toBe(carried > 0);
    }
    const expected =
      halnrwTurnTimecodes.reduce((n, _, turn) => n + fillerSentenceCount(turn), 0) + longHalnrwOtherPassages.length;
    expect(total).toBe(expected);
  });

  it("still lists every turn of the log in each part, and leaves the transcript off the turns of the other parts", () => {
    for (const each of parts) {
      expect(each.speaker_turns.turns.map((turn) => turn.timecode)).toEqual(halnrwTurnTimecodes);
      expect(each.speaker_turns.turn_count).toBe(38);
    }
    // The turn whose words are in the last part has none in the first.
    const lastTurn = halnrwTurnTimecodes[longTurn];
    expect(parts[0]?.speaker_turns.turns.find((turn) => turn.timecode === lastTurn)?.transcript).toBeUndefined();
  });

  it("says there is no part past the last, with the number of parts the transcript makes", async () => {
    const outcome = await callTool(on, "get_document", { id: LOG, part: parts.length + 1 });

    expect(outcome.isError).toBe(true);
    expect(JSON.stringify(outcome)).toContain(`has ${String(parts.length)} parts`);
  });
});
