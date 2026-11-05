import { describe, expect, test } from "vitest";
import { readTranscript } from "../index.ts";

// Seam 4: the transcript read (ticket #130, spec #123 stage 2, ADR-0053). A transcript file's text and a Meeting's
// speaker turns go in; passages with the turn each belongs to, or "speaker not given", and the drift between turns and
// words come out.
//
// THE TRANSCRIPT IS MADE UP. Its words, their seconds and its hash are invented for these rows and say nothing of what
// was said at any hearing; it was written to fall around the real turns below.
// THE TURNS ARE REAL: the speaker turns the parser reads from the Recording Log of HALNRW 2025-01-22 (feed document
// 288741, test/fixtures/olis-2025R1/documents/committee-meeting-documents/288741.pdf, event 2025011038), lines 00:01:38 to
// 00:12:05, with the second of each turn's player link. Only the second and the name of each turn are used here.
//
// Every expected value below is worked out by hand from those seconds and the made-up words' seconds, in the row's note.

const TURNS_OF_288741 = [
  { offsetSeconds: 98, speaker: "Co-Chair Helm" },
  { offsetSeconds: 107, speaker: "Anna Glueder, LPRO Analyst" },
  {
    offsetSeconds: 169,
    speaker: "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
  },
  { offsetSeconds: 375, speaker: "Melissa Rice, student, Carlson College of Veterinary Medicine, OSU" },
  { offsetSeconds: 524, speaker: "Wendy Krebs, graduate, Carlson College of Veterinary Medicine, OSU" },
  { offsetSeconds: 689, speaker: "Rep. B. Levy" },
  { offsetSeconds: 725, speaker: "Rep. McLain" },
];

type W = [text: string, start: number, end: number];
type Seg = { start: number; end: number; text: string; words: W[] };

function file(segments: Seg[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format_version: 1,
    event_id: "2025011038",
    audio: { sha256: "ab".repeat(32), duration_seconds: 5400.5 },
    model: {
      id: "made-up-model",
      settings: { model_name: "small.en", device: "cpu", compute_type: "int8", language: "en", beam_size: 5 },
    },
    made_at: "2026-11-06T02:15:00Z",
    segments: segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      words: s.words.map(([text, start, end]) => ({ start, end, text })),
    })),
    ...overrides,
  });
}

// Made-up segments, each with its place in the real turns.
// A: one segment that crosses the change from Helm (98) to Glueder (107).
const A: Seg = {
  start: 100,
  end: 107.9,
  text: " Thank you, Anna. Please go ahead.",
  words: [
    [" Thank", 100, 100.4],
    [" you,", 100.4, 100.7],
    [" Anna.", 100.7, 101.3],
    [" Please", 106.5, 106.9],
    [" go", 107, 107.2], // starts at second 107, the second of Glueder's turn: it belongs to that turn
    [" ahead.", 107.2, 107.9],
  ],
};
// B: wholly inside Glueder's turn (107 to 169).
const B: Seg = {
  start: 108,
  end: 112,
  text: " For the record, I am Anna Glueder.",
  words: [
    [" For", 108, 108.2],
    [" the", 108.2, 108.4],
    [" record,", 108.4, 109],
    [" I", 109.5, 109.6],
    [" am", 109.6, 109.8],
    [" Anna", 109.8, 110.2],
    [" Glueder.", 110.2, 112],
  ],
};
// C: crosses two turn changes, Krebs (524) to Levy (689) to McLain (725).
const C: Seg = {
  start: 688.5,
  end: 726,
  text: " Representative Levy asks Rep. McLain",
  words: [
    [" Representative", 688.5, 689], // before 689: Krebs's turn
    [" Levy", 689.2, 689.5],
    [" asks", 724, 724.4],
    [" Rep.", 725.5, 725.9], // after 725: McLain's turn
    [" McLain", 725.9, 726],
  ],
};

const NOT_GIVEN = { kind: "not_given", label: "speaker not given" };

function attached(text: string, turns: typeof TURNS_OF_288741 | null) {
  const read = readTranscript({ file: "hearing-2025011038.transcript.json", text, turns });
  if (read.kind !== "attached") throw new Error(`expected an attached transcript, got ${JSON.stringify(read)}`);
  return read;
}

