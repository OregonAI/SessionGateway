// What the index says of the runs so far and of the days the Session meets (ticket #17, ADR-0039). The reader (the
// server) and the writer (the worker's loop) read the same rows, so the queries are written once, here.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

const fullPullRow = z.object({ full_pull_as_of: z.string() });
const startedRow = z.object({ as_of: z.string() });
const dayRow = z.object({ day: z.string() });
const sessionDatesRow = z.object({ begin_date: z.string(), end_date: z.string().nullable() });

/** When the last complete full pull started, or undefined while there has been none. */
export function readFullPullAsOf(database: DatabaseSync, session: SessionKey): Timestamp | undefined {
  const row = database.prepare("SELECT full_pull_as_of FROM index_state WHERE session_key = ?").get(session);
  return row === undefined ? undefined : (fullPullRow.parse(row).full_pull_as_of as Timestamp);
}

/** When the last increment started, or undefined while there has been none. */
export function readIncrementAsOf(database: DatabaseSync, session: SessionKey): Timestamp | undefined {
  const row = database.prepare("SELECT as_of FROM increment_state WHERE session_key = ?").get(session);
  return row === undefined ? undefined : (startedRow.parse(row).as_of as Timestamp);
}

/** When the last full pull was begun, complete or not, or undefined while none has been (a pull refused for a short read counts). */
export function readFullPullAttempt(database: DatabaseSync, session: SessionKey): Timestamp | undefined {
  const row = database.prepare("SELECT as_of FROM full_pull_attempt WHERE session_key = ?").get(session);
  return row === undefined ? undefined : (startedRow.parse(row).as_of as Timestamp);
}

/** The Pacific dates (YYYY-MM-DD) of the Session's committee meetings the index holds: days the Session meets. */
export function readMeetingDays(database: DatabaseSync, session: SessionKey): string[] {
  return database
    .prepare("SELECT DISTINCT substr(at, 1, 10) AS day FROM meeting WHERE session_key = ? ORDER BY day")
    .all(session)
    .map((row) => dayRow.parse(row).day);
}

/** The Pacific dates (YYYY-MM-DD) of the Session's floor convenings (ConveneTimes) the index holds: days the Session meets. */
export function readConveneDays(database: DatabaseSync, session: SessionKey): string[] {
  return database
    .prepare("SELECT DISTINCT substr(at, 1, 10) AS day FROM convening WHERE session_key = ? ORDER BY day")
    .all(session)
    .map((row) => dayRow.parse(row).day);
}

/** The dates the Session begins and ends on (its LegislativeSessions row), or undefined while no full pull has read the row. */
export function readSessionDates(
  database: DatabaseSync,
  session: SessionKey,
): { begin: string; end: string | null } | undefined {
  const row = database.prepare("SELECT begin_date, end_date FROM session_dates WHERE session_key = ?").get(session);
  if (row === undefined) return undefined;
  const parsed = sessionDatesRow.parse(row);
  return { begin: parsed.begin_date, end: parsed.end_date };
}
