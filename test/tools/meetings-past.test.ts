// Seam 1 (test/CLAUDE.md): `meetings` over the Session after the fact. A fake OLIS serves the committed
// fixture as it stands on 2025-07-15, when every one of its 36 meetings is in the past, and one
// database serves every case in this file because none of them changes it. No document is needed: the
// cases here read meetings, their status and their agenda items, and the fake serves no files, so the
// worker lists the documents as not fetched. The cases that need documents are in meetings.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({ clockAt: "2025-07-15T17:00:00Z", documents: false });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type MeetingOutput = { id: string; upcoming: boolean; status: string; [field: string]: unknown };

describe.for(eras)("meetings over the Session after the fact, for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Expected values are the meeting rows of feed/CommitteeMeetings.json for the dates, in the order of their
  // start times and then their committee codes. 2025-01-21 to 2025-01-28 holds five of the fixture's 36
  // meetings; SLB's of 01-30 is the next one, and 01-28 is the last day, which counts whole.
  it("returns the past meetings of a date range, both ends included", async () => {
    const outcome = await callTool(connected, "meetings", { from: "2025-01-21", to: "2025-01-28" });

    expect(outcome.isError).toBe(false);
    const meetings = outcome.structured?.["meetings"] as MeetingOutput[];
    expect(meetings.map((meeting) => [meeting.id, meeting.upcoming])).toEqual([
      ["meeting-2025r1-slb-2025-01-21-0800", false],
      ["meeting-2025r1-halnrw-2025-01-22-0800", false],
      ["meeting-2025r1-shs-2025-01-23-0800", false],
      ["meeting-2025r1-halnrw-2025-01-27-0800", false],
      ["meeting-2025r1-slb-2025-01-28-0800", false],
    ]);
    expect(outcome.structured).toMatchObject({ matching_meetings: 5, truncated: false });
    // Nothing is ahead of the clock, so there is no next meeting.
    expect(outcome.structured?.["next_meeting_id"]).toBeNull();
    expect(outcome.structured?.["now"]).toBe("2025-07-15T10:00:00-07:00");
  });

  // SLB's six meetings in feed/CommitteeMeetings.json, by start time. The committee is given by the code the
  // feed uses or by its id, in either case.
  it("returns a committee's meetings, whether it is given by code or by id", async () => {
    const expected = [
      "meeting-2025r1-slb-2025-01-21-0800",
      "meeting-2025r1-slb-2025-01-28-0800",
      "meeting-2025r1-slb-2025-01-30-0800",
      "meeting-2025r1-slb-2025-03-11-0800",
      "meeting-2025r1-slb-2025-03-13-0800",
      "meeting-2025r1-slb-2025-03-18-0800",
    ];
    for (const committee of ["SLB", "slb", "committee-2025r1-slb"]) {
      const outcome = await callTool(connected, "meetings", { committee });

      expect(outcome.isError, committee).toBe(false);
      const meetings = outcome.structured?.["meetings"] as MeetingOutput[];
      expect(
        meetings.map((meeting) => meeting.id),
        committee,
      ).toEqual(expected);
    }
  });

  // The filters all have to hold: SLB's meetings in March are the last three of its six.
  it("returns the meetings that match every filter given", async () => {
    const outcome = await callTool(connected, "meetings", { committee: "SLB", from: "2025-03-01", to: "2025-03-31" });

    const meetings = outcome.structured?.["meetings"] as MeetingOutput[];
    expect(meetings.map((meeting) => meeting.id)).toEqual([
      "meeting-2025r1-slb-2025-03-11-0800",
      "meeting-2025r1-slb-2025-03-13-0800",
      "meeting-2025r1-slb-2025-03-18-0800",
    ]);
  });

  // The errors say what to give (src/CLAUDE.md, "Errors"). The fixture's committees are the twelve in
  // feed/Committees.json; there is no "XYZ".
  it("answers a committee the Session does not have with an error that says what to give", async () => {
    const outcome = await callTool(connected, "meetings", { committee: "XYZ" });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('No committee "XYZ" in the 2025R1 Session.');
    expect(outcome.text).toContain("SLB");
  });

  // Spec #1: "Meetings by Measure, committee or date range". With none of them a call would ask for every
  // meeting of the Session, which is more than an agent can read.
  it("asks for a Measure, a committee or a date range when given none", async () => {
    const outcome = await callTool(connected, "meetings", {});

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("Give a Measure, a committee or a date range");
  });

  it("refuses a date range that ends before it starts", async () => {
    const outcome = await callTool(connected, "meetings", { from: "2025-02-01", to: "2025-01-01" });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("from 2025-02-01 is after to 2025-01-01");
  });

  it("refuses a date that is not on the calendar", async () => {
    const outcome = await callTool(connected, "meetings", { from: "2025-02-30" });

    expect(outcome.isError).toBe(true);
  });

  // Cancelled meetings stay in the list with the status the feed gives (feed/CommitteeMeetings.json: HHED's
  // 2025-02-13 meeting and SHS's 2025-05-22 meeting have MeetingStatus "Cancelled"; every other fixture
  // meeting is "Scheduled"). The cancelled meeting's agenda item has no Action, because the committee did
  // not act on it.
  it("shows a cancelled meeting with the status the feed gives", async () => {
    const outcome = await callTool(connected, "meetings", { committee: "HHED" });

    const meetings = outcome.structured?.["meetings"] as (MeetingOutput & {
      agenda_items: { measure_id: string; action: string | null }[];
    })[];
    expect(meetings.map((meeting) => [meeting.id, meeting.status])).toEqual([
      ["meeting-2025r1-hhed-2025-02-06-0800", "Scheduled"],
      ["meeting-2025r1-hhed-2025-02-13-0800", "Cancelled"],
      ["meeting-2025r1-hhed-2025-02-20-0800", "Scheduled"],
    ]);
    expect(meetings[1]?.agenda_items.map((item) => [item.measure_id, item.action])).toEqual([
      ["measure-2025r1-hb3027", null],
    ]);
  });

  // A call returns whole days of meetings up to about 20,000 characters of JSON, the size of one get_document
  // part (ADR-0011, "Parts"), so a wide question is read a page at a time: ask again with `from` the day after
  // the last meeting returned. The year holds all 36 meetings of the fixture (feed/CommitteeMeetings.json, by
  // start time and then committee code), about 1,600 characters each, which is three pages and not one. Each
  // meeting comes back once, in order, and `matching_meetings` counts the meetings left from `from`.
  it("returns a wide question a page at a time, each meeting once, no page past 20,000 characters", async () => {
    const everyMeeting = [
      "meeting-2025r1-slb-2025-01-21-0800",
      "meeting-2025r1-halnrw-2025-01-22-0800",
      "meeting-2025r1-shs-2025-01-23-0800",
      "meeting-2025r1-halnrw-2025-01-27-0800",
      "meeting-2025r1-slb-2025-01-28-0800",
      "meeting-2025r1-slb-2025-01-30-0800",
      "meeting-2025r1-shs-2025-02-04-0800",
      "meeting-2025r1-hhed-2025-02-06-0800",
      "meeting-2025r1-halnrw-2025-02-12-0800",
      "meeting-2025r1-hhed-2025-02-13-0800",
      "meeting-2025r1-hhed-2025-02-20-0800",
      "meeting-2025r1-slb-2025-03-11-0800",
      "meeting-2025r1-slb-2025-03-13-0800",
      "meeting-2025r1-sed-2025-03-17-0800",
      "meeting-2025r1-sfr-2025-03-17-0800",
      "meeting-2025r1-slb-2025-03-18-0800",
      "meeting-2025r1-sed-2025-03-24-0800",
      "meeting-2025r1-hechs-2025-04-03-0800",
      "meeting-2025r1-sfr-2025-04-14-0800",
      "meeting-2025r1-hechs-2025-04-15-0800",
      "meeting-2025r1-hlws-2025-04-21-1500",
      "meeting-2025r1-sed-2025-04-23-0800",
      "meeting-2025r1-srules-2025-04-23-1300",
      "meeting-2025r1-hlws-2025-04-28-1500",
      "meeting-2025r1-shs-2025-04-29-0845",
      "meeting-2025r1-sed-2025-04-30-0800",
      "meeting-2025r1-hechs-2025-05-01-0800",
      "meeting-2025r1-sed-2025-05-05-0800",
      "meeting-2025r1-srules-2025-05-05-1300",
      "meeting-2025r1-sed-2025-05-12-0800",
      "meeting-2025r1-sed-2025-05-14-0800",
      "meeting-2025r1-shs-2025-05-15-0800",
      "meeting-2025r1-shs-2025-05-20-0800",
      "meeting-2025r1-shs-2025-05-22-0800",
      "meeting-2025r1-hrules-2025-06-05-0800",
      "meeting-2025r1-hrules-2025-06-09-0830",
    ];
    const seen: string[] = [];
    const pageSizes: number[] = [];
    let from = "2025-01-01";
    for (let page = 0; page < everyMeeting.length; page += 1) {
      const outcome = await callTool(connected, "meetings", { from, to: "2025-12-31" });

      expect(outcome.isError).toBe(false);
      const meetings = outcome.structured?.["meetings"] as MeetingOutput[];
      expect(JSON.stringify(meetings).length).toBeLessThanOrEqual(20_000);
      expect(outcome.structured?.["matching_meetings"]).toBe(everyMeeting.length - seen.length);
      seen.push(...meetings.map((meeting) => meeting.id));
      pageSizes.push(meetings.length);
      if (outcome.structured?.["truncated"] !== true) break;
      const lastDay = (meetings.at(-1)?.["at"] as string).slice(0, 10);
      from = Temporal.PlainDate.from(lastDay).add({ days: 1 }).toString();
    }
    expect(seen).toEqual(everyMeeting);
    expect(pageSizes.length).toBeGreaterThan(1);
  });
});
