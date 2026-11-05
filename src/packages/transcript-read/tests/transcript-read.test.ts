import { describe, expect, test } from "vitest";
import { readTranscript } from "../index.ts";

// Seam 4: the transcript read (ticket #130, spec #123 stage 2, ADR-0054). A transcript file's text and a Meeting's
// speaker turns go in; passages with the turn each belongs to, or "speaker not given", and the drift between turns and
// words come out.
//
// THE TRANSCRIPT IS MADE UP. Its words, their seconds and its hash are invented for these rows and say nothing of what
// was said at any hearing; it was written to fall around the real turns below.
// THE TURNS ARE REAL: the speaker turns the parser reads from the Recording Log of HALNRW 2025-01-22 (feed document
// 288741, test/fixtures/olis-2025R1/documents/committee-meeting-documents/288741.pdf, event 2025011038), lines 00:01:38 to
// 00:12:05, with the second of each turn's player link. Only the second and the name of each turn are used here.
//
// THE LOG'S OTHER ENTRIES (recess, reconvene, motion, motion result, vote, roll call, adjournment) used in the rows
// for ADR-0054's procedural words are MADE UP too, at made-up seconds, and labelled where they are used.
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
type Seg = { start: number; end: number; text: string; words: W[]; quality?: Record<string, number> };

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
      ...s.quality,
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

const EVENT_ID = "2025011038";

type Turn = { offsetSeconds: number };
type Entry = { kind: string; offsetSeconds: number; text?: string };

function attached<T extends Turn>(text: string, turns: readonly T[] | null, entries: readonly Entry[] = []) {
  const read = readTranscript({
    file: "hearing-2025011038.transcript.json",
    text,
    eventId: EVENT_ID,
    turns,
    entries,
  });
  if (read.kind !== "attached") throw new Error(`expected an attached transcript, got ${JSON.stringify(read)}`);
  return read;
}

const rows = (passages: ReturnType<typeof attached>["passages"]) =>
  passages.map((p) => [
    p.startSeconds,
    p.endSeconds,
    p.text,
    p.speaker.kind === "turn"
      ? `turn:${p.speaker.turnIndex}`
      : p.speaker.kind === "entry"
        ? `entry:${p.speaker.entryIndex}`
        : p.speaker.reason === undefined
          ? "not_given"
          : `not_given:${p.speaker.reason}`,
  ]);

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

