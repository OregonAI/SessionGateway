// The schedule (ticket #17, ADR-0039): what runs at a Pacific time, given the two settings and what the Session has
// scheduled. It is the one test of the ticket outside seam 1, agreed by the owner on the ticket: a pure function, a
// table, one row for each window edge, setting value, full-pull night and other night, meeting day and day that is not,
// and for both daylight-saving changes.
//
// The expected values are written out from the rule, not computed: night windows run from 5 pm to 6 am Pacific; a
// night "belongs" to the date it ends on. Increments `15min` run 6 am to 10 pm on days the Session meets. The full
// pull runs from midnight to 6 am of its date: every date for `nightly`, Saturdays for `weekly`, the 1st for `monthly`.
// The calendar facts are the ones everybody can check: 2025-01-11 is a Saturday, 2025-01-12 and 2025-03-09 and
// 2025-11-02 are Sundays, 2025-04-01 is a Tuesday and 2025-01-08 a Wednesday. Daylight time began on Sunday 2025-03-09 (2 am became 3 am, UTC-8 to UTC-7)
// and ended on Sunday 2025-11-02 (2 am became 1 am, UTC-7 to UTC-8).
import { describe, expect, test } from "vitest";
import type { FullPullSetting, IncrementsSetting } from "#/packages/config/index.ts";
import { readTimestamp } from "#/packages/time/pacific.ts";
import { fullPullDeadline, whatRunsAt, type Due, type SessionSchedule } from "../schedule.ts";

const noMeetings: SessionSchedule = { meetingDays: new Set(), inProgress: false };
const meets = (...days: string[]): SessionSchedule => ({ meetingDays: new Set(days), inProgress: false });
const inProgress: SessionSchedule = { meetingDays: new Set(), inProgress: true };

const nothing: Due = { kind: "nothing" };
const increment = (slot: string): Due => ({ kind: "increment", slot });
const fullPull = (slot: string): Due => ({ kind: "full_pull", slot });

type Row = {
  name: string;
  at: string;
  increments: IncrementsSetting;
  fullPull: FullPullSetting;
  schedule?: SessionSchedule;
  expected: Due;
};

