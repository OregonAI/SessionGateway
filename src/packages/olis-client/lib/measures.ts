import { z } from "zod";
import type { Measure, SessionKey } from "#/packages/domain/index.ts";
import { readSessionRows, type MeasureScope } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

const measureRow = z.looseObject({
  SessionKey: z.string(),
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  CatchLine: z.string().nullable(),
  CurrentLocation: z.string(),
  CurrentCommitteeCode: z.string().nullable(),
  // Every row of the cache has it, but a row without the property has no digest, not a broken one.
  MeasureSummary: z.string().nullish(),
  CreatedDate: feedTimestamp,
  ModifiedDate: feedTimestamp.nullable(),
});

export async function readMeasureRows(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
  scope?: MeasureScope,
): Promise<Measure[]> {
  const rows = await readSessionRows(options, "Measures", session, measureRow, signal, scope);
  return rows.map((row) => ({
    session,
    prefix: row.MeasurePrefix,
    number: row.MeasureNumber,
    catchline: row.CatchLine,
    location: { current: row.CurrentLocation, committeeCode: row.CurrentCommitteeCode },
    digest: row.MeasureSummary ?? null,
    createdAt: row.CreatedDate,
    modifiedAt: row.ModifiedDate,
  }));
}