describe("a known-version file attaches to turns", () => {
  test("each unsplit segment is one passage on the turn its words fall in, with the file's own facts carried", () => {
    const read = attached(file([B]), TURNS_OF_288741);
    // B's words are at 108 to 112; the turn that began last before 108 is Glueder's (107), the second turn (index 1).
    expect(read.passages).toHaveLength(1);
    const [passage] = read.passages;
    expect(passage).toMatchObject({
      startSeconds: 108,
      endSeconds: 112,
      text: "For the record, I am Anna Glueder.",
      speaker: { kind: "turn", turnIndex: 1, turn: TURNS_OF_288741[1] },
    });
    expect(passage?.words).toHaveLength(7);
    expect(read).toMatchObject({
      file: "hearing-2025011038.transcript.json",
      formatVersion: 1,
      eventId: "2025011038",
      audio: { sha256: "ab".repeat(32), durationSeconds: 5400.5 },
      madeAt: "2026-11-06T02:15:00Z",
      model: {
        id: "made-up-model",
        settings: { modelName: "small.en", device: "cpu", computeType: "int8", language: "en", beamSize: 5 },
      },
    });
  });

  test("a word's probability is kept when the file gives it", () => {
    const text = file([{ start: 108, end: 109, text: " Hello.", words: [[" Hello.", 108, 109]] }]);
    const parsed = JSON.parse(text) as { segments: { words: { probability?: number }[] }[] };
    const firstWord = parsed.segments[0]?.words[0];
    if (firstWord) firstWord.probability = 0.875;
    const read = attached(JSON.stringify(parsed), TURNS_OF_288741);
    expect(read.passages[0]?.words[0]).toEqual({ text: " Hello.", start: 108, end: 109, probability: 0.875 });
  });
});

describe("a segment spanning a turn change is split at the word", () => {
  test("A splits into the words before second 107 and the words from it, one passage each", () => {
    const { passages } = attached(file([A]), TURNS_OF_288741);
    // Words start 100, 100.4, 100.7, 106.5 (before 107: Helm, turn 0) and 107, 107.2 (from 107: Glueder, turn 1).
    expect(
      passages.map((p) => [
        p.startSeconds,
        p.endSeconds,
        p.text,
        p.speaker.kind === "turn" ? p.speaker.turnIndex : null,
      ]),
    ).toEqual([
      [100, 106.9, "Thank you, Anna. Please", 0],
      [107, 107.9, "go ahead.", 1],
    ]);
    expect(passages.map((p) => p.words.length)).toEqual([4, 2]);
  });

  test("C splits at two changes into three passages, on Krebs, Levy and McLain", () => {
    const { passages } = attached(file([C]), TURNS_OF_288741);
    // Words start 688.5 (before 689: Krebs, 4), 689.2 and 724 (from 689, before 725: Levy, 5), 725.5 and 725.9 (McLain, 6).
    expect(
      passages.map((p) => [
        p.startSeconds,
        p.endSeconds,
        p.text,
        p.speaker.kind === "turn" ? p.speaker.turnIndex : null,
      ]),
    ).toEqual([
      [688.5, 689, "Representative", 4],
      [689.2, 724.4, "Levy asks", 5],
      [725.5, 726, "Rep. McLain", 6],
    ]);
  });

  test("passages come in the order of the file, and the turns may be given in any order", () => {
    const shuffled = [...TURNS_OF_288741].reverse();
    const { passages } = attached(file([A, B]), shuffled);
    expect(passages.map((p) => (p.speaker.kind === "turn" ? p.speaker.turn.speaker : null))).toEqual([
      "Co-Chair Helm",
      "Anna Glueder, LPRO Analyst",
      "Anna Glueder, LPRO Analyst",
    ]);
  });

  test("words before the first turn have no speaker given", () => {
    // The turns of the log from 98; the log's own first turns (4 and 49) are left out, so the words at 60 precede them all.
    const text = file([
      {
        start: 60,
        end: 61,
        text: " Call to order.",
        words: [
          [" Call", 60, 60.5],
          [" to", 60.5, 60.7],
          [" order.", 60.7, 61],
        ],
      },
    ]);
    const { passages } = attached(text, TURNS_OF_288741);
    expect(passages).toHaveLength(1);
    expect(passages[0]?.speaker).toEqual(NOT_GIVEN);
  });
});

describe("a Meeting with no speaker-turn index", () => {
  test("every passage says speaker not given, and no drift is measured", () => {
    const read = attached(file([A, B, C]), null);
    expect(read.passages).toHaveLength(3);
    expect(read.passages.map((p) => p.speaker)).toEqual([NOT_GIVEN, NOT_GIVEN, NOT_GIVEN]);
    // Without a log nothing is split: each segment stays one passage with the file's text.
    expect(read.passages.map((p) => p.text)).toEqual([
      "Thank you, Anna. Please go ahead.",
      "For the record, I am Anna Glueder.",
      "Representative Levy asks Rep. McLain",
    ]);
    expect(read.drift).toBeNull();
  });
});

