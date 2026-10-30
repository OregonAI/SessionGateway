import { z } from "zod";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { AgendaItem } from "#/packages/domain/schedule.ts";
import { readSessionRows, type MeasureScope } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

const agendaItemRow = z.looseObject({
  CommitteeAgendaItemId: z.number().int(),
  SessionKey: z.string(),
  // The property name is misspelled in the feed (gotcha 1): CommitteCode.
  CommitteCode: z.string(),
  MeetingDate: feedTimestamp,
  // An item that is not about a Measure has neither (docs/research/olis-live.md §2); a read of one
  // Measure's items never gets one, and the rows the feed sends for another Measure are dropped.
  MeasurePrefix: z.string().nullable(),
  MeasureNumber: z.number().int().nullable(),
  MeetingType: z.string(),
});

/**
 * One Measure's agenda items, for the live lookup: only a read of one Measure is made, never a whole
 * Session's agendas. `scope.also` is what narrows them to the meetings still ahead.
 */
export async function readMeasureAgendaItems(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
  scope: MeasureScope,
): Promise<AgendaItem[]> {
  const rows = await readSessionRows(options, "CommitteeAgendaItems", session, agendaItemRow, signal, scope);
  return rows.map((row) => ({
    id: row.CommitteeAgendaItemId,
    measure: scope.measure,
    committeeCode: row.CommitteCode,
    meetingDate: row.MeetingDate,
    meetingType: row.MeetingType,
  }));
}
