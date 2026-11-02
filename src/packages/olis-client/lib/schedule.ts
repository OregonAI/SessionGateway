// The two sets the schedule reads (ticket #67, ADR-0042): the floor convenings (ConveneTimes) and the Session's own row
// (LegislativeSessions), whose BeginDate and EndDate say when the Session is in progress. A full pull reads both whole.
import { z } from "zod";
import type { Convening, SessionDates } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import { feedChamber } from "./chamber.ts";
import { readSessionRows } from "./feed.ts";
import type { OlisClientOptions, PullRead } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

// ConveneTimes is keyed by SessionKey, SessionDate and Chamber; its one other property is RecessUntil
// (docs/research/olis-odata.md section 2). SessionDate is a date and time, the time the chamber convenes.
const conveneTimeRow = z.looseObject({
  SessionKey: z.string(),
  SessionDate: feedTimestamp,
  Chamber: feedChamber,
});

/** Every floor convening of the Session. */
export async function readConvenings(
  options: OlisClientOptions,
  session: SessionKey,
  read: PullRead,
  signal: AbortSignal,
): Promise<Convening[]> {
  const rows = await readSessionRows(options, "ConveneTimes", session, conveneTimeRow, signal, read);
  return rows.map((row) => ({ session, at: row.SessionDate, chamber: row.Chamber }));
}

// EndDate is null on many Sessions, 2025R1's included (olis-odata.md section 3).
const legislativeSessionRow = z.looseObject({
  SessionKey: z.string(),
  BeginDate: feedTimestamp,
  EndDate: feedTimestamp.nullable(),
});

/** The date part of a Timestamp with a Pacific offset: the Pacific date. */
function dateOf(at: string): string {
  return at.slice(0, 10);
}

/** The Session's own LegislativeSessions row, or undefined when the feed has none for it. */
export async function readSessionDates(
  options: OlisClientOptions,
  session: SessionKey,
  read: PullRead,
  signal: AbortSignal,
): Promise<SessionDates | undefined> {
  const rows = await readSessionRows(options, "LegislativeSessions", session, legislativeSessionRow, signal, read);
  const row = rows[0];
  if (row === undefined) return undefined;
  return { session, begin: dateOf(row.BeginDate), end: row.EndDate === null ? null : dateOf(row.EndDate) };
}
