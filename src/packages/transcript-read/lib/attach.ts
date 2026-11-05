// Attaches a transcript's words to the speaker turns they fall in, and measures the drift between them (ADR-0054).
import type { transcriptFileSchema } from "./format.ts";
import type { z } from "zod";

export type TranscriptWord = { text: string; start: number; end: number; probability?: number };

/** A turn of the Meeting: anything with the second its speaker began on the media clock. */
export type TurnAt = { offsetSeconds: number };

export const speakerNotGiven = { kind: "not_given", label: "speaker not given" } as const;

export type PassageSpeaker<T> = { kind: "turn"; turnIndex: number; turn: T } | typeof speakerNotGiven;

export type Passage<T> = {
  startSeconds: number;
  endSeconds: number;
  text: string;
  words: TranscriptWord[];
  speaker: PassageSpeaker<T>;
};

/** A turn is flagged when its second is more than this far from the nearest word boundary. */
export const driftThresholdSeconds = 10;

export type TurnDrift = { turnIndex: number; offsetSeconds: number; driftSeconds: number | null };
export type Drift = { thresholdSeconds: number; turns: TurnDrift[]; flagged: TurnDrift[] };

type Segment = z.infer<typeof transcriptFileSchema>["segments"][number];

function wordOf(w: Segment["words"][number]): TranscriptWord {
  return w.probability === undefined
    ? { text: w.text, start: w.start, end: w.end }
    : { text: w.text, start: w.start, end: w.end, probability: w.probability };
}

/** The index of the last turn that began at or before the second, or -1. `turns` are sorted by second. */
function turnAt(turns: readonly TurnAt[], second: number): number {
  let low = 0;
  let high = turns.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((turns[mid] as TurnAt).offsetSeconds <= second) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function speakerOf<T extends TurnAt>(turns: readonly T[], index: number): PassageSpeaker<T> {
  const turn = turns[index];
  return turn === undefined ? speakerNotGiven : { kind: "turn", turnIndex: index, turn };
}

/** One segment as passages: whole when its words share a turn (or there is no log), split at each word where the turn changes. */
export function passagesOf<T extends TurnAt>(segment: Segment, turns: readonly T[] | null): Passage<T>[] {
  const whole = (speaker: PassageSpeaker<T>): Passage<T> => ({
    startSeconds: segment.start,
    endSeconds: segment.end,
    text: segment.text.trim(),
    words: segment.words.map(wordOf),
    speaker,
  });
  if (turns === null) return [whole(speakerNotGiven)];
  if (segment.words.length === 0) return [whole(speakerOf(turns, turnAt(turns, segment.start)))];
  const groups: { index: number; words: Segment["words"] }[] = [];
  for (const w of segment.words) {
    const index = turnAt(turns, w.start);
    const last = groups.at(-1);
    if (last !== undefined && last.index === index) last.words.push(w);
    else groups.push({ index, words: [w] });
  }
  if (groups.length === 1) return [whole(speakerOf(turns, (groups[0] as { index: number }).index))];
  return groups.map(({ index, words }) => ({
    startSeconds: (words[0] as Segment["words"][number]).start,
    endSeconds: (words.at(-1) as Segment["words"][number]).end,
    text: words
      .map((w) => w.text)
      .join("")
      .trim(),
    words: words.map(wordOf),
    speaker: speakerOf(turns, index),
  }));
}

/** The distance from each turn's second to the nearest word start or end of the whole transcript; null when it has no words. */
export function driftOf(turns: readonly TurnAt[], segments: readonly Segment[]): Drift {
  const boundaries = segments.flatMap((s) => s.words.flatMap((w) => [w.start, w.end])).toSorted((a, b) => a - b);
  const measured = turns.map((turn, turnIndex): TurnDrift => {
    const t = turn.offsetSeconds;
    let low = 0;
    let high = boundaries.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((boundaries[mid] as number) < t) low = mid + 1;
      else high = mid;
    }
    const near = [boundaries[low - 1], boundaries[low]].filter((b): b is number => b !== undefined);
    const driftSeconds = near.length === 0 ? null : Math.min(...near.map((b) => Math.abs(t - b)));
    return { turnIndex, offsetSeconds: t, driftSeconds };
  });
  return {
    thresholdSeconds: driftThresholdSeconds,
    turns: measured,
    flagged: measured.filter((m) => m.driftSeconds === null || m.driftSeconds > driftThresholdSeconds),
  };
}
