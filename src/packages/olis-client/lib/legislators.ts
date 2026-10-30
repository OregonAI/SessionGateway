import { z } from "zod";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { LegislatorRow } from "#/packages/domain/legislators.ts";
import { readSessionRows } from "./feed.ts";
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
  const rows = await readSessionRows(options, "Legislators", session, legislatorRow, signal);
  return rows.map((row) => ({
    session,
    code: row.LegislatorCode,
    firstName: row.FirstName.trim(),
    lastName: row.LastName.trim(),
  }));
}