describe("drift is the turn's second against the nearest transcript segment start", () => {
  // Made-up segments that start at 100 and at 120 and have no words: drift reads segment starts, not words.
  const empty = (start: number): Seg => ({ start, end: start + 5, text: "", words: [] });
  const starts = file([empty(100), empty(120)]);

  test("each turn is measured on its own, in the caller's order, and carries the caller's turn", () => {
    // Given out of order on purpose: the results must not be in the order of a sorted copy.
    const turns = [
      { offsetSeconds: 125, name: "a" }, // 5 from 120
      { offsetSeconds: 98, name: "b" }, // 2 from 100
      { offsetSeconds: 111, name: "c" }, // 11 from 100, 9 from 120: 9
      { offsetSeconds: 131, name: "d" }, // 11 from 120
      { offsetSeconds: 110, name: "e" }, // 10 from 100 and from 120: 10
    ];
    const drift = attached(starts, turns).drift;
    expect(drift?.thresholdSeconds).toBe(10);
    expect(drift?.turns.map((t) => [t.turnIndex, t.turn.name, t.offsetSeconds, t.driftSeconds])).toEqual([
      [0, "a", 125, 5],
      [1, "b", 98, 2],
      [2, "c", 111, 9],
      [3, "d", 131, 11],
      [4, "e", 110, 10],
    ]);
    expect(drift?.turns[3]?.turn).toBe(turns[3]);
    // Over 10 is flagged and exactly 10 (turn e) is not: only d.
    expect(drift?.flagged.map((t) => [t.turnIndex, t.turn.name])).toEqual([[3, "d"]]);
    // Sorted drifts 2, 5, 9, 10, 11: the median is 9 and the maximum 11; 9 is not over 10.
    expect(drift?.medianSeconds).toBe(9);
    expect(drift?.maxSeconds).toBe(11);
    expect(drift?.meetingFlagged).toBe(false);
  });

  test("the median of an even number of turns is the mean of the middle two", () => {
    // 98 is 2 from 100; 131 is 11 from 120: sorted 2, 11, the median 6.5, the maximum 11.
    const drift = attached(starts, [{ offsetSeconds: 131 }, { offsetSeconds: 98 }]).drift;
    expect(drift?.medianSeconds).toBe(6.5);
    expect(drift?.maxSeconds).toBe(11);
    expect(drift?.meetingFlagged).toBe(false);
    expect(drift?.flagged.map((t) => t.turnIndex)).toEqual([0]);
  });

  test("the Meeting is flagged when the median is over 10 seconds, and not at exactly 10", () => {
    // 140 is 20 from 120, 145 is 25, 98 is 2: sorted 2, 20, 25, the median 20.
    const over = attached(starts, [{ offsetSeconds: 140 }, { offsetSeconds: 145 }, { offsetSeconds: 98 }]).drift;
    expect(over?.medianSeconds).toBe(20);
    expect(over?.maxSeconds).toBe(25);
    expect(over?.meetingFlagged).toBe(true);
    expect(over?.flagged.map((t) => t.turnIndex)).toEqual([0, 1]);
    // One turn at 110 is 10 from both starts: the median is 10, which is not over 10.
    const exactly = attached(starts, [{ offsetSeconds: 110 }]).drift;
    expect(exactly?.medianSeconds).toBe(10);
    expect(exactly?.meetingFlagged).toBe(false);
    expect(exactly?.flagged).toEqual([]);
  });

  test("a transcript with no segments puts every turn out of reach, and the Meeting is flagged", () => {
    const drift = attached(file([]), [{ offsetSeconds: 98 }, { offsetSeconds: 107 }]).drift;
    expect(drift?.turns.map((t) => t.driftSeconds)).toEqual([null, null]);
    expect(drift?.flagged).toHaveLength(2);
    expect(drift?.medianSeconds).toBeNull();
    expect(drift?.maxSeconds).toBeNull();
    expect(drift?.meetingFlagged).toBe(true);
  });

  test("a Meeting with a log but no turns has nothing to measure and is not flagged", () => {
    const drift = attached(starts, []).drift;
    expect(drift).toMatchObject({
      turns: [],
      flagged: [],
      medianSeconds: null,
      maxSeconds: null,
      meetingFlagged: false,
    });
  });

  test("the log's other entries are not turns and are not measured", () => {
    const drift = attached(starts, [{ offsetSeconds: 98 }], [{ kind: "recess", offsetSeconds: 5000 }]).drift;
    expect(drift?.turns).toHaveLength(1);
    expect(drift?.meetingFlagged).toBe(false);
  });
});

describe("where a turn is, and what a passage carries of the caller's turns", () => {
  test("a passage's turnIndex is the turn's position in the caller's array, and its turn is the caller's own", () => {
    const shuffled = [...TURNS_OF_288741].reverse(); // Helm (98) is now at position 6 and Glueder (107) at 5
    const { passages } = attached(file([A]), shuffled);
    expect(passages.map((p) => (p.speaker.kind === "turn" ? p.speaker.turnIndex : null))).toEqual([6, 5]);
    expect(passages[0]?.speaker.kind === "turn" && passages[0].speaker.turn).toBe(shuffled[6]);
    expect(passages[1]?.speaker.kind === "turn" && passages[1].speaker.turn).toBe(shuffled[5]);
  });
});

