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

/** Where a stretch of a log's text is: `text.slice(start, end)`, in UTF-16 code units. */
export type TextSpan = { start: number; end: number };

/**
 * Where each stored speaker turn's lines are in the log's text (ticket #127): the timecode line and the lines that wrap
 * from it, each with its line break, up to a line of the page's own (its compliance sentence, committee code, date and page
 * number). The turns are given as the index stores them, a timecode and the speaker as logged, in the order of the log; a
 * turn is the next block of the text with that timecode whose lines read as that speaker, so a line with the same timecode
 * before it (an Agenda item) is passed over. A turn the text does not hold has no span. Pure.
 */
export function speakerTurnSpans(
  text: string,
  turns: readonly { timecode: string; speaker: string }[],
): (TextSpan | null)[] {
  const blocks = readBlocks(text);
  let next = 0;
  return turns.map((turn) => {
    for (let index = next; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block === undefined || block.timecode !== turn.timecode || block.lines.join(" ").trim() !== turn.speaker) {
        continue;
      }
      next = index + 1;
      return { start: block.start, end: block.end };
    }
    return null;
  });
}

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
