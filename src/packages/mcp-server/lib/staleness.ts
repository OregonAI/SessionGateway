// The staleness warning (ticket #17, ADR-0039): every answer says when the index's latest update is too old for the
// rhythm the deployment configured. The rule is `stalenessAt` in the ingest package, which the worker's schedule
// shares; this reads what it needs from the index and words the result.
import type { ServerConfig } from "#/packages/config/index.ts";
import type { IndexReader } from "#/packages/database/reader.ts";
import { stalenessAt, type Staleness } from "#/packages/ingest/schedule.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific } from "#/packages/time/pacific.ts";

/** The warning to add to an answer, or undefined when the index is fresh enough (or has never been pulled). */
export function stalenessWarning(reader: IndexReader, config: ServerConfig, clock: Clock): string | undefined {
  const latestUpdate = reader.asOf(config.session);
  const lastFullPull = reader.lastFullPull(config.session);
  if (latestUpdate === undefined || lastFullPull === undefined) return undefined;
  const staleness = stalenessAt({
    now: formatPacific(clock.now()),
    settings: { increments: config.increments, fullPull: config.fullPull },
    schedule: { meetingDays: new Set(reader.meetingDays(config.session)), inProgress: false },
    latestUpdate,
    lastFullPull,
  });
  return staleness.stale ? warningOf(staleness) : undefined;
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
