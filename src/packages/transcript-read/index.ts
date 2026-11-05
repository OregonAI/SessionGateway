// The transcript read (ticket #130, ADR-0054): a transcript file in, passages with the speaker turn each falls in out.
// It stores nothing (storing transcripts is ticket #134) and is pure.
import { driftOf, passagesOf, type Drift, type Passage, type TurnAt, type TranscriptWord } from "./lib/attach.ts";
import { knownFormatVersions, orderProblems, transcriptFileSchema, transcriptFormatVersion } from "./lib/format.ts";

export { transcriptFileSchema, transcriptFormatVersion };
export { driftThresholdSeconds } from "./lib/attach.ts";
export type { Drift, Passage, TranscriptWord, TurnAt };

export type TranscriptRead<T extends TurnAt> =
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
      passages: Passage<T>[];
      /** How far the turns' seconds are from the words; null when the Meeting has no speaker-turn index. */
      drift: Drift | null;
    }
  /** The file's `format_version` is not one this service reads. `version` is as the file wrote it. */
  | { kind: "refused"; reason: "unknown_version"; file: string; version: unknown; message: string }
  /** The file is not JSON, has no version, or breaks the format of its version. */
  | { kind: "refused"; reason: "not_valid"; file: string; message: string };

function refusedNotValid(file: string, detail: string): TranscriptRead<never> {
  return { kind: "refused", reason: "not_valid", file, message: `${file}: not a valid transcript file: ${detail}` };
}

/**
 * Reads a transcript file (`text` is its content, `file` its name for messages) against the Meeting's speaker `turns`,
 * or `null` when the Meeting has no speaker-turn index. Each word falls in the last turn that began at or before the
 * word's start; a segment whose words fall in more than one turn is split at the word where the turn changes.
 */
export function readTranscript<T extends TurnAt>(input: {
  file: string;
  text: string;
  turns: readonly T[] | null;
}): TranscriptRead<T> {
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
  const turns = input.turns === null ? null : input.turns.toSorted((a, b) => a.offsetSeconds - b.offsetSeconds);
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
    passages: data.segments.flatMap((segment) => passagesOf(segment, turns)),
    drift: turns === null ? null : driftOf(turns, data.segments),
  };
}
