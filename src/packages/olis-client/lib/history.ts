import { z } from "zod";
import type { HistoryAction, SessionKey } from "#/packages/domain/index.ts";
import { feedChamber } from "./chamber.ts";
import { readSessionRows, type RowSelection } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { createdAtOf, feedTimestamp } from "./timestamps.ts";

const historyRow = z.looseObject({
  SessionKey: z.string(),
  MeasureHistoryId: z.number().int(),
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  Chamber: feedChamber,
  ActionDate: feedTimestamp,
  ActionText: z.string(),
  CreatedDate: feedTimestamp.nullish(),
});

export async function readHistoryActionRows(
  options: OlisClientOptions,
  session: SessionKey,
  selection: RowSelection,
  signal: AbortSignal,
): Promise<HistoryAction[]> {
  const rows = await readSessionRows(options, "MeasureHistoryActions", session, historyRow, selection, signal);
  return rows.map((row) => ({
    id: row.MeasureHistoryId,
    measure: { session, prefix: row.MeasurePrefix, number: row.MeasureNumber },
    chamber: row.Chamber,
    date: row.ActionDate,
    text: row.ActionText,
    ...createdAtOf(row.CreatedDate),
  }));
}
