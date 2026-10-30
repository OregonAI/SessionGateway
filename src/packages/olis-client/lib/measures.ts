import { z } from "zod";
import type { Measure, SessionKey } from "#/packages/domain/index.ts";
import { readPacificLocal } from "#/packages/time/pacific.ts";
import { readEntitySet } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";

const measureRow = z.looseObject({
  SessionKey: z.string(),
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  CatchLine: z.string().nullable(),
  CreatedDate: z.string(),
  ModifiedDate: z.string().nullable(),
});

export async function readMeasureRows(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<Measure[]> {
  const rows = await readEntitySet(options, "Measures", `SessionKey eq '${session}'`, measureRow, signal);
  // The feed is asked for one Session, but a row of another one is never taken for it: measure
  // numbers restart every Session, so SB 69 of one Session is not SB 69 of another.
  return rows
    .filter((row) => row.SessionKey === session)
    .map((row) => ({
      session,
      prefix: row.MeasurePrefix,
      number: row.MeasureNumber,
      catchline: row.CatchLine,
      createdAt: readPacificLocal(row.CreatedDate),
      modifiedAt: row.ModifiedDate === null ? null : readPacificLocal(row.ModifiedDate),
    }));
}