describe("edge cases, each worked by hand", () => {
  test("a word straddling a turn boundary belongs to the turn it starts in", () => {
    // Glueder's turn is at 107. " Anna" runs 106.8 to 107.4: it starts before 107, so it is Helm's (turn 0), and the
    // passage ends at its end, 107.4. " next" starts at 107.4, after 107: Glueder's (turn 1).
    const seg: Seg = {
      start: 104,
      end: 108,
      text: " ok Anna next",
      words: [
        [" ok", 104, 104.5],
        [" Anna", 106.8, 107.4],
        [" next", 107.4, 108],
      ],
    };
    expect(rows(attached(file([seg]), TURNS_OF_288741).passages)).toEqual([
      [104, 107.4, "ok Anna", "turn:0"],
      [107.4, 108, "next", "turn:1"],
    ]);
  });

  test("two turns at the same second: the one later in the caller's array has the words", () => {
    // Made-up turns X and Y both at 200. A word at 200.5 has Y (position 1) as the last turn at or before it; X has none.
    const seg: Seg = { start: 200.5, end: 201, text: " hi", words: [[" hi", 200.5, 201]] };
    const xy = [
      { offsetSeconds: 200, name: "X" },
      { offsetSeconds: 200, name: "Y" },
    ];
    expect(rows(attached(file([seg]), xy).passages)).toEqual([[200.5, 201, "hi", "turn:1"]]);
    // Given the other way round, position 1 is X, and X has them.
    const yx = [...xy].reverse();
    expect(rows(attached(file([seg]), yx).passages)).toEqual([[200.5, 201, "hi", "turn:1"]]);
    const read = attached(file([seg]), yx);
    expect(read.passages[0]?.speaker.kind === "turn" && read.passages[0].speaker.turn.name).toBe("X");
  });

  test("words after the last turn stay with it, however late", () => {
    // McLain's turn (725) is the last; a word at 5000 has no later turn to end it.
    const seg: Seg = { start: 5000, end: 5001, text: " late", words: [[" late", 5000, 5001]] };
    expect(rows(attached(file([seg]), TURNS_OF_288741).passages)).toEqual([[5000, 5001, "late", "turn:6"]]);
  });

  test("a segment with no words falls in the turn of its own start, or has no speaker given before the first turn", () => {
    // Start 120 is after Glueder's 107 and before Williams's 169: turn 1. Start 60 is before Helm's 98.
    const inside: Seg = { start: 120, end: 125, text: " (silence) ", words: [] };
    const before: Seg = { start: 60, end: 65, text: " (music)", words: [] };
    const read = attached(file([inside, before]), TURNS_OF_288741);
    expect(rows(read.passages)).toEqual([
      [120, 125, "(silence)", "turn:1"],
      [60, 65, "(music)", "not_given"],
    ]);
    expect(read.passages.map((p) => p.words)).toEqual([[], []]);
  });

  test("words before the first turn are not given, and the same segment is split where the first turn begins", () => {
    // Helm's turn is at 98: the words at 60 and 97.9 precede it; the word at 98 is his.
    const seg: Seg = {
      start: 60,
      end: 99,
      text: " Call order Now",
      words: [
        [" Call", 60, 60.5],
        [" order", 97.9, 97.95],
        [" Now", 98, 99],
      ],
    };
    expect(rows(attached(file([seg]), TURNS_OF_288741).passages)).toEqual([
      [60, 97.95, "Call order", "not_given"],
      [98, 99, "Now", "turn:0"],
    ]);
  });
});

