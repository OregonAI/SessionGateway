import { z } from "zod";
import type { Measure, SessionKey } from "#/packages/domain/index.ts";
import { readSessionRows } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

const measureRow = z.looseObject({
  SessionKey: z.string(),
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  CatchLine: z.string().nullable(),
  CurrentLocation: z.string(),
  CurrentCommitteeCode: z.string().nullable(),
  CreatedDate: feedTimestamp,
  ModifiedDate: feedTimestamp.nullable(),
});

export async function readMeasureRows(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<Measure[]> {
  const rows = await readSessionRows(options, "Measures", session, measureRow, signal);
  return rows.map((row) => ({
    session,
    prefix: row.MeasurePrefix,
    number: row.MeasureNumber,
    catchline: row.CatchLine,
    location: { current: row.CurrentLocation, committeeCode: row.CurrentCommitteeCode },
    createdAt: row.CreatedDate,
    modifiedAt: row.ModifiedDate,
  }));
}
