// The staleness block of an answer: the staleness warning (ticket #17, ADR-0039), which says when the index's latest
// update is too old for the rhythm the deployment configured, or, for a deployment that runs no worker, the static-copy
// note (ticket #119, ADR-0057). The warning's rule is `stalenessAt` in the ingest package, which the worker's schedule
// shares; this reads what it needs from the index and words the result.
import type { ServerConfig } from "#/packages/config/index.ts";
import type { IndexReader } from "#/packages/database/reader.ts";
import { sessionScheduleOf, stalenessAt, type Staleness } from "#/packages/ingest/schedule.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";

/**
 * The block of text to add to an answer. With `INGEST_WORKER=off` it is the static-copy note, always (an index with a
 * full pull); otherwise it is the staleness warning, or undefined when the index is fresh enough. `latestUpdate` is the
 * index's As of, which the caller has read for the call: the warning speaks of the same time the answer carries.
 * `readsLiveStatus` is true for the tool whose answer holds a live_status read from OLIS (get_measure); its note
 * says so (ADR-0057).
 */
export function stalenessBlock(
  reader: IndexReader,
  config: ServerConfig,
  clock: Clock,
  latestUpdate: Timestamp,
  readsLiveStatus: boolean,
): string | undefined {
  const lastFullPull = reader.lastFullPull(config.session);
  if (lastFullPull === undefined) return undefined;
  // No worker runs (ADR-0057): the index is a static copy, which is true however long ago the pull was, so nothing is
  // "missed". The time is the last full pull's, read from the database for this call.
  if (config.worker === "off") return staticCopyNote(lastFullPull, readsLiveStatus);
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

function staticCopyNote(lastFullPull: Timestamp, readsLiveStatus: boolean): string {
  const note = `Note: this index is a static copy, as of its last full pull at ${lastFullPull}. No worker updates it, so changes the Legislature has made since then are not in it`;
  return readsLiveStatus
    ? `${note}, except get_measure's live_status, which is read from OLIS when you ask.`
    : `${note}.`;
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