describe("words that no speaker said: a recess, a motion, a vote, a roll call, after adjournment", () => {
  // THE ENTRIES ARE MADE UP, with the turns of 288741 (Williams 169 is turn 2, Rice 375 turn 3, McLain 725 turn 6).
  // They are in the shape the Recording Log parser gives (its TimedEntry kinds and its VoteEntry), at invented seconds.
  const ENTRIES = [
    { kind: "recess", offsetSeconds: 200, text: "Recess" }, // 0
    { kind: "reconvene", offsetSeconds: 240, text: "Reconvene" }, // 1
    { kind: "motion", offsetSeconds: 380, text: "Motion to adopt" }, // 2
    { kind: "motion-result", offsetSeconds: 392, text: "Motion passes" }, // 3
    { kind: "vote", offsetSeconds: 400, text: "VOTE: 7-0-2" }, // 4
    { kind: "roll-call", offsetSeconds: 410, text: "Roll call" }, // 5
    { kind: "adjournment", offsetSeconds: 800, text: "Adjourned" }, // 6
    { kind: "call-to-order", offsetSeconds: 99, text: "Call to order" }, // 7: not read
    { kind: "agenda-item", offsetSeconds: 120, text: "HB 2000" }, // 8: not read
  ];
  test("after a recess until the reconvene, speaker not given and marked as during a recess", () => {
    // Word starts 190 and 199.9 are before the recess (200): Williams, turn 2. 205 and 239.9 are in the recess (the
    // reconvene is at 240). 241 is after the reconvene and before Rice at 375: no one is named, so plain not given.
    const seg: Seg = {
      start: 190,
      end: 241.5,
      text: " back soon hum tick Welcome",
      words: [
        [" back", 190, 190.5],
        [" soon", 199.9, 200.3],
        [" hum", 205, 205.5],
        [" tick", 239.9, 240.2],
        [" Welcome", 241, 241.5],
      ],
    };
    expect(rows(attached(file([seg]), TURNS_OF_288741, ENTRIES).passages)).toEqual([
      [190, 200.3, "back soon", "turn:2"],
      [205, 240.2, "hum tick", "not_given:during_recess"],
      [241, 241.5, "Welcome", "not_given"],
    ]);
  });

  test("words during a motion, its result, a vote or a roll call attach to that entry, not to the previous speaker", () => {
    // Rice (375) has 376 and 379.9. Motion (380): 381. Motion result (392): 393. Vote (400): 401. Roll call (410): 411, 412.
    const seg: Seg = {
      start: 376,
      end: 412.5,
      text: " I move that passes ayes Clerk calls",
      words: [
        [" I", 376, 376.2],
        [" move", 379.9, 380.2],
        [" that", 381, 381.2],
        [" passes", 393, 393.5],
        [" ayes", 401, 401.4],
        [" Clerk", 411, 411.5],
        [" calls", 412, 412.5],
      ],
    };
    const read = attached(file([seg]), TURNS_OF_288741, ENTRIES);
    expect(rows(read.passages)).toEqual([
      [376, 380.2, "I move", "turn:3"],
      [381, 381.2, "that", "entry:2"],
      [393, 393.5, "passes", "entry:3"],
      [401, 401.4, "ayes", "entry:4"],
      [411, 412.5, "Clerk calls", "entry:5"],
    ]);
    const motion = read.passages[1]?.speaker;
    expect(motion?.kind === "entry" && motion.entry).toBe(ENTRIES[2]);
  });

  test("after adjournment, speaker not given and marked as after adjournment", () => {
    // McLain (725) has 799; the adjournment is at 800: 801 and 5000 are after it.
    const seg: Seg = {
      start: 799,
      end: 5001,
      text: " Thanks Adjourned. bye",
      words: [
        [" Thanks", 799, 799.5],
        [" Adjourned.", 801, 802],
        [" bye", 5000, 5001],
      ],
    };
    expect(rows(attached(file([seg]), TURNS_OF_288741, ENTRIES).passages)).toEqual([
      [799, 799.5, "Thanks", "turn:6"],
      [801, 5001, "Adjourned. bye", "not_given:after_adjournment"],
    ]);
  });

  test("a call to order and an agenda item are not read: the words stay with the speaker", () => {
    // 125 is after the agenda item (120) and the call to order (99) and before Williams (169): Glueder, turn 1.
    const seg: Seg = { start: 125, end: 126, text: " ok", words: [[" ok", 125, 126]] };
    expect(rows(attached(file([seg]), TURNS_OF_288741, ENTRIES).passages)).toEqual([[125, 126, "ok", "turn:1"]]);
  });

  test("at the same second a speaker's turn wins over an entry, and between entries the later in the caller's array wins", () => {
    const seg: Seg = { start: 300.5, end: 301, text: " x", words: [[" x", 300.5, 301]] };
    const turn = [{ offsetSeconds: 300 }];
    expect(rows(attached(file([seg]), turn, [{ kind: "motion", offsetSeconds: 300 }]).passages)).toEqual([
      [300.5, 301, "x", "turn:0"],
    ]);
    const recessThenReconvene = [
      { kind: "recess", offsetSeconds: 300 },
      { kind: "reconvene", offsetSeconds: 300 },
    ];
    expect(rows(attached(file([seg]), [], recessThenReconvene).passages)).toEqual([[300.5, 301, "x", "not_given"]]);
    expect(rows(attached(file([seg]), [], [...recessThenReconvene].reverse()).passages)).toEqual([
      [300.5, 301, "x", "not_given:during_recess"],
    ]);
  });

  test("a Meeting with no log has every passage not given, whatever entries are passed", () => {
    const seg: Seg = { start: 205, end: 206, text: " hum", words: [[" hum", 205, 206]] };
    expect(rows(attached(file([seg]), null, ENTRIES).passages)).toEqual([[205, 206, "hum", "not_given"]]);
  });
});

describe("the Meeting's event ID comes from the caller and the file must agree", () => {
  test("a file for another event is refused, naming the file and both IDs", () => {
    const read = readTranscript({
      file: "hearing-2025011038.transcript.json",
      text: file([B]),
      eventId: "2025011099",
      turns: TURNS_OF_288741,
    });
    expect(read).toMatchObject({
      kind: "refused",
      reason: "event_id_mismatch",
      file: "hearing-2025011038.transcript.json",
      expected: "2025011099",
      found: "2025011038",
    });
    expect(read.kind === "refused" && read.message).toContain("hearing-2025011038.transcript.json");
    expect(read.kind === "refused" && read.message).toContain("2025011099");
    expect(read.kind === "refused" && read.message).toContain("2025011038");
  });

  test("the same event ID is read", () => {
    expect(attached(file([B]), TURNS_OF_288741).eventId).toBe("2025011038");
  });
});

