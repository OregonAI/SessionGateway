import { readBlocks } from "./lib/blocks.ts";
import { classify } from "./lib/classify.ts";
import { eventIdsOf } from "./lib/event-id.ts";
import { offsetsOf } from "./lib/offsets.ts";
import {
  legislatorOfSpeaker as legislatorOf,
  measureOfAgendaItem as measureOf,
  playerLinkOf as playerLink,
  type CommitteeMemberName,
} from "./lib/turn-context.ts";
import type { ParseRecordingLogInput, RecordingLogLink, RecordingLogParse } from "./lib/types.ts";

export type {
  AgendaItemEntry,
  FeedAgendaItem,
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
  const offsets = offsetsOf(blocks, input.links);
  const { speakerTurns, entries } = classify(blocks, offsets, input.agendaItems ?? []);
  const pagesReadByTimecode = [
    ...new Set(blocks.filter((_, index) => offsets[index]?.offsetSource === "timecode").map((block) => block.page)),
  ].toSorted((a, b) => a - b);
  return { kind: "parsed", eventId, speakerTurns, entries, pagesReadByTimecode };
}

export type { CommitteeMemberName };

/**
 * The Legislator Code of the Legislator a speaker line names ("Co-Chair Helm", "Rep. B. Levy"), or null: among the
 * committee's `members` first, and when none fits among all the Session's `legislators` (owner decision B of ticket #126).
 * A title's chamber must agree with the code's, and the logged first name or initial must agree when given. Pure.
 */
export function legislatorOfSpeaker(
  speaker: string,
  members: readonly CommitteeMemberName[],
  legislators: readonly CommitteeMemberName[] = [],
): string | null {
  return legislatorOf(speaker, members, legislators);
}

/** The Measure an Agenda item line of the log begins with ("HB 2167 - Public Hearing"), or null. Pure. */
export function measureOfAgendaItem(text: string | null): { prefix: string; number: number } | null {
  return measureOf(text);
}

/** The official player at a second of the recording, built from the log's own player link for the event, or null. Pure. */
export function playerLinkOf(
  links: readonly RecordingLogLink[],
  eventId: string,
  offsetSeconds: number,
): string | null {
  return playerLink(links, eventId, offsetSeconds);
}
