import type { ParseRecordingLogInput, RecordingLogParse } from "./lib/types.ts";

export type {
  OffsetSource,
  ParseRecordingLogInput,
  RecordingLogEntry,
  RecordingLogLink,
  RecordingLogParse,
  SpeakerTurn,
  TimedEntry,
  VoteEntry,
} from "./lib/types.ts";

/** Reads a Recording Log's text and link annotations into its event ID, speaker turns and other entries. Pure. */
export function parseRecordingLog(input: ParseRecordingLogInput): RecordingLogParse {
  void input;
  throw new Error("parseRecordingLog is not written yet");
}
