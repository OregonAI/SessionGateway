// The staleness warning (ticket #17, ADR-0039): every answer says when the index's latest update is too old for the
// rhythm the deployment configured. The rule is `stalenessAt` in the ingest package, which the worker's schedule
// shares; this reads what it needs from the index and words the result.
import type { ServerConfig } from "#/packages/config/index.ts";
import type { IndexReader } from "#/packages/database/reader.ts";
import { sessionScheduleOf, stalenessAt, type Staleness } from "#/packages/ingest/schedule.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";

/**
 * The warning to add to an answer, or undefined when the index is fresh enough. `latestUpdate` is the index's As of,
 * which the caller has read for the call: the warning speaks of the same time the answer carries.
 */
export function stalenessWarning(
  reader: IndexReader,
  config: ServerConfig,
  clock: Clock,
  latestUpdate: Timestamp,
): string | undefined {
  const lastFullPull = reader.lastFullPull(config.session);
  if (lastFullPull === undefined) return undefined;
  // No worker runs (ADR-0057): the index is a static copy, which is true however long ago the pull was, so nothing is
  // "missed". The time is the last full pull's, read from the database for this call.
  if (config.worker === "off") return staticCopyNote(lastFullPull);
  const now = formatPacific(clock.now());
  const staleness = stalenessAt({
    now,
    settings: { increments: config.increments, fullPull: config.fullPull },
    schedule: sessionScheduleOf({
      committeeMeetingDays: reader.meetingDays(config.session),
      conveneDays: reader.conveneDays(config.session),
      session: reader.sessionDates(config.session),
    }),
    latestUpdate,
    lastFullPull,
  });
  return staleness.stale ? warningOf(staleness) : undefined;
}

function staticCopyNote(lastFullPull: Timestamp): string {
  return `Note: this index is a static copy, as of its last full pull at ${lastFullPull}. No worker updates it, so changes the Legislature has made since then are not in it.`;
}

const LEAD = "Warning: this index may be out of date.";

function warningOf(staleness: Extract<Staleness, { stale: true }>): string {
  switch (staleness.mode) {
    case "15min":
      return `${LEAD} It was last updated at ${staleness.updatedAt}, more than two hours ago, and the worker updates it every 15 minutes during working hours (6 am to 10 pm Pacific on days the Session meets). Recent changes may be missing.`;
    case "daily":
      return `${LEAD} It was last updated at ${staleness.updatedAt}, before the night window that began at ${staleness.windowStart}: a nightly update was missed. Recent changes may be missing.`;
    case "off":
      return `${LEAD} Its last full pull was at ${staleness.updatedAt}, before the one scheduled for the night window that began at ${staleness.windowStart}: a scheduled full pull was missed. Recent changes may be missing.`;
    default:
      return staleness satisfies never;
  }
}
