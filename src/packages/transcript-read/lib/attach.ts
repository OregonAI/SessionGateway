// Attaches a transcript's words to the speaker turns and the log's other entries they fall in, and measures the drift
// between the turns and the transcript's segments (ADR-0054).
import type { TimedEntry, VoteEntry } from "#/packages/recording-log/index.ts";
import type { transcriptFileSchema } from "./format.ts";
import type { z } from "zod";

export type TranscriptWord = { text: string; start: number; end: number; probability?: number };

/** A turn of the Meeting: anything with the second its speaker began on the media clock. */
export type TurnAt = { offsetSeconds: number };

/** A line of the log that is not a speaker: anything with a `kind` and the second it was logged on the media clock. */
export type EntryAt = { kind: string; offsetSeconds: number };

/**
 * The kinds of the recording-log package's entries that the read uses: its TimedEntry kinds other than the call to
 * order, and its VoteEntry. Any other kind (the call to order, an agenda item) is not read.
 */
export type ProceduralKind = Exclude<TimedEntry["kind"], "call-to-order"> | VoteEntry["kind"];

const entryKinds: ReadonlySet<string> = new Set<ProceduralKind>([
  "recess",
  "reconvene",
  "motion",
  "motion-result",
  "vote",
  "roll-call",
  "adjournment",
]);

/** Why no speaker is given, when the log says nobody was speaking as a member. Absent before the first turn and after a reconvene. */
export type NotGivenReason = "during_recess" | "after_adjournment";

export type SpeakerNotGiven = { kind: "not_given"; label: "speaker not given"; reason?: NotGivenReason };

export const speakerNotGiven: SpeakerNotGiven = { kind: "not_given", label: "speaker not given" };

export type PassageSpeaker<T, E> =
  /** `turnIndex` is the turn's position in the array the caller passed, and `turn` is the caller's own value. */
  | { kind: "turn"; turnIndex: number; turn: T }
  /** Words during a motion, its result, a vote or a roll call: `entryIndex` is the entry's position in the caller's array. */
  | { kind: "entry"; entryIndex: number; entry: E }
  | SpeakerNotGiven;

/** What faster-whisper said of the segment a passage was cut from; only the numbers the file gives. */
export type SegmentQuality = {
  avgLogprob?: number;
  compressionRatio?: number;
  noSpeechProb?: number;
  temperature?: number;
};

export type Passage<T, E = EntryAt> = {
  startSeconds: number;
  endSeconds: number;
  text: string;
  words: TranscriptWord[];
  speaker: PassageSpeaker<T, E>;
  /** The numbers of the whole segment the passage is of (a split segment's pieces all carry its numbers). */
  segmentQuality: SegmentQuality;
};

/** A turn is flagged when its second is more than this far from the nearest segment start; so is the Meeting by its median. */
export const driftThresholdSeconds = 10;

export type TurnDrift<T> = {
  /** The turn's position in the array the caller passed. */
  turnIndex: number;
  /** The caller's own value. */
  turn: T;
  offsetSeconds: number;
  /** The distance to the nearest segment start; null when the transcript has no segments. */
  driftSeconds: number | null;
};

export type Drift<T> = {
  thresholdSeconds: number;
  /** Every turn, in the order the caller gave them. */
  turns: TurnDrift<T>[];
  /** The turns over the threshold (or with no segment to measure against), in the caller's order. */
  flagged: TurnDrift<T>[];
  /** The median of the turns' drifts; null when there are no turns or no segments. */
  medianSeconds: number | null;
  /** The largest of the turns' drifts; null when there are no turns or no segments. */
  maxSeconds: number | null;
  /** True when the median is over the threshold, or when there are turns and no segments to measure against. */
  meetingFlagged: boolean;
};

type Segment = z.infer<typeof transcriptFileSchema>["segments"][number];

function wordOf(w: Segment["words"][number]): TranscriptWord {
  return w.probability === undefined
    ? { text: w.text, start: w.start, end: w.end }
    : { text: w.text, start: w.start, end: w.end, probability: w.probability };
}

function qualityOf(segment: Segment): SegmentQuality {
  const quality: SegmentQuality = {};
  if (segment.avg_logprob !== undefined) quality.avgLogprob = segment.avg_logprob;
  if (segment.compression_ratio !== undefined) quality.compressionRatio = segment.compression_ratio;
  if (segment.no_speech_prob !== undefined) quality.noSpeechProb = segment.no_speech_prob;
  if (segment.temperature !== undefined) quality.temperature = segment.temperature;
  return quality;
}

/** One moment of the log on the timeline, with who or what the words after it belong to until the next moment. */
type Moment<T, E> = { second: number; rank: number; position: number; speaker: PassageSpeaker<T, E> };

/**
 * The log's turns and procedural entries as one timeline, sorted by second. At the same second a speaker's turn comes
 * after (so wins over) an entry, and moments of one kind keep the caller's order, the later winning.
 */
