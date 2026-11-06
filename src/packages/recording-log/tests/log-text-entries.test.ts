import { describe, expect, test } from "vitest";
import { entriesOfLogText } from "../index.ts";

// Seam 2: a stored Recording Log's text in; its entries that are not speaker turns out, read by their timecodes (ticket #134,
// ADR-0055). The worker keeps a log's text and its turns and not its links, so a transcript is read against the entries the
// text gives, whose seconds are the lines' timecodes (`offsetSource` "timecode"). The rows quote a real log (HALNRW
// 2025-01-22, feed document 288741, the lines of its pdf-text extraction, test/fixtures/olis-2025R1/documents/
// committee-meeting-documents/288741.pdf) and name the lines. Where the log's links are matched, a line's second is its
// timecode in hours, minutes and seconds (get-document-speaker-turns.test.ts reads the links of this log from the raw PDF).

const text = `HOUSE COMMITTEE ON AGRICULTURE, LAND USE, NATURAL
00:00:03 Meeting Called to Order
00:00:04 Co-Chair Helm
00:00:48 Adoption of Committee Rules - Organizational Meeting
00:00:49 Co-Chair Helm
00:00:52 MOTION: VICE-CHAIR FINGER MCDONALD MOVES ADOPTION OF
COMMITTEE RULES
00:01:09 VOTE: 7-0-2
AYES: BOICE, HARTMAN, B. LEVY, MARSH, MCLAIN, FINGER
MCDONALD, HELM
EXCUSED: SCHARF, OWENS
00:01:37 HB 2167 - Public Hearing
00:01:38 Co-Chair Helm
01:29:10 Meeting Adjourned
`;

describe("the entries of a Recording Log's text", () => {
  test("are its call to order, Agenda items, motion, vote and adjournment, with the second of each timecode and none of the turns", () => {
    const entries = entriesOfLogText(text);

    expect(entries.map((entry) => [entry.kind, entry.timecode, entry.offsetSeconds, entry.offsetSource])).toEqual([
      ["call-to-order", "00:00:03", 3, "timecode"],
      ["agenda-item", "00:00:48", 48, "timecode"],
      ["motion", "00:00:52", 52, "timecode"],
      ["vote", "00:01:09", 69, "timecode"],
      ["agenda-item", "00:01:37", 97, "timecode"],
      ["adjournment", "01:29:10", 5350, "timecode"],
    ]);
  });

  test("keep a wrapped line's text joined by one space", () => {
    const motion = entriesOfLogText(text).find((entry) => entry.kind === "motion");

    expect(motion?.text).toBe("MOTION: VICE-CHAIR FINGER MCDONALD MOVES ADOPTION OF COMMITTEE RULES");
  });

  test("are none for a text with no timecoded line", () => {
    expect(entriesOfLogText("STAFF PRESENT: Anna Glueder, LPRO Analyst\n")).toEqual([]);
  });
});
