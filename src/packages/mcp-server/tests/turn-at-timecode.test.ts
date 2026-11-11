import { describe, expect, test } from "vitest";
import { turnAtTimecode } from "../lib/get-document.ts";

// Seam 4 (test/CLAUDE.md): which speaker turn a timecode names (ticket #174, ADR-0061), called directly.
//
// Quoted: real 2026R1 lines of two logs, as the index lists their turns (the timecode, then the speaker as logged):
//   log 314932: "00:01:02 Alexandra Kihn-Stang, LPRO Analyst" and, on the next line, "00:01:02 Chair Nosse";
//   log 315743: "00:41:16 Alan Dale" twice in a row.
// Two turns of a log can have the same timecode, and a timecode then names the first of them: the second cannot be reached by
// timecode (ADR-0061). The turns around those two lines (the 00:00:04 and 00:02:10 turns) are MADE UP, so the rows are short.

describe("turnAtTimecode", () => {
  test("names the first of two turns with the same timecode (log 314932's 00:01:02)", () => {
    const turns = [
      { timecode: "00:00:04" },
      { timecode: "00:01:02" }, // Alexandra Kihn-Stang, LPRO Analyst
      { timecode: "00:01:02" }, // Chair Nosse
      { timecode: "00:02:10" },
    ];

    expect(turnAtTimecode(turns, "00:01:02")).toBe(1);
  });

  test("names the first of two turns of the same speaker with the same timecode (log 315743's 00:41:16)", () => {
    const turns = [{ timecode: "00:40:00" }, { timecode: "00:41:16" }, { timecode: "00:41:16" }];

    expect(turnAtTimecode(turns, "00:41:16")).toBe(1);
  });

  test("names a turn by its second, whether the hour is written with one digit or two", () => {
    expect(turnAtTimecode([{ timecode: "00:20:41" }, { timecode: "1:02:03" }], "01:02:03")).toBe(1);
  });

  test("names no turn for a timecode none has", () => {
    expect(turnAtTimecode([{ timecode: "00:00:04" }], "00:00:05")).toBe(-1);
  });
});
