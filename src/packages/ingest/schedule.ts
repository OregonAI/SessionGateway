// When the ingest worker runs (ticket #17, ADR-0039): a pure function of a Pacific time, the two settings and what the
// Session has scheduled. The worker's loop only calls it. It knows no clock and no database.
//
// The windows are the Legislature's Acceptable Use Agreement (ADR-0005): a full refresh only "after business hours
// between 5:00 pm-6:00 am Pacific Time", at most once a day. Everything is read off the wall clock in Pacific time,
// so a daylight-saving change moves no window: a night is 5 pm to 6 am on the clock, whether it is 12 or 14 hours long.
//
// A night belongs to the date it ends on. The full pull runs from midnight to 6 am of its date, so it can run only
// once on any calendar date, however late the worker started. The part of the night before midnight runs the night's
// increment (`daily`), on nights that are not a full-pull night.
import type { FullPullSetting, IncrementsSetting } from "#/packages/config/index.ts";
import { atPacificLocalTime, compareTimestamps, type Timestamp } from "#/packages/time/pacific.ts";

export type Settings = { increments: IncrementsSetting; fullPull: FullPullSetting };

/** What the Session has scheduled, as the index knows it. */
export type SessionSchedule = {
  /** Pacific dates (YYYY-MM-DD) with a committee meeting or a floor convening (ConveneTimes) scheduled. */
  meetingDays: ReadonlySet<string>;
  /** Whether the Session is in progress: then every weekday is a day the Session meets. */
  inProgress: boolean;
};

/**
 * What the Session has scheduled, from the days the index holds a committee meeting on (ADR-0039). ConveneTimes and the
 * Session's BeginDate and EndDate are not read yet, so no Session is "in progress" here. The worker and the server both
 * build the schedule this way, so the day the Session meets means the same to the schedule and to the staleness rule.
 */
export function sessionScheduleOf(meetingDays: readonly string[]): SessionSchedule {
  return { meetingDays: new Set(meetingDays), inProgress: false };
}

/**
 * What is due at a time. A `slot` names the occurrence, so a caller that asks again within it (a worker that wakes
 * every minute, or restarts) knows it has run: one night, one full pull, one quarter hour.
 */
export type Due = { kind: "nothing" } | { kind: "increment"; slot: string } | { kind: "full_pull"; slot: string };

export const NIGHT_STARTS_HOUR = 17;
export const NIGHT_ENDS_HOUR = 6;
export const WORKING_HOURS_END = 22;

/** The Pacific wall clock at the instant a Timestamp names, whatever offset it is written with. */
export function wallClockOf(at: Timestamp): Temporal.PlainDateTime {
  return Temporal.Instant.from(at).toZonedDateTimeISO("America/Los_Angeles").toPlainDateTime();
}

/**
 * The moment a full pull begun at this time must be over: 6 am of the date its night ends on (the Acceptable Use
 * Agreement allows a full refresh only until then). A pull begun before 5 pm, outside any night, has no deadline.
 */
export function fullPullDeadline(at: Timestamp): Timestamp | undefined {
  const night = nightEndingOn(wallClockOf(at));
  return night === undefined ? undefined : atPacificLocalTime(night.toPlainDateTime({ hour: NIGHT_ENDS_HOUR }));
}

/** The date a night ends on, or undefined when the time is in working hours (6 am to 5 pm). */
export function nightEndingOn(wallClock: Temporal.PlainDateTime): Temporal.PlainDate | undefined {
  if (wallClock.hour >= NIGHT_STARTS_HOUR) return wallClock.toPlainDate().add({ days: 1 });
  if (wallClock.hour < NIGHT_ENDS_HOUR) return wallClock.toPlainDate();
  return undefined;
}

/** Whether the full pull runs in the night that ends on this date: `weekly` on Sundays, `monthly` on the 1st. */
export function isFullPullDate(date: Temporal.PlainDate, setting: FullPullSetting): boolean {
  switch (setting) {
    case "nightly":
      return true;
    case "weekly":
      return date.dayOfWeek === 7;
    case "monthly":
      return date.day === 1;
    default:
      return setting satisfies never;
  }
}

/** Whether the Session meets on this date: a meeting or convening is scheduled, or it is a weekday of a Session in progress. */
export function sessionMeetsOn(date: Temporal.PlainDate, schedule: SessionSchedule): boolean {
  return schedule.meetingDays.has(date.toString()) || (schedule.inProgress && date.dayOfWeek <= 5);
}