const rows: Row[] = [
  // daily, weekly (the defaults): one increment a night, 5 pm to 6 am, on nights the full pull does not run
  {
    name: "daily: 4:59 pm is before the night",
    at: "2025-01-06T16:59:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: nothing,
  },
  {
    name: "daily: 5:00 pm opens the night",
    at: "2025-01-06T17:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: increment("night-2025-01-07"),
  },
  {
    name: "daily: 11:59 pm is in it",
    at: "2025-01-06T23:59:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: increment("night-2025-01-07"),
  },
  {
    name: "daily: past midnight is the same night",
    at: "2025-01-07T00:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: increment("night-2025-01-07"),
  },
  {
    name: "daily: 5:59 am is still in it",
    at: "2025-01-07T05:59:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: increment("night-2025-01-07"),
  },
  {
    name: "daily: 6:00 am closes it",
    at: "2025-01-07T06:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: nothing,
  },
  {
    name: "daily: a meeting day's working hours run nothing",
    at: "2025-01-08T10:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: nothing,
  },
  {
    name: "daily, weekly: the evening before a full-pull night's morning runs no increment (Friday 5 pm)",
    at: "2025-01-10T17:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: nothing,
  },
  {
    name: "daily, weekly: 4:59 pm that Friday is before the night",
    at: "2025-01-10T16:59:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: nothing,
  },
  {
    name: "weekly: Saturday midnight starts the full pull",
    at: "2025-01-11T00:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: fullPull("full-pull-2025-01-11"),
  },
  {
    name: "weekly: 5:59 am Saturday is inside the window",
    at: "2025-01-11T05:59:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: fullPull("full-pull-2025-01-11"),
  },
  {
    name: "weekly: 6:00 am Saturday is outside it",
    at: "2025-01-11T06:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: nothing,
  },
  {
    name: "weekly: Saturday 5:00 pm opens an ordinary night",
    at: "2025-01-11T17:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: increment("night-2025-01-12"),
  },
  {
    name: "weekly: Sunday midnight is no longer a full-pull night",
    at: "2025-01-12T00:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: increment("night-2025-01-12"),
  },
  {
    name: "weekly: Sunday 5:59 am runs the night's increment, not a full pull",
    at: "2025-01-12T05:59:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: increment("night-2025-01-12"),
  },
  {
    name: "weekly: Monday 3 am is not a full-pull night",
    at: "2025-01-13T03:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: increment("night-2025-01-13"),
  },

  // off, nightly: no increment at all, the full pull every night
  {
    name: "off: a meeting day's 6:00 am runs nothing",
    at: "2025-01-08T06:00:00-08:00",
    increments: "off",
    fullPull: "nightly",
    schedule: meets("2025-01-08"),
    expected: nothing,
  },
  {
    name: "off: a meeting day at noon runs nothing",
    at: "2025-01-08T12:00:00-08:00",
    increments: "off",
    fullPull: "nightly",
    schedule: meets("2025-01-08"),
    expected: nothing,
  },
  {
    name: "off: 9:59 pm on a meeting day runs nothing",
    at: "2025-01-08T21:59:00-08:00",
    increments: "off",
    fullPull: "nightly",
    schedule: meets("2025-01-08"),
    expected: nothing,
  },
  {
    name: "off: 5:00 pm runs nothing",
    at: "2025-01-08T17:00:00-08:00",
    increments: "off",
    fullPull: "nightly",
    expected: nothing,
  },
  {
    name: "nightly: any date's small hours run the full pull",
    at: "2025-01-09T02:00:00-08:00",
    increments: "off",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-01-09"),
  },
  {
    name: "nightly: 5:59 am is the last minute",
    at: "2025-01-09T05:59:00-08:00",
    increments: "off",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-01-09"),
  },
  {
    name: "nightly: 6:00 am is out",
    at: "2025-01-09T06:00:00-08:00",
    increments: "off",
    fullPull: "nightly",
    expected: nothing,
  },
  {
    name: "off, weekly: a Tuesday night runs nothing",
    at: "2025-01-07T02:00:00-08:00",
    increments: "off",
    fullPull: "weekly",
    expected: nothing,
  },
  {
    name: "daily, nightly: every night is a full-pull night, so no night increment",
    at: "2025-01-08T17:00:00-08:00",
    increments: "daily",
    fullPull: "nightly",
    expected: nothing,
  },
  {
    name: "daily, nightly: the full pull runs",
    at: "2025-01-09T00:00:00-08:00",
    increments: "daily",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-01-09"),
  },

  // 15min: every 15 minutes, 6 am to 10 pm, on days the Session meets
  {
    name: "15min: 5:59 am on a meeting day is before the window",
    at: "2025-01-08T05:59:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: nothing,
  },
  {
    name: "15min: 6:00 am opens it",
    at: "2025-01-08T06:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: increment("2025-01-08T06:00"),
  },
  {
    name: "15min: 6:14 is in the same quarter hour",
    at: "2025-01-08T06:14:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: increment("2025-01-08T06:00"),
  },
  {
    name: "15min: 6:15 is the next",
    at: "2025-01-08T06:15:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: increment("2025-01-08T06:15"),
  },
  {
    name: "15min: 4:59 pm runs",
    at: "2025-01-08T16:59:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: increment("2025-01-08T16:45"),
  },
  {
    name: "15min: 5:00 pm runs (the night window does not stop it)",
    at: "2025-01-08T17:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: increment("2025-01-08T17:00"),
  },
  {
    name: "15min: 9:59 pm is the last quarter hour",
    at: "2025-01-08T21:59:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: increment("2025-01-08T21:45"),
  },
  {
    name: "15min: 10:00 pm closes it",
    at: "2025-01-08T22:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: nothing,
  },
  {
    name: "15min: a day the Session does not meet runs nothing",
    at: "2025-01-07T12:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: nothing,
  },
  {
    name: "15min: the night after a meeting day runs no increment",
    at: "2025-01-09T03:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: nothing,
  },
  {
    name: "15min, weekly: the full pull still runs Saturday morning",
    at: "2025-01-11T00:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-08"),
    expected: fullPull("full-pull-2025-01-11"),
  },
  {
    name: "15min, nightly: the full pull runs in the small hours",
    at: "2025-01-08T01:00:00-08:00",
    increments: "15min",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-01-08"),
  },
  {
    name: "15min: in progress, a Monday is a meeting day",
    at: "2025-01-06T12:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: inProgress,
    expected: increment("2025-01-06T12:00"),
  },
  {
    name: "15min: in progress, a Friday is one",
    at: "2025-01-10T12:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: inProgress,
    expected: increment("2025-01-10T12:00"),
  },
  {
    name: "15min: in progress, a Saturday is not",
    at: "2025-01-11T12:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: inProgress,
    expected: nothing,
  },
  {
    name: "15min: in progress, a Sunday is not",
    at: "2025-01-12T12:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: inProgress,
    expected: nothing,
  },
  {
    name: "15min: a Saturday with a committee meeting is a meeting day",
    at: "2025-01-11T12:00:00-08:00",
    increments: "15min",
    fullPull: "weekly",
    schedule: meets("2025-01-11"),
    expected: increment("2025-01-11T12:00"),
  },

  // monthly: the 1st
  {
    name: "monthly: the 1st's small hours run the full pull",
    at: "2025-04-01T00:00:00-07:00",
    increments: "daily",
    fullPull: "monthly",
    expected: fullPull("full-pull-2025-04-01"),
  },
  {
    name: "monthly: the 1st's 5:59 am is inside",
    at: "2025-04-01T05:59:00-07:00",
    increments: "daily",
    fullPull: "monthly",
    expected: fullPull("full-pull-2025-04-01"),
  },
  {
    name: "monthly: a Sunday is not the day",
    at: "2025-01-12T00:00:00-08:00",
    increments: "daily",
    fullPull: "monthly",
    expected: increment("night-2025-01-12"),
  },
  {
    name: "monthly: the evening of the last day is the full-pull night, so no increment",
    at: "2025-03-31T17:00:00-07:00",
    increments: "daily",
    fullPull: "monthly",
    expected: nothing,
  },
  {
    name: "monthly: the 1st at 5 pm opens an ordinary night",
    at: "2025-04-01T17:00:00-07:00",
    increments: "daily",
    fullPull: "monthly",
    expected: increment("night-2025-04-02"),
  },
  {
    name: "monthly: the 2nd at 3 am is the ordinary night",
    at: "2025-04-02T03:00:00-07:00",
    increments: "daily",
    fullPull: "monthly",
    expected: increment("night-2025-04-02"),
  },
  {
    name: "monthly: the middle of the month is not a full-pull night",
    at: "2025-04-15T00:00:00-07:00",
    increments: "off",
    fullPull: "monthly",
    expected: nothing,
  },

  // daylight time begins: Sunday 2025-03-09, 2 am does not exist
  {
    name: "spring forward, nightly: 1:59 am PST is in the full pull",
    at: "2025-03-09T01:59:00-08:00",
    increments: "daily",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-03-09"),
  },
  {
    name: "spring forward, nightly: 3:00 am PDT, the minute after, is in it",
    at: "2025-03-09T03:00:00-07:00",
    increments: "daily",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-03-09"),
  },
  {
    name: "spring forward, nightly: 5:59 am PDT is the last minute",
    at: "2025-03-09T05:59:00-07:00",
    increments: "daily",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-03-09"),
  },
  {
    name: "spring forward, nightly: 6:00 am PDT is out",
    at: "2025-03-09T06:00:00-07:00",
    increments: "daily",
    fullPull: "nightly",
    expected: nothing,
  },
  {
    name: "spring forward, nightly: the Saturday evening before is a full-pull night",
    at: "2025-03-08T17:00:00-08:00",
    increments: "daily",
    fullPull: "nightly",
    expected: nothing,
  },
  {
    name: "spring forward, monthly: the night's increment is one night across the change (5 pm PST)",
    at: "2025-03-08T17:00:00-08:00",
    increments: "daily",
    fullPull: "monthly",
    expected: increment("night-2025-03-09"),
  },
  {
    name: "spring forward, monthly: and the same night after it (3:00 am PDT)",
    at: "2025-03-09T03:00:00-07:00",
    increments: "daily",
    fullPull: "monthly",
    expected: increment("night-2025-03-09"),
  },
  {
    name: "spring forward, monthly: 5:59 am PDT is still it",
    at: "2025-03-09T05:59:00-07:00",
    increments: "daily",
    fullPull: "monthly",
    expected: increment("night-2025-03-09"),
  },
  {
    name: "spring forward, monthly: 6:00 am PDT is out",
    at: "2025-03-09T06:00:00-07:00",
    increments: "daily",
    fullPull: "monthly",
    expected: nothing,
  },
  {
    name: "spring forward, 15min: 5:59 am PDT is before the window",
    at: "2025-03-09T05:59:00-07:00",
    increments: "15min",
    fullPull: "monthly",
    schedule: meets("2025-03-09"),
    expected: nothing,
  },
  {
    name: "spring forward, 15min: 6:00 am PDT opens it",
    at: "2025-03-09T06:00:00-07:00",
    increments: "15min",
    fullPull: "monthly",
    schedule: meets("2025-03-09"),
    expected: increment("2025-03-09T06:00"),
  },

  // daylight time ends: Sunday 2025-11-02, 1 am to 2 am happens twice
  {
    name: "fall back, nightly: 1:30 am PDT, the first time, is in the full pull",
    at: "2025-11-02T01:30:00-07:00",
    increments: "daily",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-11-02"),
  },
  {
    name: "fall back, nightly: 1:30 am PST, the second time, is the same full pull",
    at: "2025-11-02T01:30:00-08:00",
    increments: "daily",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-11-02"),
  },
  {
    name: "fall back, nightly: 5:59 am PST is the last minute",
    at: "2025-11-02T05:59:00-08:00",
    increments: "daily",
    fullPull: "nightly",
    expected: fullPull("full-pull-2025-11-02"),
  },
  {
    name: "fall back, nightly: 6:00 am PST is out",
    at: "2025-11-02T06:00:00-08:00",
    increments: "daily",
    fullPull: "nightly",
    expected: nothing,
  },
  {
    name: "fall back, weekly: 5:00 pm PST opens the next ordinary night",
    at: "2025-11-02T17:00:00-08:00",
    increments: "daily",
    fullPull: "weekly",
    expected: increment("night-2025-11-03"),
  },
  {
    name: "fall back, monthly: the night's increment, 1:30 am PDT",
    at: "2025-11-02T01:30:00-07:00",
    increments: "daily",
    fullPull: "monthly",
    expected: increment("night-2025-11-02"),
  },
  {
    name: "fall back, monthly: and 1:30 am PST, an hour later, is the same night",
    at: "2025-11-02T01:30:00-08:00",
    increments: "daily",
    fullPull: "monthly",
    expected: increment("night-2025-11-02"),
  },
  {
    name: "fall back, monthly: 6:00 am PST is out",
    at: "2025-11-02T06:00:00-08:00",
    increments: "daily",
    fullPull: "monthly",
    expected: nothing,
  },
  {
    name: "fall back, 15min: 9:59 pm PST is the last quarter hour",
    at: "2025-11-02T21:59:00-08:00",
    increments: "15min",
    fullPull: "monthly",
    schedule: meets("2025-11-02"),
    expected: increment("2025-11-02T21:45"),
  },
  {
    name: "fall back, 15min: 10:00 pm PST closes the window",
    at: "2025-11-02T22:00:00-08:00",
    increments: "15min",
    fullPull: "monthly",
    schedule: meets("2025-11-02"),
    expected: nothing,
  },
];

