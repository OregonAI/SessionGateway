// MADE-UP machine-transcript files (ticket #134) for seam-1 tests of transcripts in the tools. Nothing here was said at
// any hearing: the words are invented, and they are timed to the real turns of a real fixture Recording Log. Every file
// is valid version-1 format (docs/schemas/transcript-v1.schema.json, ADR-0054), and its model id says it is made up, so
// a reader of the database can never take it for a transcription.
import { createHash } from "node:crypto";

/** One made-up word: the second it starts at, and its text as the model would write it (leading space included). */
export type MadeUpWord = { start: number; text: string };

/**
 * The words of `sentence`, one second apart from `start`, each lasting 0.5 s: word n starts at `start + n`. The first has
 * no leading space and the others do, as faster-whisper writes them.
 */
export function wordsFrom(start: number, sentence: string): MadeUpWord[] {
  return sentence.split(" ").map((text, n) => ({ start: start + n, text: n === 0 ? text : ` ${text}` }));
}

export type MadeUpSegment = {
  start: number;
  end: number;
  words: MadeUpWord[];
  /** faster-whisper's quality numbers, left out when a case does not need them. */
  avg_logprob?: number;
  no_speech_prob?: number;
};

export type MadeUpTranscriptOptions = {
  eventId: string;
  segments: MadeUpSegment[];
  /** The `format_version` the file claims: 1 unless a case makes a file of a version this service does not know. */
  formatVersion?: unknown;
  audioSeed?: string;
};

/** The text of a made-up transcript file, for the folder the worker is pointed at. */
export function madeUpTranscript(options: MadeUpTranscriptOptions): string {
  return `${JSON.stringify(
    {
      format_version: options.formatVersion ?? 1,
      event_id: options.eventId,
      audio: {
        sha256: createHash("sha256")
          .update(options.audioSeed ?? `MADE UP audio of ${options.eventId}`)
          .digest("hex"),
        duration_seconds: 5400,
      },
      model: {
        id: "MADE-UP test fixture, not a transcription of any recording",
        settings: { model_name: "made-up", device: "none", compute_type: "none", language: "en", beam_size: 1 },
      },
      made_at: "2026-11-05T12:00:00-08:00",
      segments: options.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.words.map((word) => word.text).join(""),
        ...(segment.avg_logprob === undefined ? {} : { avg_logprob: segment.avg_logprob }),
        ...(segment.no_speech_prob === undefined ? {} : { no_speech_prob: segment.no_speech_prob }),
        words: segment.words.map((word) => ({ start: word.start, end: word.start + 0.5, text: word.text })),
      })),
    },
    null,
    2,
  )}\n`;
}

/**
 * The made-up transcript of HALNRW's hearing of 2025-01-22 (Recording Log 288741, Invintus event 2025011038), timed to
 * that log's real lines. The seconds the words are timed to, and who the log says is speaking then:
 * - 0.5 and 1.5: before the first turn (Co-Chair Helm, 00:00:04 = 4 s): no one is given. 4.2 and 5.2: Helm's;
 * - 53 to 58: the motion (00:00:52 = 52 s) until the vote (00:01:09 = 69 s): the log's motion line;
 * - 164.5 to 168.5: Anna Glueder, LPRO Analyst (00:01:47 = 107 s to 169 s); 169.5 to 175.5: Kurt Williams (00:02:49 = 169 s);
 *   one segment (164.5 to 176) holds both, so the read splits it between 168.5 and 169.5;
 * - 1310 to 1315: Vice-Chair Finger McDonald (00:21:43 = 1303 s until the next turn, 00:22:38 = 1358 s);
 * - 4560 to 4564: Co-Chair Helm (01:15:49 = 4549 s) under "HB 3131 - Public Hearing" (01:15:48);
 * - 5352 to 5356: after "Meeting Adjourned" (01:29:10 = 5350 s).
 */
export const halnrwEventId = "2025011038";
export const halnrwSegments: MadeUpSegment[] = [
  { start: 0.5, end: 6, words: [...wordsFrom(0.5, "Okay then"), ...wordsFrom(4.2, "welcome everyone")] },
  { start: 53, end: 59, words: wordsFrom(53, "I move the marmalade amendment as printed") },
  {
    start: 164.5,
    end: 177,
    words: [
      ...wordsFrom(164.5, "that concludes the staff summary"),
      ...wordsFrom(169.5, "Good morning members the quokka laboratory tests samples"),
    ],
  },
  { start: 1310, end: 1316, words: wordsFrom(1310, "The platypus bill needs a hearing") },
  { start: 4560, end: 4565, words: wordsFrom(4560, "The petunia bill is open") },
  { start: 5352, end: 5357, words: wordsFrom(5352, "Thanks everyone gooseberry adjourned") },
];

/**
 * The 38 speaker turns of Recording Log 288741 (HALNRW 2025-01-22), as the log's own timecodes give them, in the order of the
 * log: the document itself (documents/committee-meeting-documents/288741.pdf as the pdf-text package extracts it).
 */
