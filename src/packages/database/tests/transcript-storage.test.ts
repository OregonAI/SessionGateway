// Seam 4 (test/CLAUDE.md): the transcript passages of a Meeting, through the writer's, the reader's and search's entry points
// (ticket #134, ADR-0055, schema step 4). A WAL database in a temp directory of the test's own; a case arranges state through
// the writer and asserts what the readers hand back. Every value is MADE UP (made-up-index.ts): the log, its turns, the
// words. The real log's turns and the made-up transcript of it are seam 1's (test/tools/transcripts-*.test.ts).
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { DocumentId } from "#/packages/domain/documents.ts";
import type { MeasureId } from "#/packages/domain/index.ts";
import type { Passage } from "#/packages/domain/search.ts";
import type { SpeakerTurn } from "#/packages/domain/speaker-turns.ts";
import type { TranscriptPassage, TranscriptRecord } from "#/packages/domain/transcripts.ts";
import {
  agendaItem,
  asOf,
  committee,
  measure,
  meetingOn,
  modelId,
  openMadeUpIndex,
  pullOf,
  recordingLogLink,
  searchRecordOf,
  session,
  storedOf,
  type MadeUpIndex,
} from "./made-up-index.ts";

let index: MadeUpIndex;
const log = recordingLogLink();
const logId = log.id;
const meeting = meetingOn(10);
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

const text = "MADE UP COMMITTEE\n00:00:04 Co-Chair Upp\n00:00:31 Pat Poe, Director, Made Up Agency\n";
const player = (seconds: number): string =>
  `https://made-up.example/mediaplayer?clientID=1&eventID=2099010001&startStreamAt=${seconds}`;
const turn = (
  offsetSeconds: number,
  timecode: string,
  speaker: string,
  parts: Partial<SpeakerTurn> = {},
): SpeakerTurn => ({
  timecode,
  offsetSeconds,
  offsetSource: "link",
  speaker,
  legislatorCode: null,
  legislator: null,
  agendaItem: null,
  measureId: null,
  playerLink: player(offsetSeconds),
  ...parts,
});
const turns = [
  turn(4, "00:00:04", "Co-Chair Upp"),
  turn(31, "00:00:31", "Pat Poe, Director, Made Up Agency", {
    agendaItem: "SB 9001 - Public Hearing",
    measureId: "measure-2099r1-sb9001" as MeasureId,
  }),
];

const noQuality = { avgLogprob: null, compressionRatio: null, noSpeechProb: null, temperature: null };

function passageOf(
  startSeconds: number,
  words: string,
  speaker: TranscriptPassage["speaker"],
  parts: Partial<TranscriptPassage> = {},
): TranscriptPassage {
  return {
    startSeconds,
    endSeconds: startSeconds + 3,
    text: words,
    hash: hash(words),
    documentId: logId,
    speaker,
    agendaItem: null,
    measureId: null,
    playerLink: player(Math.floor(startSeconds)),
    quality: noQuality,
    ...parts,
  };
}

function recordOf(passages: TranscriptPassage[], parts: Partial<TranscriptRecord> = {}): TranscriptRecord {
  return {
    meetingId: meeting.id,
    eventId: "2099010001",
    file: "2099010001.transcript.json",
    fileSha256: hash("file one"),
    attachedTo: hash("turns one"),
    readerVersion: 1,
    audioSha256: hash("audio"),
    durationSeconds: 3600,
    modelId: "MADE UP model",
    madeAt: "2099-01-11T00:00:00-08:00",
    drift: { medianSeconds: 2, maxSeconds: 5, flaggedTurns: 0, meetingFlagged: false },
    passages,
    vectors: { modelId, rows: [] },
    ...parts,
  };
}

function storeLogWithIndex(): void {
  index.writer.recordFullPull(
    session,
    asOf(1),
    pullOf({
      Committees: [committee],
      CommitteeMeetings: [meeting],
      CommitteeMeetingDocuments: [log],
      CommitteeAgendaItems: [agendaItem],
      Measures: [measure],
    }),
  );
  const logPassage: Passage = { start: 0, end: text.length, text, hash: hash(text) };
  index.writer.storeDocument(session, storedOf(log, text), {
    ...searchRecordOf(log, text, true),
    passages: [logPassage],
    vectors: { modelId, rows: [] },
  });
  index.writer.storeSpeakerTurnIndex({
    documentId: logId,
    outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns },
  });
}

beforeEach(() => {
  index = openMadeUpIndex();
  storeLogWithIndex();
});
afterEach(() => {
  index.close();
});