describe("what runs at a Pacific time", () => {
  test.for(rows)("$name", ({ at, increments, fullPull: fullPullSetting, schedule, expected }) => {
    const timestamp = readTimestamp(at);
    if (timestamp === undefined) throw new Error(`The row's time ${at} is not a time`);

    expect(whatRunsAt(timestamp, { increments, fullPull: fullPullSetting }, schedule ?? noMeetings)).toEqual(expected);
  });
});

// The moment a full pull must be over: 6 am of the date its night ends on, on the clock. Written out from the rule.
test.for([
  { name: "just after midnight", at: "2025-01-19T00:00:00-08:00", expected: "2025-01-19T06:00:00-08:00" },
  {
    name: "5:59 am, a minute before the window closes",
    at: "2025-01-19T05:59:00-08:00",
    expected: "2025-01-19T06:00:00-08:00",
  },
  { name: "6:00 am, the window has closed", at: "2025-01-19T06:00:00-08:00", expected: undefined },
  { name: "4:59 pm, before the window opens", at: "2025-01-18T16:59:00-08:00", expected: undefined },
  {
    name: "5:00 pm, the night ends on the next date",
    at: "2025-01-18T17:00:00-08:00",
    expected: "2025-01-19T06:00:00-08:00",
  },
  {
    name: "the night daylight time begins (UTC-7 by 6 am)",
    at: "2025-03-09T00:30:00-08:00",
    expected: "2025-03-09T06:00:00-07:00",
  },
  {
    name: "the night daylight time ends (UTC-8 by 6 am)",
    at: "2025-11-02T00:30:00-07:00",
    expected: "2025-11-02T06:00:00-08:00",
  },
])("a full pull's deadline: $name", ({ at, expected }) => {
  const timestamp = readTimestamp(at);
  if (timestamp === undefined) throw new Error(`The row's time ${at} is not a time`);
  expect(fullPullDeadline(timestamp)).toBe(expected === undefined ? undefined : readTimestamp(expected));
});
