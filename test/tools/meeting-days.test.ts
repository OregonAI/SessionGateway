// Seam 1 (test/CLAUDE.md): the days the Session meets (ticket #67, ADR-0039, ADR-0042). With `15min` increments run on
// a day with a floor convening (ConveneTimes) scheduled and on any weekday while the Session is in progress (the
// LegislativeSessions row's BeginDate to EndDate), as well as on a day with a committee meeting; the staleness warning's
// 15min rule follows the same days. A null EndDate ends at the last convening the index holds (ticket #74, ADR-0043). Each case builds its own system, because the feed it needs is the thing under test:
// the fixture holds no ConveneTimes or LegislativeSessions file, so every row here is MADE UP, in the feed's shape
// (docs/research/olis-odata.md section 2), and added with `strayRows` so that the first pull reads it. The worker's loop
// runs with the harness's sleep (`runSchedule`); the fake OLIS's request log says what ran, as in ingest-schedule.test.ts.
// The embedder is the fake. The documents are off: nothing here reads one.
//
// The fixture's committee meetings fall on 2025-01-21..23, 27, 28 and 30 (feed/CommitteeMeetings.json), none on
// Wednesday 2025-01-29, Saturday 2025-02-01, Wednesday 2025-03-12 or Wednesday 2025-03-19. 2025-01-29 and 2025-03-19 are Wednesdays and
// 2025-02-01 is a Saturday. January is UTC-8 and March 19 is UTC-7 (daylight time began on 2025-03-09).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeOlis } from "../support/fake-olis.ts";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

