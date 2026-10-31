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
import type { Timestamp } from "#/packages/time/pacific.ts";

export type Settings = { increments: IncrementsSetting; fullPull: FullPullSetting };

/** What the Session has scheduled, as the index knows it. */
export type SessionSchedule = {
  /** Pacific dates (YYYY-MM-DD) with a committee meeting or a floor convening (ConveneTimes) scheduled. */
  meetingDays: ReadonlySet<string>;
  /** Whether the Session is in progress: then every weekday is a day the Session meets. */
  inProgress: boolean;
};

/**
 * What is due at a time. A `slot` names the occurrence, so a caller that asks again within it (a worker that wakes
 * every minute, or restarts) knows it has run: one night, one full pull, one quarter hour.
 */
export type Due = { kind: "nothing" } | { kind: "increment"; slot: string } | { kind: "full_pull"; slot: string };

export const NIGHT_STARTS_HOUR = 17;
export const NIGHT_ENDS_HOUR = 6;
export const WORKING_HOURS_END = 22;

/** The Pacific wall clock a Timestamp reads, with its UTC offset left off. */
export function wallClockOf(at: Timestamp): Temporal.PlainDateTime {
  return Temporal.PlainDateTime.from(at.replace(/(?:Z|[+-]\d{2}:\d{2})$/, ""));
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