export type Timeline<T, E> = readonly Moment<T, E>[];

export function timelineOf<T extends TurnAt, E extends EntryAt>(
  turns: readonly T[],
  entries: readonly E[],
): Timeline<T, E> {
  const moments: Moment<T, E>[] = [];
  entries.forEach((entry, entryIndex) => {
    if (!entryKinds.has(entry.kind)) return;
    const kind = entry.kind as ProceduralKind;
    const speaker: PassageSpeaker<T, E> =
      kind === "recess"
        ? { ...speakerNotGiven, reason: "during_recess" }
        : kind === "adjournment"
          ? { ...speakerNotGiven, reason: "after_adjournment" }
          : kind === "reconvene"
            ? speakerNotGiven
            : { kind: "entry", entryIndex, entry };
    moments.push({ second: entry.offsetSeconds, rank: 0, position: entryIndex, speaker });
  });
  turns.forEach((turn, turnIndex) => {
    moments.push({
      second: turn.offsetSeconds,
      rank: 1,
      position: turnIndex,
      speaker: { kind: "turn", turnIndex, turn },
    });
  });
  return moments.toSorted((a, b) => a.second - b.second || a.rank - b.rank || a.position - b.position);
}

/** The index of the last moment at or before the second, or -1. */
function momentAt(timeline: Timeline<unknown, unknown>, second: number): number {
  let low = 0;
  let high = timeline.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((timeline[mid] as { second: number }).second <= second) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

/**
 * One segment as passages: whole when its words share a moment of the timeline (or there is no log), split at each word
 * where the moment changes. A word belongs to the last moment at or before its start.
 */
export function passagesOf<T extends TurnAt, E extends EntryAt>(
  segment: Segment,
  timeline: Timeline<T, E> | null,
): Passage<T, E>[] {
  const segmentQuality = qualityOf(segment);
  const whole = (speaker: PassageSpeaker<T, E>): Passage<T, E> => ({
    startSeconds: segment.start,
    endSeconds: segment.end,
    text: segment.text.trim(),
    words: segment.words.map(wordOf),
    speaker,
    segmentQuality,
  });
  const speakerAt = (index: number): PassageSpeaker<T, E> =>
    (timeline as Timeline<T, E>)[index]?.speaker ?? speakerNotGiven;
  if (timeline === null) return [whole(speakerNotGiven)];
  if (segment.words.length === 0) return [whole(speakerAt(momentAt(timeline, segment.start)))];
  const groups: { index: number; words: Segment["words"] }[] = [];
  for (const w of segment.words) {
    const index = momentAt(timeline, w.start);
    const last = groups.at(-1);
    if (last !== undefined && last.index === index) last.words.push(w);
    else groups.push({ index, words: [w] });
  }
  if (groups.length === 1) return [whole(speakerAt((groups[0] as { index: number }).index))];
  return groups.map(({ index, words }) => ({
    startSeconds: (words[0] as Segment["words"][number]).start,
    endSeconds: (words.at(-1) as Segment["words"][number]).end,
    text: words
      .map((w) => w.text)
      .join("")
      .trim(),
    words: words.map(wordOf),
    speaker: speakerAt(index),
    segmentQuality,
  }));
}

function medianOf(sorted: readonly number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Each turn's second against the nearest segment start of the transcript, in the order the caller gave the turns, with the
 * median and the maximum over the Meeting. The Meeting is flagged when the median is over the threshold.
 */
export function driftOf<T extends TurnAt>(turns: readonly T[], segments: readonly Segment[]): Drift<T> {
  const starts = segments.map((s) => s.start).toSorted((a, b) => a - b);
  const measured = turns.map((turn, turnIndex): TurnDrift<T> => {
    const t = turn.offsetSeconds;
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((starts[mid] as number) < t) low = mid + 1;
      else high = mid;
    }
    const near = [starts[low - 1], starts[low]].filter((b): b is number => b !== undefined);
    const driftSeconds = near.length === 0 ? null : Math.min(...near.map((b) => Math.abs(t - b)));
    return { turnIndex, turn, offsetSeconds: t, driftSeconds };
  });
  const drifts = measured.flatMap((m) => (m.driftSeconds === null ? [] : [m.driftSeconds])).toSorted((a, b) => a - b);
  const medianSeconds = drifts.length === 0 ? null : medianOf(drifts);
  return {
    thresholdSeconds: driftThresholdSeconds,
    turns: measured,
    flagged: measured.filter((m) => m.driftSeconds === null || m.driftSeconds > driftThresholdSeconds),
    medianSeconds,
    maxSeconds: drifts.length === 0 ? null : (drifts.at(-1) as number),
    meetingFlagged: medianSeconds === null ? measured.length > 0 : medianSeconds > driftThresholdSeconds,
  };
}
