import { z } from "zod";
import type { HistoryAction, SessionKey } from "#/packages/domain/index.ts";
import { feedChamber } from "./chamber.ts";
import { readEntitySet } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

const historyRow = z.looseObject({
  SessionKey: z.string(),
  MeasureHistoryId: z.number().int(),
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  Chamber: feedChamber,
  ActionDate: feedTimestamp,
  ActionText: z.string(),
});

export async function readHistoryActionRows(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<HistoryAction[]> {
  const rows = await readEntitySet(options, "MeasureHistoryActions", `SessionKey eq '${session}'`, historyRow, signal);
  // A row of another Session is never taken for this one: measure numbers restart every Session.
  return rows
    .filter((row) => row.SessionKey === session)
    .map((row) => ({
      id: row.MeasureHistoryId,
      measure: { session, prefix: row.MeasurePrefix, number: row.MeasureNumber },
      chamber: row.Chamber,
      date: row.ActionDate,
      text: row.ActionText,
    }));
}
