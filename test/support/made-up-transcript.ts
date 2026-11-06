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
