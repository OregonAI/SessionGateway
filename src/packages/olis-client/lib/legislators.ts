import { z } from "zod";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { LegislatorRow } from "#/packages/domain/legislators.ts";
import { readEntitySet } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";

const legislatorRow = z.looseObject({
  SessionKey: z.string(),
  LegislatorCode: z.string(),
  FirstName: z.string(),
  LastName: z.string(),
});

export async function readLegislatorRows(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<LegislatorRow[]> {
  const rows = await readEntitySet(options, "Legislators", `SessionKey eq '${session}'`, legislatorRow, signal);
  // As with Measures, a row of another Session is never taken for this one: a Legislator Code can
  // name a different person in another Session.
  return rows
    .filter((row) => row.SessionKey === session)
    .map((row) => ({
      session,
      code: row.LegislatorCode,
      firstName: row.FirstName.trim(),
      lastName: row.LastName.trim(),
    }));
}
