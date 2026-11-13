import { readBlocks } from "./lib/blocks.ts";
import { classify } from "./lib/classify.ts";
import { eventIdsOf } from "./lib/event-id.ts";
import {
  headerNamesMeeting as namesMeeting,
  headerOf,
  type HeaderMeeting,
  type RecordingLogHeader,
} from "./lib/header.ts";
import { offsetsOf } from "./lib/offsets.ts";
import {
  legislatorOfSpeaker as legislatorOf,
  hearingKindOf as hearingKind,
  measureOfAgendaItem as measureOf,
  measuresOfAgendaItem as measuresOf,
  playerLinkOf as playerLink,
  type CommitteeMemberName,
} from "./lib/turn-context.ts";
import type {
  FeedAgendaItem,
  ParseRecordingLogInput,
  RecordingLogEntry,
  RecordingLogLink,
  RecordingLogParse,
} from "./lib/types.ts";

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

/**
 * The entries of a stored log's text that are not speaker turns (the call to order, Agenda items, motions, votes, recesses, the
 * adjournment), read from the text alone, so each entry's second is its timecode in hours, minutes and seconds
 * (`offsetSource` "timecode"). The worker keeps a log's text and its turns and not its link annotations, so a transcript
 * (ticket #134, ADR-0055) is read against these. `agendaItems` are the Meeting's, as for `parseRecordingLog`. Pure.
 */
export function entriesOfLogText(text: string, agendaItems: readonly FeedAgendaItem[] = []): RecordingLogEntry[] {
  const blocks = readBlocks(text);
  return classify(blocks, offsetsOf(blocks, []), agendaItems).entries;
}

export type { CommitteeMemberName, HeaderMeeting, RecordingLogHeader };

/**
 * The log's own header (ticket #177): the committee lines of its first page, joined by a space, and the time under its date
 * line, as printed and on a 24-hour clock. Null when the first page has no committee, date and time lines in that order. Pure.
 */
export function recordingLogHeaderOf(text: string): RecordingLogHeader | null {
  return headerOf(text);
}

/**
 * Whether a log's header names the Meeting it is filed under: the chamber the committee's code begins with, the committee's
 * name at the end of its committee lines ("... ON BEHAVIORAL HEALTH"), and the Meeting's start time. Pure.
 */
export function headerNamesMeeting(header: RecordingLogHeader, meeting: HeaderMeeting): boolean {
  return namesMeeting(header, meeting);
}

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

/**
 * The version of the reading of the Measures an Agenda item line names (ADR-0066). The worker records it with each log whose
 * items it reads (`storeItemMeasures`) and reads them again, from the stored item texts with no fetch, when the recorded version
 * is not this one. BUMP IT BY HAND in any change that would change what `measuresOfAgendaItem` gives for the same text, or what
 * the worker's loop in `ingest/index.ts` stores from it: a change to this function and what it calls in this package, and to
 * `measureIdOf` (`domain/index.ts`), which makes the stored id. Without the bump a stored database keeps the old Measures. A
 * change that leaves every stored result as it was needs none. A reading made before schema step 10 counts as version 0, so this
 * starts at 1.
 */
export const ITEM_MEASURES_READER_VERSION = 1;

/** The Measures an Agenda item line of the log begins with ("SB 1542 and SB 1543 - Public Hearing"), in order. Pure. */
export function measuresOfAgendaItem(text: string | null): { prefix: string; number: number }[] {
  return measuresOf(text);
}

/** "Public Hearing", "Work Session" or the line's own wording after its Measures: what kind of hearing an Agenda item is. Pure. */
export function hearingKindOf(text: string): string {
  return hearingKind(text);
}

/** The official player at a second of the recording, built from the log's own player link for the event, or null. Pure. */
export function playerLinkOf(
  links: readonly RecordingLogLink[],
  eventId: string,
  offsetSeconds: number,
): string | null {
  return playerLink(links, eventId, offsetSeconds);
}