vi.setConfig({ testTimeout: 120_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

type Row = Record<string, unknown>;

async function start(options: SystemOptions): Promise<System> {
  const system = await startSystem({ ingest: { increments: "15min", fullPull: "weekly" }, ...options });
  started.push(system);
  system.olis.forgetRequests();
  return system;
}

/** Increments are the counts of Measures with `gt datetime` in the filter; a full pull's has none. */
function incrementsOf(olis: FakeOlis): number {
  return olis
    .requests()
    .filter((request) => request.entitySet === "Measures" && request.isCount)
    .filter((request) => request.filter?.includes(" gt datetime") === true).length;
}

// MADE UP: a House and a Senate convening on Wednesday 2025-01-29, a day no committee meets.
const convenings: Row[] = [
  { SessionKey: "2025R1", SessionDate: "2025-01-29T08:30:00", Chamber: "H", RecessUntil: null, ModifiedDate: null },
  { SessionKey: "2025R1", SessionDate: "2025-01-29T09:00:00", Chamber: "S", RecessUntil: null, ModifiedDate: null },
];

// MADE UP: the Session's row, begun on Monday 2025-01-13 (as the real one) and ended on Friday 2025-03-14 (the real
// 2025R1 row has a null EndDate, olis-odata.md section 3).
const sessionRow: Row = {
  SessionKey: "2025R1",
  SessionName: "2025 Regular Session",
  BeginDate: "2025-01-13T00:00:00",
  EndDate: "2025-03-14T00:00:00",
  ModifiedDate: "2026-06-09T11:05:09",
  DefaultSession: false,
};

// Wednesday 2025-01-29 from 5 am to 5:30 am Thursday: sixteen hours of four quarters from 6 am to 10 pm.
const wednesday = { clockAt: "2025-01-29T13:00:00Z", until: "2025-01-30T13:30:00Z" };
const incrementsOnAWeekday = 64;

describe("with 15min, a day with a floor convening and no committee meeting", () => {
  it("runs an increment every 15 minutes from 6 am to 10 pm", async () => {
    const system = await start({ clockAt: wednesday.clockAt, olis: { strayRows: { ConveneTimes: convenings } } });

    await system.runSchedule(wednesday.until);

    expect(incrementsOf(system.olis)).toBe(incrementsOnAWeekday);
  });

  it("is the only reason: the same Wednesday without the convenings runs none", async () => {
    // A guard that was green before the ticket: the fixture has no meeting on 2025-01-29.
    const system = await start({ clockAt: wednesday.clockAt });

    await system.runSchedule(wednesday.until);

    expect(incrementsOf(system.olis)).toBe(0);
  });
});

describe("with 15min, a weekday while the Session is in progress", () => {
  it("runs increments on a weekday between the begin and end dates that has no meeting", async () => {
    const system = await start({
      clockAt: wednesday.clockAt,
      olis: { strayRows: { LegislativeSessions: [sessionRow] } },
    });

    await system.runSchedule(wednesday.until);

    expect(incrementsOf(system.olis)).toBe(incrementsOnAWeekday);
  });

  it("runs none on a Saturday between them with no meeting", async () => {
    // Saturday 2025-02-01 from 5 am to Sunday 5:30 am. The weekly full pull is the night that ended at 6 am that Saturday.
    const system = await start({
      clockAt: "2025-02-01T13:00:00Z",
      olis: { strayRows: { LegislativeSessions: [sessionRow] } },
    });

    await system.runSchedule("2025-02-02T13:30:00Z");

    expect(incrementsOf(system.olis)).toBe(0);
  });

  it("runs none on a weekday after the end date", async () => {
    // Wednesday 2025-03-19 from 5 am to Thursday 5:30 am (UTC-7), five days after EndDate 2025-03-14.
    const system = await start({
      clockAt: "2025-03-19T12:00:00Z",
      olis: { strayRows: { LegislativeSessions: [sessionRow] } },
    });

    await system.runSchedule("2025-03-20T12:30:00Z");

    expect(incrementsOf(system.olis)).toBe(0);
  });
});

// Ticket #74 (ADR-0043): the real 2025R1 row's EndDate is null. MADE UP: that row, and convenings held up to Thursday
// 2025-03-13 (both chambers), so the Session is in progress from 2025-01-13 to 2025-03-13. 2025-03-12 is a Wednesday
// with no committee meeting in the fixture; 2025-03-19 is the Wednesday after.
const openSessionRow: Row = { ...sessionRow, EndDate: null };
const conveningsToMarch13: Row[] = [
  { SessionKey: "2025R1", SessionDate: "2025-01-13T11:00:00", Chamber: "H", RecessUntil: null, ModifiedDate: null },
  { SessionKey: "2025R1", SessionDate: "2025-03-13T11:00:00", Chamber: "H", RecessUntil: null, ModifiedDate: null },
  { SessionKey: "2025R1", SessionDate: "2025-03-13T11:00:00", Chamber: "S", RecessUntil: null, ModifiedDate: null },
];
const openSession = { strayRows: { LegislativeSessions: [openSessionRow], ConveneTimes: conveningsToMarch13 } };

describe("with 15min, a Session whose EndDate is null", () => {
  it("runs increments on a weekday before the last convening that has no meeting", async () => {
    // Wednesday 2025-03-12 from 5 am to Thursday 5:30 am (UTC-7).
    const system = await start({ clockAt: "2025-03-12T12:00:00Z", olis: openSession });

    await system.runSchedule("2025-03-13T12:30:00Z");

    expect(incrementsOf(system.olis)).toBe(incrementsOnAWeekday);
  });

  it("runs none on a weekday after the last convening that has no meeting", async () => {
    // Wednesday 2025-03-19 from 5 am to Thursday 5:30 am (UTC-7), six days after the last convening.
    const system = await start({ clockAt: "2025-03-19T12:00:00Z", olis: openSession });

    await system.runSchedule("2025-03-20T12:30:00Z");

    expect(incrementsOf(system.olis)).toBe(0);
  });

  it("runs none on a weekday after the begin date when no convening is held", async () => {
    // Wednesday 2025-01-29, which the fixture gives no committee meeting.
    const system = await start({
      clockAt: wednesday.clockAt,
      olis: { strayRows: { LegislativeSessions: [openSessionRow] } },
    });

    await system.runSchedule(wednesday.until);

    expect(incrementsOf(system.olis)).toBe(0);
  });
});

describe("the staleness warning's 15min rule", () => {
  const WARNING = "may be out of date";
  // The pull is at 7:00 am; ten o'clock is three hours later, past the two hours the rule allows.
  const pulledAt = "2025-01-29T15:00:00Z";
  const tenAm = "2025-01-29T18:00:00Z";

  async function answerText(system: System): Promise<string> {
    const connected = await connectClient("2026-07-28", system.handler);
    try {
      return (await callTool(connected, "session_overview", {})).text;
    } finally {
      await connected.close();
    }
  }

  it("warns on a day with a floor convening and no committee meeting", async () => {
    const system = await start({ clockAt: pulledAt, olis: { strayRows: { ConveneTimes: convenings } } });
    system.clock.set(tenAm);
    expect(await answerText(system)).toContain(WARNING);
  });

  it("warns on a weekday while the Session is in progress", async () => {
    const system = await start({ clockAt: pulledAt, olis: { strayRows: { LegislativeSessions: [sessionRow] } } });
    system.clock.set(tenAm);
    expect(await answerText(system)).toContain(WARNING);
  });

  it("does not warn on a day that is none of these (a guard that was green before the ticket)", async () => {
    const system = await start({ clockAt: pulledAt });
    system.clock.set(tenAm);
    expect(await answerText(system)).not.toContain(WARNING);
  });

  it("does not warn on a Saturday in progress, nor on a weekday after the end date", async () => {
    // Saturday 2025-02-01 at 7 am, and Wednesday 2025-03-19 at 7 am (UTC-7), each read at 10 am.
    const saturday = await start({
      clockAt: "2025-02-01T15:00:00Z",
      olis: { strayRows: { LegislativeSessions: [sessionRow] } },
    });
    saturday.clock.set("2025-02-01T18:00:00Z");
    expect(await answerText(saturday)).not.toContain(WARNING);

    const afterEnd = await start({
      clockAt: "2025-03-19T14:00:00Z",
      olis: { strayRows: { LegislativeSessions: [sessionRow] } },
    });
    afterEnd.clock.set("2025-03-19T17:00:00Z");
    expect(await answerText(afterEnd)).not.toContain(WARNING);
  });

  it("with a null EndDate, warns on a weekday before the last convening and not on one after it", async () => {
    // Wednesday 2025-03-12 and Wednesday 2025-03-19, each pulled at 7 am (UTC-7) and read at 10 am.
    const before = await start({ clockAt: "2025-03-12T14:00:00Z", olis: openSession });
    before.clock.set("2025-03-12T17:00:00Z");
    expect(await answerText(before)).toContain(WARNING);

    const after = await start({ clockAt: "2025-03-19T14:00:00Z", olis: openSession });
    after.clock.set("2025-03-19T17:00:00Z");
    expect(await answerText(after)).not.toContain(WARNING);
  });
});