describe("a Meeting's transcript passages", () => {
  test("the writer lists the Meeting's logs with their turns as what a transcript is read against", () => {
    const targets = index.writer.transcriptTargets(session);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ meetingId: meeting.id, eventId: "2099010001" });
    expect(
      targets[0]?.logs.map((entry) => [entry.documentId, entry.text, entry.turns.map((t) => [t.position, t.speaker])]),
    ).toEqual([
      [
        logId,
        text,
        [
          [0, "Co-Chair Upp"],
          [1, "Pat Poe, Director, Made Up Agency"],
        ],
      ],
    ]);
  });

  test("a stored transcript is read back by its log: each turn's passages in order, and the words that are no turn's apart", () => {
    index.writer.storeTranscript(
      recordOf([
        passageOf(1, "before anyone", { kind: "not_given", reason: null }),
        passageOf(5, "welcome all", { kind: "turn", position: 0 }),
        passageOf(
          40,
          "the walrus bill",
          { kind: "turn", position: 1 },
          { agendaItem: "SB 9001 - Public Hearing", measureId: "measure-2099r1-sb9001" as MeasureId },
        ),
        passageOf(60, "so moved", { kind: "procedural", entry: "motion" }),
      ]),
    );

    const stored = index.reader.transcriptOfLog(logId);

    expect(stored?.modelId).toBe("MADE UP model");
    expect(stored?.turns.map((passages) => passages.map((p) => p.text))).toEqual([
      ["welcome all"],
      ["the walrus bill"],
    ]);
    expect(stored?.other.map((p) => [p.text, p.speaker.kind])).toEqual([
      ["before anyone", "not_given"],
      ["so moved", "procedural"],
    ]);
    expect(stored?.turns[1]?.[0]).toMatchObject({
      startSeconds: 40,
      endSeconds: 43,
      playerLink: player(40),
      measureId: "measure-2099r1-sb9001",
    });
    expect(index.reader.meetingHasTranscript(meeting.id)).toBe(true);
    expect(index.reader.transcriptOfLog("recording-log-2099r1-1" as DocumentId)).toBeUndefined();
  });

  test("search finds a passage by its words, with its turn and Meeting, and not through a Measure it is not under", () => {
    index.writer.storeTranscript(
      recordOf([
        passageOf(5, "welcome all", { kind: "turn", position: 0 }),
        passageOf(
          40,
          "the walrus bill",
          { kind: "turn", position: 1 },
          { measureId: "measure-2099r1-sb9001" as MeasureId },
        ),
      ]),
    );

    const found = index.search.keywordTranscripts('"walrus"', { session, withTestimony: false }, 10);
    expect(found).toHaveLength(1);
    const details = index.search.transcriptDetails(found[0]?.transcriptPassageId ?? -1);
    expect(details).toMatchObject({
      documentId: logId,
      meetingId: meeting.id,
      text: "the walrus bill",
      startSeconds: 40,
    });
    expect(details.speaker).toMatchObject({ kind: "turn", turn: { speaker: "Pat Poe, Director, Made Up Agency" } });

    const underMeasure = index.search.keywordTranscripts(
      '"walrus"',
      { session, withTestimony: false, measure: "measure-2099r1-sb9001" as MeasureId },
      10,
    );
    const otherMeasure = index.search.keywordTranscripts(
      '"walrus"',
      { session, withTestimony: false, measure: "measure-2099r1-sb9002" as MeasureId },
      10,
    );
    expect(underMeasure).toHaveLength(1);
    expect(otherMeasure).toEqual([]);
  });

  test("storing the Meeting's transcript again replaces its passages, so the old words are no longer found, and moves the search generation", () => {
    index.writer.storeTranscript(recordOf([passageOf(5, "welcome all", { kind: "turn", position: 0 })]));
    const before = index.search.generation();

    index.writer.storeTranscript(
      recordOf([passageOf(5, "welcome gooseberry", { kind: "turn", position: 0 })], { fileSha256: hash("file two") }),
    );

    expect(index.search.keywordTranscripts('"all"', { session, withTestimony: false }, 10)).toEqual([]);
    expect(index.search.keywordTranscripts('"gooseberry"', { session, withTestimony: false }, 10)).toHaveLength(1);
    expect(index.search.generation()).toBeGreaterThan(before);
    expect(index.writer.storedTranscripts(session)).toEqual([
      {
        meetingId: meeting.id,
        eventId: "2099010001",
        file: "2099010001.transcript.json",
        fileSha256: hash("file two"),
        attachedTo: hash("turns one"),
        readerVersion: 1,
      },
    ]);
  });

  // Ticket #187 (ADR-0066): the version of the reader that read the file is stored with the transcript, and kept when the words
  // are attached to new turns from the store (the file was not read again).
  test("records the version of the reader that read the file, and keeps it when the stored words are attached again", () => {
    index.writer.storeTranscript(
      recordOf([passageOf(5, "welcome all", { kind: "turn", position: 0 })], { readerVersion: 3 }),
    );
    expect(index.writer.storedTranscripts(session)[0]?.readerVersion).toBe(3);

    index.writer.reattachTranscript({
      meetingId: meeting.id,
      eventId: "2099010001",
      attachedTo: hash("turns two"),
      passages: [passageOf(5, "welcome all", { kind: "turn", position: 1 })],
      vectors: { modelId, rows: [] },
    });

    expect(index.writer.storedTranscripts(session)[0]).toMatchObject({
      attachedTo: hash("turns two"),
      readerVersion: 3,
    });
  });

  test("a passage's vector is read with the passage, and only under the model it was made with", () => {
    const vector = new Int8Array(384);
    vector[3] = 127;
    index.writer.storeTranscript(
      recordOf([passageOf(5, "welcome all", { kind: "turn", position: 0 })], {
        vectors: { modelId, rows: [{ hash: hash("welcome all"), vector }] },
      }),
    );

    expect(index.search.transcriptVectorCount(session, modelId)).toBe(1);
    expect(index.search.transcriptVectorCount(session, "another-model")).toBe(0);
    const [row] = [...index.search.transcriptVectors(session, modelId)];
    expect(row).toMatchObject({ documentId: logId, facts: { kind: "recording_log" } });
    expect([...(row?.vector ?? [])].indexOf(127)).toBe(3);
  });

  test("the build report's notes give each stored transcript's drift as it was measured", () => {
    index.writer.storeTranscript(
      recordOf([], { drift: { medianSeconds: 315, maxSeconds: 1587, flaggedTurns: 33, meetingFlagged: true } }),
    );

    expect(index.writer.transcriptNotes(session)).toEqual({
      stored: 1,
      driftFlags: [
        {
          meetingId: meeting.id,
          eventId: "2099010001",
          file: "2099010001.transcript.json",
          medianSeconds: 315,
          maxSeconds: 1587,
          flaggedTurns: 33,
          meetingFlagged: true,
        },
      ],
    });
  });
});