export const halnrwTurnTimecodes = [
  "00:00:04",
  "00:00:49",
  "00:01:38",
  "00:01:47",
  "00:02:49",
  "00:06:15",
  "00:08:44",
  "00:11:29",
  "00:12:05",
  "00:14:40",
  "00:16:57",
  "00:18:05",
  "00:20:14",
  "00:21:43",
  "00:22:38",
  "00:23:06",
  "00:24:04",
  "00:29:18",
  "00:33:21",
  "00:33:46",
  "00:36:37",
  "00:39:22",
  "00:40:31",
  "00:46:53",
  "00:49:33",
  "00:51:44",
  "00:53:00",
  "00:56:17",
  "01:00:38",
  "01:01:23",
  "01:05:09",
  "01:10:49",
  "01:14:42",
  "01:15:49",
  "01:16:09",
  "01:19:58",
  "01:20:56",
  "01:21:19",
];

const secondOfTimecode = (timecode: string): number => {
  const [hours, minutes, seconds] = timecode.split(":").map(Number);
  return (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
};

/** The motion at 00:00:52 and the vote at 00:01:09 fall inside the second turn, so no filler is put there. */
const turnWithNoFiller = 1;
/** The last turn, which runs until the meeting adjourns at 01:29:10 (5,350 s): the turn whose transcript is longer than a part. */
export const longTurn = halnrwTurnTimecodes.length - 1;
/** The filler sentences each ordinary turn gets at most, and the long turn gets. */
const sentencesOfOrdinaryTurn = 4;
const sentencesOfLongTurn = 150;
const adjournedAt = 5350;
/** A sentence is 12 words 0.25 s apart, and one starts every 3 s from the second after its turn begins. */
const wordsInSentence = 12;

/** One word of a filler sentence: `MADEUP-t05-s003-w07` is the 8th word of the 4th sentence of the 6th turn. */
const fillerWord = (turn: number, sentence: number, word: number): string =>
  `MADEUP-t${String(turn).padStart(2, "0")}-s${String(sentence).padStart(3, "0")}-w${String(word).padStart(2, "0")}`;

/** The text of filler sentence `sentence` of turn `turn` (counting from 0), as it is read back: twelve words with one space between. */
export function fillerSentence(turn: number, sentence: number): string {
  return Array.from({ length: wordsInSentence }, (_, word) => fillerWord(turn, sentence, word)).join(" ");
}

/**
 * How many filler sentences turn `turn` of log 288741 has: a sentence is kept only if its last word starts before the next turn
 * (or the adjournment), so no sentence is split between two speakers, and the second turn has none (see `turnWithNoFiller`).
 */
export function fillerSentenceCount(turn: number): number {
  if (turn === turnWithNoFiller) return 0;
  const start = secondOfTimecode(halnrwTurnTimecodes[turn] ?? "00:00:00");
  const end = turn === longTurn ? adjournedAt : secondOfTimecode(halnrwTurnTimecodes[turn + 1] ?? "00:00:00");
  const cap = turn === longTurn ? sentencesOfLongTurn : sentencesOfOrdinaryTurn;
  let count = 0;
  while (count < cap && start + 1 + 3 * count + 0.25 * (wordsInSentence - 1) < end) count += 1;
  return count;
}

/** The words that are no turn's in `longHalnrwSegments`, in the order of their seconds. */
export const longHalnrwOtherPassages = [
  "Okay then",
  "I move the marmalade amendment as printed",
  "Thanks everyone gooseberry adjourned",
];

/**
 * A MADE-UP transcript of the same hearing as halnrwSegments, long enough that it pages: every turn but the second has up to
 * four filler sentences ("MADEUP-t05-s003-w07..."), the last turn has 150 (about 36,000 characters, more than a part of 20,000),
 * and the words before the first turn, during the motion and after the adjournment are the three of `longHalnrwOtherPassages`.
 * A sentence of turn n is `fillerSentence(n, k)`: it is the one segment, so it is one passage, in the turn that begins before it.
 */
export function longHalnrwSegments(): MadeUpSegment[] {
  const segments: MadeUpSegment[] = [{ start: 0.5, end: 2, words: wordsFrom(0.5, "Okay then") }];
  segments.push({ start: 53, end: 59, words: wordsFrom(53, "I move the marmalade amendment as printed") });
  halnrwTurnTimecodes.forEach((timecode, turn) => {
    for (let sentence = 0; sentence < fillerSentenceCount(turn); sentence += 1) {
      const start = secondOfTimecode(timecode) + 1 + 3 * sentence;
      const words = Array.from({ length: wordsInSentence }, (_, word) => ({
        start: start + 0.25 * word,
        text: word === 0 ? fillerWord(turn, sentence, word) : ` ${fillerWord(turn, sentence, word)}`,
      }));
      segments.push({ start, end: start + 0.25 * wordsInSentence, words });
    }
  });
  segments.push({ start: 5352, end: 5357, words: wordsFrom(5352, "Thanks everyone gooseberry adjourned") });
  return segments.toSorted((a, b) => a.start - b.start);
}
