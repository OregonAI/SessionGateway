import { describe, expect, test } from "vitest";
import { parseRecordingLog, type RecordingLogLink } from "../index.ts";
import { e, playerLinks, turnsOf, type QuotedLink } from "./real-logs.ts";

// Seam 2: the annotations' event ID and per-turn offsets, and the logs the parser reports instead of guessing (#125).
//
// Quoted: research cache video-research/dl/logs/sample/308804.pdf (HLWS 2025-05-14, feed document 308804), the whole
// log (a three-line meeting), as the pdf-text package extracts it, with every link annotation pdf.js reads from it:
// six player links (two for each timecode line) and the link to the meeting's materials. Its chair's line is logged
// 00:00:06, and the link on that line says startStreamAt=7: the offset follows the link.
//
// Made up: the rows that change that log's links (they say how), because the research cache holds no log with no
// event ID, two event IDs, or links that do not match its lines.

const text = `This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.
HOUSE COMMITTEE ON LABOR AND WORKPLACE STANDARDS
May 14, 2025 Hearing Room D
03:00 PM
STAFF PRESENT: Erin Seiler, LPRO Analyst
Desi Root, Committee Assistant
EXHIBITS: Exhibits from this meeting are available here
MEASURES/ISSUES:
00:00:05 Meeting Called to Order
00:00:06 Chair Grayber
00:00:55 Meeting Adjourned
MEMBERS PRESENT: Rep. Dacia Grayber, Chair
Rep. Lesly Muñoz, Vice-Chair
Rep. Shelly Boshart Davis
Rep. Lisa Fragala
Rep. Travis Nelson
MEMBER(S) EXCUSED: Rep. Lucetta Elmer, Vice-Chair
Rep. Anna Scharf`;

const EVENT_ID = "2025051156";

const materials: RecordingLogLink = {
  page: 1,
  rect: [424.04, 447.42, 451.77, 460.07],
  url: "https://olis.oregonlegislature.gov/liz/2025R1/Committees/HLWS/2025-05-14-15-00/MeetingMaterials",
};

const chair: QuotedLink[] = [
  [1, [69.75, 355.43, 125.62, 369.23], 7],
  [1, [141.75, 355.43, 221.61, 369.23], 7],
];
const callToOrder: QuotedLink[] = [
  [1, [69.75, 369.23, 122.28, 383.03], 5],
  [1, [141.75, 369.23, 273.64, 383.03], 5],
];
const adjourned: QuotedLink[] = [
  [1, [69.75, 341.63, 122.28, 355.43], 55],
  [1, [141.75, 341.63, 246.32, 355.43], 55],
];

describe("the event ID and the offsets of a log", () => {
  test("the event ID is the eventID of the player links; a link to the meeting's materials is not one", () => {
    const parse = parseRecordingLog({
      text,
      links: [materials, ...playerLinks(EVENT_ID, [...callToOrder, ...chair, ...adjourned])],
    });

    expect(parse).toMatchObject({ kind: "parsed", eventId: EVENT_ID });
  });

  test("HLWS 2025-05-14: a turn's offset is its link's startStreamAt (7), not its timecode (00:00:06); the others agree", () => {
    const parse = parseRecordingLog({
      text,
      links: [materials, ...playerLinks(EVENT_ID, [...callToOrder, ...chair, ...adjourned])],
    });

    expect(parse).toEqual({
      kind: "parsed",
      eventId: EVENT_ID,
      speakerTurns: turnsOf([["00:00:06", 7, "link", "Chair Grayber", null]]),
      entries: [
        e("call-to-order", "00:00:05", 5, "Meeting Called to Order"),
        e("adjournment", "00:00:55", 55, "Meeting Adjourned"),
      ],
      pagesReadByTimecode: [],
    });
  });

  test("made up (the log above with the chair's two links removed): a page whose links do not match its timecode lines is read from the timecodes, and says so", () => {
    const parse = parseRecordingLog({
      text,
      links: [materials, ...playerLinks(EVENT_ID, [...callToOrder, ...adjourned])],
    });

    expect(parse).toEqual({
      kind: "parsed",
      eventId: EVENT_ID,
      speakerTurns: turnsOf([["00:00:06", 6, "timecode", "Chair Grayber", null]]),
      entries: [
        e("call-to-order", "00:00:05", 5, "Meeting Called to Order", "timecode"),
        e("adjournment", "00:00:55", 55, "Meeting Adjourned", "timecode"),
      ],
      pagesReadByTimecode: [1],
    });
  });
});

describe("a log the parser does not guess at", () => {
  test("made up (the log above with only its link to the meeting's materials): no player link, so no event ID", () => {
    expect(parseRecordingLog({ text, links: [materials] })).toEqual({ kind: "no-event-id" });
  });

  test("made up (the log above with no annotations at all): no event ID", () => {
    expect(parseRecordingLog({ text, links: [] })).toEqual({ kind: "no-event-id" });
  });

  test("made up (the log above with the adjournment's links changed to eventID 2025051157): two event IDs, in the order they appear", () => {
    const parse = parseRecordingLog({
      text,
      links: [materials, ...playerLinks(EVENT_ID, [...callToOrder, ...chair]), ...playerLinks("2025051157", adjourned)],
    });

    expect(parse).toEqual({ kind: "conflicting-event-ids", eventIds: [EVENT_ID, "2025051157"] });
  });
});