describe("the quality numbers of a passage (owner decision 3 of 2026-11-05)", () => {
  const quality = { avgLogprob: -0.31, compressionRatio: 1.4, noSpeechProb: 0.02, temperature: 0.2 };

  test("are stored with each passage and read back by the log's reader, search's details and the worker's stored words; a number the file did not give is null", () => {
    index.writer.storeTranscript(
      recordOf([
        passageOf(5, "welcome all", { kind: "turn", position: 0 }, { quality }),
        passageOf(
          40,
          "the walrus bill",
          { kind: "turn", position: 1 },
          { quality: { ...noQuality, avgLogprob: -1.9, temperature: 0 } },
        ),
        passageOf(60, "so moved", { kind: "procedural", entry: "motion" }),
      ]),
    );

    const stored = index.reader.transcriptOfLog(logId);
    expect(stored?.turns[0]?.[0]?.quality).toEqual(quality);
    expect(stored?.turns[1]?.[0]?.quality).toEqual({
      avgLogprob: -1.9,
      compressionRatio: null,
      noSpeechProb: null,
      temperature: 0,
    });
    expect(stored?.other[0]?.quality).toEqual(noQuality);
    const [found] = index.search.keywordTranscripts('"welcome"', { session, withTestimony: false }, 10);
    expect(index.search.transcriptDetails(found?.transcriptPassageId ?? -1).quality).toEqual(quality);
    expect(
      index.writer.storedTranscriptWords(meeting.id, "2099010001").map((word) => [word.text, word.quality]),
    ).toEqual([
      ["welcome all", quality],
      ["the walrus bill", { ...noQuality, avgLogprob: -1.9, temperature: 0 }],
      ["so moved", noQuality],
    ]);
  });
});