describe("drift between the turns and the words", () => {
  // Words from 100 to 101.5 only. Drift of a turn is the distance from its second to the nearest word start or end.
  const words: Seg = {
    start: 100,
    end: 101.5,
    text: " Hello there.",
    words: [
      [" Hello", 100, 100.5],
      [" there.", 100.5, 101.5],
    ],
  };
  const turns = [{ offsetSeconds: 98 }, { offsetSeconds: 111.5 }, { offsetSeconds: 112 }, { offsetSeconds: 169 }];

  test("is the distance to the nearest word boundary, and is flagged only above 10 seconds", () => {
    const read = attached(file([words]), turns as never);
    // 98 is 2 from the word start 100; 111.5 is exactly 10 from the last word end 101.5; 112 is 10.5; 169 is 67.5.
    expect(read.drift?.thresholdSeconds).toBe(10);
    expect(read.drift?.turns.map((t) => [t.offsetSeconds, t.driftSeconds])).toEqual([
      [98, 2],
      [111.5, 10],
      [112, 10.5],
      [169, 67.5],
    ]);
    expect(read.drift?.flagged.map((t) => t.offsetSeconds)).toEqual([112, 169]);
  });

  test("a Meeting whose turns all sit among its words reports none", () => {
    const read = attached(file([A, B]), TURNS_OF_288741.slice(0, 2));
    // Turns 98 and 107: 98 is 2 from 100; 107 is 0 from the word start 107.
    expect(read.drift?.turns.map((t) => t.driftSeconds)).toEqual([2, 0]);
    expect(read.drift?.flagged).toEqual([]);
  });

  test("a transcript with no words puts every turn out of reach", () => {
    const read = attached(file([]), turns as never);
    expect(read.drift?.flagged).toHaveLength(4);
    expect(read.drift?.turns.every((t) => t.driftSeconds === null)).toBe(true);
  });
});

describe("a file that is refused", () => {
  test("an unknown version names the file and the version, and reads nothing else", () => {
    const text = file([A], { format_version: 2, anything: "a later format may change every field" });
    const read = readTranscript({ file: "hearing-2025011038.transcript.json", text, turns: TURNS_OF_288741 });
    expect(read).toMatchObject({
      kind: "refused",
      reason: "unknown_version",
      file: "hearing-2025011038.transcript.json",
      version: 2,
    });
    expect(read.kind === "refused" && read.message).toContain("hearing-2025011038.transcript.json");
    expect(read.kind === "refused" && read.message).toContain("2");
  });

  test("a version that is not a whole number is named as it is written", () => {
    const text = file([A], { format_version: "one" });
    const read = readTranscript({ file: "x.json", text, turns: null });
    expect(read).toMatchObject({ kind: "refused", reason: "unknown_version", file: "x.json", version: "one" });
  });

  test("a file with no version, or that is not JSON, is refused as not valid and names the file", () => {
    const noVersion = readTranscript({ file: "y.json", text: JSON.stringify({ event_id: "1" }), turns: null });
    expect(noVersion).toMatchObject({ kind: "refused", reason: "not_valid", file: "y.json" });
    const notJson = readTranscript({ file: "z.json", text: "{ not json", turns: null });
    expect(notJson).toMatchObject({ kind: "refused", reason: "not_valid", file: "z.json" });
  });

  test("a version-1 file that breaks the format is refused with the file, and says where", () => {
    const parsed = JSON.parse(file([A])) as { audio: { sha256?: string } };
    delete parsed.audio.sha256;
    const read = readTranscript({ file: "w.json", text: JSON.stringify(parsed), turns: null });
    expect(read).toMatchObject({ kind: "refused", reason: "not_valid", file: "w.json" });
    expect(read.kind === "refused" && read.message).toContain("w.json");
    expect(read.kind === "refused" && read.message).toContain("audio.sha256");
  });

  test("a word that ends before it starts is refused", () => {
    const bad: Seg = { start: 1, end: 2, text: " x", words: [[" x", 2, 1]] };
    const read = readTranscript({ file: "v.json", text: file([bad]), turns: null });
    expect(read).toMatchObject({ kind: "refused", reason: "not_valid", file: "v.json" });
  });
});