export function whatRunsAt(at: Timestamp, settings: Settings, schedule: SessionSchedule): Due {
  const wallClock = wallClockOf(at);
  const date = wallClock.toPlainDate();
  const night = nightEndingOn(wallClock);
  if (night !== undefined && wallClock.hour < NIGHT_ENDS_HOUR && isFullPullDate(night, settings.fullPull)) {
    return { kind: "full_pull", slot: `full-pull-${night.toString()}` };
  }
  switch (settings.increments) {
    case "off":
      return { kind: "nothing" };
    case "daily":
      if (night === undefined || isFullPullDate(night, settings.fullPull)) return { kind: "nothing" };
      return { kind: "increment", slot: `night-${night.toString()}` };
    case "15min": {
      if (wallClock.hour < NIGHT_ENDS_HOUR || wallClock.hour >= WORKING_HOURS_END) return { kind: "nothing" };
      if (!sessionMeetsOn(date, schedule)) return { kind: "nothing" };
      const minute = String(Math.floor(wallClock.minute / 15) * 15).padStart(2, "0");
      return { kind: "increment", slot: `${date.toString()}T${String(wallClock.hour).padStart(2, "0")}:${minute}` };
    }
    default:
      return settings.increments satisfies never;
  }
}

/** The longest the index may go without an update during working hours, with `15min` increments. */
export const STALE_AFTER_HOURS = 2;

/** Whether the index is too old, by the rhythm configured, and what it should have been updated after. */
export type Staleness =
  | { stale: false }
  | {
      stale: true;
      mode: "15min";
      /** The start of the latest update. */
      updatedAt: Timestamp;
    }
  | {
      stale: true;
      mode: "daily" | "off";
      /** The start of the latest update (`daily`) or of the last full pull (`off`). */
      updatedAt: Timestamp;
      /** The start of the last night window that has closed: the update should be no older than this. */
      windowStart: Timestamp;
    };

/** The start of the night that ends on a date: 5 pm the day before, on the clock. */
function nightStart(endsOn: Temporal.PlainDate): Timestamp {
  return atPacificLocalTime(endsOn.subtract({ days: 1 }).toPlainDateTime({ hour: NIGHT_STARTS_HOUR }));
}

/** The date of the latest night that has closed by this wall-clock reading (its 6 am has passed), and for which `counts` is true. */
function lastClosedNight(
  wallClock: Temporal.PlainDateTime,
  counts: (endsOn: Temporal.PlainDate) => boolean,
): Temporal.PlainDate | undefined {
  let endsOn =
    wallClock.hour >= NIGHT_ENDS_HOUR ? wallClock.toPlainDate() : wallClock.toPlainDate().subtract({ days: 1 });
  // A monthly rhythm has at most 31 days between two of them; a year bounds the search for a setting that never runs.
  for (let back = 0; back < 366; back += 1) {
    if (counts(endsOn)) return endsOn;
    endsOn = endsOn.subtract({ days: 1 });
  }
  return undefined;
}

/**
 * Whether the index is too old, following the configured rhythm (ADR-0039):
 *  - `15min`: the latest update is over two hours old, during working hours (a day the Session meets, 6 am to 10 pm);
 *  - `daily`: the latest update is older than the start of the last night window that has closed (a night was missed);
 *  - `off`: the last full pull is older than the start of the last full-pull night that has closed (one was missed).
 * `latestUpdate` is the start of the latest full pull or increment, `lastFullPull` the start of the latest full pull.
 */
export function stalenessAt(input: {
  now: Timestamp;
  settings: Settings;
  schedule: SessionSchedule;
  latestUpdate: Timestamp;
  lastFullPull: Timestamp;
}): Staleness {
  const { now, settings, schedule, latestUpdate, lastFullPull } = input;
  const wallClock = wallClockOf(now);
  switch (settings.increments) {
    case "15min": {
      const working =
        wallClock.hour >= NIGHT_ENDS_HOUR &&
        wallClock.hour < WORKING_HOURS_END &&
        sessionMeetsOn(wallClock.toPlainDate(), schedule);
      const ageMilliseconds =
        Temporal.Instant.from(now).epochMilliseconds - Temporal.Instant.from(latestUpdate).epochMilliseconds;
      if (working && ageMilliseconds > STALE_AFTER_HOURS * 60 * 60 * 1000) {
        return { stale: true, mode: "15min", updatedAt: latestUpdate };
      }
      return { stale: false };
    }
    case "daily": {
      const night = lastClosedNight(wallClock, () => true);
      if (night === undefined) return { stale: false };
      const windowStart = nightStart(night);
      return compareTimestamps(latestUpdate, windowStart) < 0
        ? { stale: true, mode: "daily", updatedAt: latestUpdate, windowStart }
        : { stale: false };
    }
    case "off": {
      const night = lastClosedNight(wallClock, (endsOn) => isFullPullDate(endsOn, settings.fullPull));
      if (night === undefined) return { stale: false };
      const windowStart = nightStart(night);
      return compareTimestamps(lastFullPull, windowStart) < 0
        ? { stale: true, mode: "off", updatedAt: lastFullPull, windowStart }
        : { stale: false };
    }
    default:
      return settings.increments satisfies never;
  }
}
