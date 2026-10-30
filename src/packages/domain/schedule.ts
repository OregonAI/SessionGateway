// The glossary's schedule words as types: a committee's agenda item for a Measure, and the order a
// Measure's schedule is listed in.
import type { MeasureKey } from "./index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * One item on a committee's agenda for a meeting, about a Measure: the feed's CommitteeAgendaItems row.
 * A Measure's schedule is its items for meetings at or after a given time.
 */
export type AgendaItem = {
  /** The feed's `CommitteeAgendaItemId`. */
  id: number;
  measure: MeasureKey;
  /** The committee's code. The feed's property for it is `CommitteCode`, with one `e` missing. */
  committeeCode: string;
  /** When the committee meets, in Pacific time with its offset. */
  meetingDate: Timestamp;
  /** The kind of meeting as the feed words it, such as "Public Hearing" or "Work Session". */
  meetingType: string;
};

/** Orders a schedule soonest first: by when the committee meets, then by the feed's id. */
export function compareAgendaItems(a: AgendaItem, b: AgendaItem): number {
  if (a.meetingDate !== b.meetingDate) return a.meetingDate < b.meetingDate ? -1 : 1;
  return a.id - b.id;
}
