import { describe, expect, test } from "vitest";
import { headerNamesMeeting, recordingLogHeaderOf, type HeaderMeeting } from "../index.ts";

// Seam 2 (test/CLAUDE.md): which Meeting a log's own header names (ticket #177, ADR-0060): the chamber, the committee, the
// date and the start time must all be the Meeting's.
//
// Quoted: the first pages' header lines of two real 2026R1 logs, from the index of the 2026-11-10 sweep (ADR-0060):
//   316511 (HBH, filed under 2026-02-03 13:00): "HOUSE COMMITTEE ON BEHAVIORAL HEALTH" / "February 3, 2026 Hearing Room 50" / "01:00 PM"
//   316510 (SJUD, filed under 2026-02-04 12:45): "SENATE COMMITTEE ON JUDICIARY" / "February 4, 2026 Hearing Room C" / "12:45 PM"
// MADE UP: every Meeting below that is not that log's own (another committee, another day, a House Judiciary Meeting at the
// Senate log's time), each named by the case; the Meetings' committee names are the feed's wording, "Behavioral Health" and
// "Judiciary".

const COMPLIANCE =
  "This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.";

function headerOfLog(lines: string[]) {
  const header = recordingLogHeaderOf(
    [COMPLIANCE, ...lines, "STAFF PRESENT: A. Person, Committee Assistant"].join("\n"),
  );
  if (header === null) throw new Error("the quoted header was not read");
  return header;
}

const hbh = headerOfLog(["HOUSE COMMITTEE ON BEHAVIORAL HEALTH", "February 3, 2026 Hearing Room 50", "01:00 PM"]);
const sjud = headerOfLog(["SENATE COMMITTEE ON JUDICIARY", "February 4, 2026 Hearing Room C", "12:45 PM"]);

const hbhMeeting: HeaderMeeting = {
  committeeCode: "HBH",
  committeeName: "Behavioral Health",
  at: "2026-02-03T13:00:00-08:00",
};
const sjudMeeting: HeaderMeeting = {
  committeeCode: "SJUD",
  committeeName: "Judiciary",
  at: "2026-02-04T12:45:00-08:00",
};

describe("headerNamesMeeting", () => {
  test("a log's own Meeting is named", () => {
    expect(headerNamesMeeting(hbh, hbhMeeting)).toBe(true);
    expect(headerNamesMeeting(sjud, sjudMeeting)).toBe(true);
  });

  test("the same day and time under another committee is not named (MADE UP: a House Human Services Meeting at 13:00)", () => {
    expect(headerNamesMeeting(hbh, { committeeCode: "HHS", committeeName: "Human Services", at: hbhMeeting.at })).toBe(
      false,
    );
  });

  test("a committee whose name only ends the header's committee is not named (MADE UP: a Health committee)", () => {
    expect(headerNamesMeeting(hbh, { committeeCode: "HH", committeeName: "Health", at: hbhMeeting.at })).toBe(false);
  });

  test("House Judiciary is not Senate Judiciary: the same name, day and time under the other chamber (MADE UP: HJUD at SJUD's time)", () => {
    const hjud: HeaderMeeting = { committeeCode: "HJUD", committeeName: "Judiciary", at: sjudMeeting.at };
    expect(headerNamesMeeting(sjud, hjud)).toBe(false);
    expect(headerNamesMeeting(sjud, sjudMeeting)).toBe(true);
  });

  test("a joint committee's header is not a House or Senate committee's", () => {
    const joint = headerOfLog(["JOINT COMMITTEE ON WAYS AND MEANS", "February 4, 2026 Hearing Room C", "12:45 PM"]);
    const senate: HeaderMeeting = { committeeCode: "SWM", committeeName: "Ways and Means", at: sjudMeeting.at };
    expect(headerNamesMeeting(joint, senate)).toBe(false);
    expect(headerNamesMeeting(joint, { ...senate, committeeCode: "JWM" })).toBe(true);
  });

  test("the same committee and time on another day is not named (MADE UP: HBH 2026-02-05 13:00 for the log of 2026-02-03)", () => {
    expect(headerNamesMeeting(hbh, { ...hbhMeeting, at: "2026-02-05T13:00:00-08:00" })).toBe(false);
  });

  test("another start time is not named", () => {
    expect(headerNamesMeeting(hbh, { ...hbhMeeting, at: "2026-02-03T08:00:00-08:00" })).toBe(false);
  });
});
