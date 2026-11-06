// The transcript read (ticket #130, ADR-0054): a transcript file in, passages with the speaker turn each falls in out.
// It stores nothing (storing transcripts is ticket #134) and is pure.
import {
  driftOf,
  passagesOf,
  timelineOf,
  type Drift,
  type EntryAt,
  type Passage,
  type SegmentQuality,
  type TurnAt,
  type TranscriptWord,
} from "./lib/attach.ts";
import { knownFormatVersions, orderProblems, transcriptFileSchema, transcriptFormatVersion } from "./lib/format.ts";

export { transcriptFileSchema, transcriptFormatVersion };
export { driftThresholdSeconds } from "./lib/attach.ts";
export type { Drift, EntryAt, Passage, SegmentQuality, TranscriptWord, TurnAt };
export type { NotGivenReason, PassageSpeaker, ProceduralKind, TurnDrift } from "./lib/attach.ts";

export type TranscriptRead<T extends TurnAt, E extends EntryAt = EntryAt> =
  | {
      kind: "attached";
      file: string;
      formatVersion: number;
      eventId: string;
      audio: { sha256: string; durationSeconds: number };
      model: {
        id: string;
        settings: { modelName: string; device: string; computeType: string; language: string; beamSize: number };
      };
      madeAt: string;
      passages: Passage<T, E>[];
      /** How far the turns' seconds are from the segment starts; null when the Meeting has no speaker-turn index. */
      drift: Drift<T> | null;
    }
  /** The file's `format_version` is not one this service reads. `version` is as the file wrote it. */
  | { kind: "refused"; reason: "unknown_version"; file: string; version: unknown; message: string }
  /** The file is of another Meeting than the caller's: `expected` is the caller's event ID, `found` the file's. */
  | { kind: "refused"; reason: "event_id_mismatch"; file: string; expected: string; found: string; message: string }
  /** The file is not JSON, has no version, or breaks the format of its version. */
  | { kind: "refused"; reason: "not_valid"; file: string; message: string };

function refusedNotValid(file: string, detail: string): TranscriptRead<never, never> {
  return { kind: "refused", reason: "not_valid", file, message: `${file}: not a valid transcript file: ${detail}` };
}

/**
 * Reads a transcript file (`text` is its content, `file` its name for messages) for the Meeting `eventId`, against the
 * Meeting's speaker `turns`, or `null` when the Meeting has no speaker-turn index, and the log's other `entries`
 * (default none; pass the log's whole `entries` list, the read takes the kinds it uses and ignores the rest). A Meeting
 * with two Recording Logs is given the merged turns and entries, in media-clock order. Each word falls in the last turn
 * or entry that began at or before the word's start; a segment whose words fall in more than one is split at the word
 * where it changes.
 */
export function readTranscript<T extends TurnAt, E extends EntryAt = EntryAt>(input: {
  file: string;
  text: string;
  eventId: string;
  turns: readonly T[] | null;
  entries?: readonly E[];
}): TranscriptRead<T, E> {
  const { file } = input;
  let json: unknown;
  try {
    json = JSON.parse(input.text);
  } catch {
    return refusedNotValid(file, "it is not JSON");
  }
  if (json === null || typeof json !== "object" || Array.isArray(json) || !("format_version" in json)) {
    return refusedNotValid(file, "it has no format_version");
  }
  const version = json.format_version;
  if (!(knownFormatVersions as readonly unknown[]).includes(version)) {
    return {
      kind: "refused",
      reason: "unknown_version",
      file,
      version,
      message: `${file}: transcript format version ${JSON.stringify(version)} is not known (this service reads ${knownFormatVersions.join(", ")})`,
    };
  }
  const parsed = transcriptFileSchema.safeParse(json);
  const problems = parsed.success
    ? orderProblems(parsed.data)
    : parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  if (!parsed.success || problems.length > 0) {
    return refusedNotValid(file, problems.map((p) => `${p.path}: ${p.message}`).join("; "));
  }
  const data = parsed.data;
  if (data.event_id !== input.eventId) {
    return {
      kind: "refused",
      reason: "event_id_mismatch",
      file,
      expected: input.eventId,
      found: data.event_id,
      message: `${file}: the file is of event ${JSON.stringify(data.event_id)}, not the Meeting's event ${JSON.stringify(input.eventId)}`,
    };
  }
  const timeline = input.turns === null ? null : timelineOf(input.turns, input.entries ?? []);
  return {
    kind: "attached",
    file,
    formatVersion: data.format_version,
    eventId: data.event_id,
    audio: { sha256: data.audio.sha256, durationSeconds: data.audio.duration_seconds },
    model: {
      id: data.model.id,
      settings: {
        modelName: data.model.settings.model_name,
        device: data.model.settings.device,
        computeType: data.model.settings.compute_type,
        language: data.model.settings.language,
        beamSize: data.model.settings.beam_size,
      },
    },
    madeAt: data.made_at,
    passages: data.segments.flatMap((segment) => passagesOf<T, E>(segment, timeline)),
    drift: input.turns === null ? null : driftOf(input.turns, data.segments),
  };
}

/**
 * Attaches passages that were read and stored before to a Meeting's turns and entries as they are now, by each passage's start
 * second: what the worker does when the turns changed and the transcript file is no longer in the folder (ticket #134, ADR-0055).
 * Only the words' seconds that the store keeps are known, so a passage goes whole to the turn or entry that began at or before
 * its start, as a segment with no word timing does; it is not split where a new turn begins inside it. `quality` is each
 * passage's own numbers, handed back unchanged. Pure.
 */
export function attachStoredPassages<T extends TurnAt, E extends EntryAt = EntryAt>(input: {
  turns: readonly T[];
  entries?: readonly E[];
  passages: readonly { startSeconds: number; endSeconds: number; text: string; quality: SegmentQuality }[];
}): Passage<T, E>[] {
  const timeline = timelineOf(input.turns, input.entries ?? []);
  return input.passages.flatMap((passage) =>
    passagesOf<T, E>(
      {
        start: passage.startSeconds,
        end: passage.endSeconds,
        text: passage.text,
        ...(passage.quality.avgLogprob === undefined ? {} : { avg_logprob: passage.quality.avgLogprob }),
        ...(passage.quality.compressionRatio === undefined
          ? {}
          : { compression_ratio: passage.quality.compressionRatio }),
        ...(passage.quality.noSpeechProb === undefined ? {} : { no_speech_prob: passage.quality.noSpeechProb }),
        ...(passage.quality.temperature === undefined ? {} : { temperature: passage.quality.temperature }),
        words: [],
      },
      timeline,
    ),
  );
}