describe("faster-whisper's quality fields are kept (format version 1)", () => {
  const quality = { avg_logprob: -0.25, compression_ratio: 1.5, no_speech_prob: 0.125, temperature: 0 };

  test("a segment's avg_logprob, compression_ratio, no_speech_prob and temperature are carried on each passage of it", () => {
    const { passages } = attached(file([{ ...A, quality }]), TURNS_OF_288741);
    // A is split in two; both pieces are of the one segment and say its numbers.
    expect(passages).toHaveLength(2);
    for (const p of passages) {
      expect(p.segmentQuality).toEqual({
        avgLogprob: -0.25,
        compressionRatio: 1.5,
        noSpeechProb: 0.125,
        temperature: 0,
      });
    }
  });

  test("a segment that gives none carries none, and one that gives some carries those", () => {
    expect(attached(file([B]), TURNS_OF_288741).passages[0]?.segmentQuality).toEqual({});
    const some = attached(file([{ ...B, quality: { avg_logprob: -1 } }]), TURNS_OF_288741);
    expect(some.passages[0]?.segmentQuality).toEqual({ avgLogprob: -1 });
  });

  test("id, seek and tokens are not part of the format, and a probability outside 0 to 1 is refused", () => {
    for (const key of ["id", "seek", "tokens"]) {
      const parsed = JSON.parse(file([B])) as { segments: Record<string, unknown>[] };
      (parsed.segments[0] as Record<string, unknown>)[key] = key === "tokens" ? [1, 2] : 7;
      const read = readTranscript({ file: "q.json", text: JSON.stringify(parsed), eventId: EVENT_ID, turns: null });
      expect(read).toMatchObject({ kind: "refused", reason: "not_valid", file: "q.json" });
      expect(read.kind === "refused" && read.message).toContain(key);
    }
    const read = readTranscript({
      file: "q.json",
      text: file([{ ...B, quality: { no_speech_prob: 1.5 } }]),
      eventId: EVENT_ID,
      turns: null,
    });
    expect(read).toMatchObject({ kind: "refused", reason: "not_valid" });
    expect(read.kind === "refused" && read.message).toContain("segments.0.no_speech_prob");
  });

  test("the format version is a whole number: 1.5 is an unknown version, not version 1", () => {
    const read = readTranscript({
      file: "q.json",
      text: file([B], { format_version: 1.5 }),
      eventId: EVENT_ID,
      turns: null,
    });
    expect(read).toMatchObject({ kind: "refused", reason: "unknown_version", version: 1.5 });
  });
});

describe("a file that is refused", () => {
  test("an unknown version names the file and the version, and reads nothing else", () => {
    const text = file([A], { format_version: 2, anything: "a later format may change every field" });
    const read = readTranscript({
      file: "hearing-2025011038.transcript.json",
      text,
      eventId: EVENT_ID,
      turns: TURNS_OF_288741,
    });
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
    const read = readTranscript({ file: "x.json", text, eventId: EVENT_ID, turns: null });
    expect(read).toMatchObject({ kind: "refused", reason: "unknown_version", file: "x.json", version: "one" });
  });

  test("a file with no version, or that is not JSON, is refused as not valid and names the file", () => {
    const noVersion = readTranscript({
      file: "y.json",
      text: JSON.stringify({ event_id: "1" }),
      eventId: EVENT_ID,
      turns: null,
    });
    expect(noVersion).toMatchObject({ kind: "refused", reason: "not_valid", file: "y.json" });
    const notJson = readTranscript({ file: "z.json", text: "{ not json", eventId: EVENT_ID, turns: null });
    expect(notJson).toMatchObject({ kind: "refused", reason: "not_valid", file: "z.json" });
  });

  test("a version-1 file that breaks the format is refused with the file, and says where", () => {
    const parsed = JSON.parse(file([A])) as { audio: { sha256?: string } };
    delete parsed.audio.sha256;
    const read = readTranscript({ file: "w.json", text: JSON.stringify(parsed), eventId: EVENT_ID, turns: null });
    expect(read).toMatchObject({ kind: "refused", reason: "not_valid", file: "w.json" });
    expect(read.kind === "refused" && read.message).toContain("w.json");
    expect(read.kind === "refused" && read.message).toContain("audio.sha256");
  });

  test("a word that ends before it starts is refused", () => {
    const bad: Seg = { start: 1, end: 2, text: " x", words: [[" x", 2, 1]] };
    const read = readTranscript({ file: "v.json", text: file([bad]), eventId: EVENT_ID, turns: null });
    expect(read).toMatchObject({ kind: "refused", reason: "not_valid", file: "v.json" });
  });
});
