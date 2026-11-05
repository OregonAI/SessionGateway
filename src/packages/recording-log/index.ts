import { readBlocks } from "./lib/blocks.ts";
import { classify } from "./lib/classify.ts";
import { eventIdsOf } from "./lib/event-id.ts";
import { offsetsOf } from "./lib/offsets.ts";
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
  const eventIds = eventIdsOf(input.links);
  const [eventId] = eventIds;
  if (eventId === undefined) return { kind: "no-event-id" };
  if (eventIds.length > 1) return { kind: "conflicting-event-ids", eventIds };
  const blocks = readBlocks(input.text);
  const { speakerTurns, entries } = classify(blocks, offsetsOf(blocks, input.links));
  return { kind: "parsed", eventId, speakerTurns, entries };
}
