// The log's own header (ticket #177): the committee it was written for and the time the Meeting started, as the first page
// prints them under the compliance sentence:
//
//   HOUSE COMMITTEE ON AGRICULTURE, LAND USE, NATURAL
//   RESOURCES, AND WATER
//   January 22, 2025 Hearing Room D
//   08:00 AM
//
// The committee's name may wrap over lines, and a subcommittee's log prints its parent first ("JOINT COMMITTEE ON WAYS AND
// MEANS" / "SUBCOMMITTEE ON GENERAL GOVERNMENT"). The time is "08:00 AM", "8:30 AM" or "3:00pm".

import { COMPLIANCE_LINE } from "./blocks.ts";

/** What a log's header says: its committee lines joined by a space, the time as printed, and that time on a 24-hour clock. */
export type RecordingLogHeader = {
  /** The committee lines, joined by a space, as printed: "HOUSE COMMITTEE ON BEHAVIORAL HEALTH". */
  committee: string;
  /** The time line as printed: "01:00 PM". */
  time: string;
  /** The time on a 24-hour clock, "13:00". */
  startsAt: string;
};

/** The Meeting a log is filed under, as the store holds it: its committee's code and name, and when it starts. */
export type HeaderMeeting = {
  committeeCode: string;
  committeeName: string;
  /** The Meeting's start in Pacific time with its offset, "2025-01-22T08:00:00-08:00". */
  at: string;
};

const CHAMBER_LINE = /^(?:HOUSE|SENATE|JOINT)\b/;
const DATE_LINE =
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/;
const TIME_LINE = /^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i;

/** The header of a log's text, or null when its first page has no committee, date and time lines in that order. Pure. */
export function headerOf(text: string): RecordingLogHeader | null {
  const lines = (text.split("\f")[0] ?? "").split("\n").map((line) => line.trim());
  const first = lines.findIndex((line) => CHAMBER_LINE.test(line));
  if (first === -1) return null;
  const committee: string[] = [];
  for (let index = first; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (DATE_LINE.test(line)) {
      const time = lines[index + 1] ?? "";
      const read = TIME_LINE.exec(time);
      if (read === null || committee.length === 0) return null;
      const hours = (Number(read[1]) % 12) + (read[3]?.toUpperCase() === "P" ? 12 : 0);
      return {
        committee: committee.join(" "),
        time,
        startsAt: `${String(hours).padStart(2, "0")}:${read[2] ?? ""}`,
      };
    }
    if (line === "" || COMPLIANCE_LINE.test(line)) return null;
    committee.push(line);
  }
  return null;
}

const CHAMBER_OF_CODE: Record<string, string> = { H: "HOUSE", S: "SENATE", J: "JOINT" };

function normalized(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a header names the Meeting: its first word is the chamber the committee's code begins with ("HBH" is a House
 * committee, "SECBH" a Senate one, "JWMGG" a joint one), its committee lines end with "ON " and the committee's name, and its
 * time is the Meeting's start. Pure.
 */
export function headerNamesMeeting(header: RecordingLogHeader, meeting: HeaderMeeting): boolean {
  const chamber = CHAMBER_OF_CODE[meeting.committeeCode.charAt(0)];
  const committee = normalized(header.committee);
  return (
    chamber !== undefined &&
    committee.startsWith(`${chamber} `) &&
    committee.endsWith(` ON ${normalized(meeting.committeeName)}`) &&
    meeting.at.slice(11, 16) === header.startsAt
  );
}