describe("the words of a stored transcript, for attaching it again when its file is gone", () => {
  test("come back in the order they were stored, each with its seconds", () => {
    index.writer.storeTranscript(
      recordOf([
        passageOf(1, "before anyone", { kind: "not_given", reason: null }),
        passageOf(5, "welcome all", { kind: "turn", position: 0 }),
      ]),
    );

    expect(index.writer.storedTranscriptWords(meeting.id, "2099010001")).toEqual([
      { startSeconds: 1, endSeconds: 4, text: "before anyone", quality: noQuality },
      { startSeconds: 5, endSeconds: 8, text: "welcome all", quality: noQuality },
    ]);
    expect(index.writer.storedTranscriptWords(meeting.id, "2099019999")).toEqual([]);
  });
});

describe("a log whose index is stored again", () => {
  // The log's turns again, with one more at the front: every position moves by one, as a re-read of the links may make them.
  const turnsAgain = [turn(2, "00:00:02", "Clerk Added"), ...turns];
  const reindexed = (): void => {
    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns: turnsAgain },
    });
  };
  const vector = new Int8Array(384);
  vector[7] = 127;

  test("has its transcript marked for attaching again, so it is no longer what the file was attached to", () => {
    index.writer.storeTranscript(recordOf([passageOf(40, "the walrus bill", { kind: "turn", position: 1 })]));
    const before = index.search.generation();

    reindexed();

    expect(index.writer.storedTranscripts(session)).toHaveLength(1);
    expect(index.writer.storedTranscripts(session)[0]?.attachedTo).not.toBe(hash("turns one"));
    // The server loads the vectors again, which now leave the transcript out.
    expect(index.search.generation()).toBeGreaterThan(before);
  });

  test("shows nothing of its transcript until it is attached again: no passage can point at a position that moved", () => {
    index.writer.storeTranscript(
      recordOf([passageOf(40, "the walrus bill", { kind: "turn", position: 1 })], {
        vectors: { modelId, rows: [{ hash: hash("the walrus bill"), vector }] },
      }),
    );

    reindexed();

    expect(index.reader.transcriptOfLog(logId)).toBeUndefined();
    expect(index.search.keywordTranscripts('"walrus"', { session, withTestimony: false }, 10)).toEqual([]);
    expect(index.search.transcriptVectorCount(session, modelId)).toBe(0);
    expect([...index.search.transcriptVectors(session, modelId)]).toEqual([]);
    // It is still stored: the Meeting has it, and its words are there to attach again.
    expect(index.reader.meetingHasTranscript(meeting.id)).toBe(true);
    expect(index.writer.storedTranscriptWords(meeting.id, "2099010001").map((word) => word.text)).toEqual([
      "the walrus bill",
    ]);

    // Attached again to the new turns, it is shown, and its speaker is the turn at the position the passage names now.
    index.writer.storeTranscript(
      recordOf([passageOf(40, "the walrus bill", { kind: "turn", position: 2 })], { attachedTo: hash("turns two") }),
    );
    const again = index.reader.transcriptOfLog(logId);
    expect(again?.turns.map((passages) => passages.map((p) => p.text))).toEqual([[], [], ["the walrus bill"]]);
    expect(again?.turns[2]?.[0]?.speaker).toMatchObject({
      kind: "turn",
      turn: { speaker: "Pat Poe, Director, Made Up Agency" },
    });
  });
});

describe("where a turn's lines start in the log's text", () => {
  const preamble = "MADE UP COMMITTEE\n";
  const lineOne = "00:00:04 Co-Chair Upp\n";
  const lineTwo = "00:00:31 Pat Poe, Director, Made Up Agency\n";
  const slice = (start: number, end: number, turnPosition?: number): Passage => ({
    start,
    end,
    text: text.slice(start, end),
    hash: hash(text.slice(start, end)),
    ...(turnPosition === undefined ? {} : { turn: turnPosition }),
  });

  test("is given for each turn the worker cut the text around, in the order of the turns, and is null for one it could not place", () => {
    // The text is the made-up one above: the first line is 18 characters with its break, the second 22.
    expect(preamble.length).toBe(18);
    expect(lineOne.length).toBe(22);
    index.writer.storeTranscript(recordOf([passageOf(5, "welcome all", { kind: "turn", position: 0 })]));

    index.writer.replacePassages(logId, [slice(0, 18), slice(18, 40, 0), slice(40, 40 + lineTwo.length, 1)], 0, 1);
    expect(index.reader.transcriptOfLog(logId)?.turnTextOffsets).toEqual([18, 40]);

    // A turn with no passage of its own (the text could not place it) has no offset.
    index.writer.replacePassages(logId, [slice(0, 18), slice(18, 40, 0), slice(40, 40 + lineTwo.length)], 1, 1);
    expect(index.reader.transcriptOfLog(logId)?.turnTextOffsets).toEqual([18, null]);
  });
});
