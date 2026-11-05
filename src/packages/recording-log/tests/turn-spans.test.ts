import { describe, expect, test } from "vitest";
import { speakerTurnSpans } from "../index.ts";

// Seam 2: a Recording Log's text and the turns stored for it in; where each turn's lines are in the text out (ticket #127,
// ADR-0052's "Turns and Passages"). The rows quote a real log (HALNRW 2025-01-22, feed document 288741, the lines of its
// pdf-text extraction, test/fixtures/olis-2025R1/documents/committee-meeting-documents/288741.pdf) and name the lines. A
// turn is a timecode line and the lines that continue it; the span of a turn is those lines, each with its line break.
// The turns are given as the index stores them: the timecode and the speaker as logged, in the order of the log.

const wrapped = `00:01:47 Anna Glueder, LPRO Analyst
00:02:49 Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State
University (OSU)
00:06:15 Melissa Rice, student, Carlson College of Veterinary Medicine, OSU
`;

describe("the span of each stored turn in a Recording Log's text", () => {
  test("a turn that wraps onto a second line spans both lines, and the next turn starts where it ends", () => {
    // 288741, lines 00:01:47 to 00:06:15 (page 2).
    const spans = speakerTurnSpans(wrapped, [
      { timecode: "00:01:47", speaker: "Anna Glueder, LPRO Analyst" },
      {
        timecode: "00:02:49",
        speaker: "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
      },
      { timecode: "00:06:15", speaker: "Melissa Rice, student, Carlson College of Veterinary Medicine, OSU" },
    ]);

    expect(spans.map((span) => (span === null ? null : wrapped.slice(span.start, span.end)))).toEqual([
      "00:01:47 Anna Glueder, LPRO Analyst\n",
      "00:02:49 Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State\nUniversity (OSU)\n",
      "00:06:15 Melissa Rice, student, Carlson College of Veterinary Medicine, OSU\n",
    ]);
  });

  test("a turn is found by its timecode and its speaker, in the order of the log, when a line before it has the same timecode", () => {
    // 288741 prints "00:22:39 HB 2168 - Public Hearing" before "00:22:38 Co-Chair Helm"; a MADE UP line below repeats a
    // timecode, so the speaker tells the two apart: the Agenda item line is not a turn.
    const text = `00:22:39 HB 2168 - Public Hearing
00:22:39 Co-Chair Helm
00:23:06 Anna Glueder, LPRO Analyst
`;
    const spans = speakerTurnSpans(text, [
      { timecode: "00:22:39", speaker: "Co-Chair Helm" },
      { timecode: "00:23:06", speaker: "Anna Glueder, LPRO Analyst" },
    ]);

    expect(spans.map((span) => (span === null ? null : text.slice(span.start, span.end)))).toEqual([
      "00:22:39 Co-Chair Helm\n",
      "00:23:06 Anna Glueder, LPRO Analyst\n",
    ]);
  });

  test("a turn whose second line is on the next page spans only the lines before the page's own lines (MADE UP page break)", () => {
    // MADE UP: the real logs wrap a title across a page break nowhere in the fixture. The page's repeated lines (the
    // compliance sentence, the committee code, the date and "Page 2 of 3") are not the turn's, so the span stops before them,
    // and the speaker the index stores still holds the second line.
    const text = `00:10:00 Pat Poe, Director, A Very Long Organisation Name
HALNRW
01/22/2025
Page 2 of 3
This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.
Institute
00:11:00 Co-Chair Helm
`;
    const spans = speakerTurnSpans(text, [
      { timecode: "00:10:00", speaker: "Pat Poe, Director, A Very Long Organisation Name Institute" },
      { timecode: "00:11:00", speaker: "Co-Chair Helm" },
    ]);

    expect(spans.map((span) => (span === null ? null : text.slice(span.start, span.end)))).toEqual([
      "00:10:00 Pat Poe, Director, A Very Long Organisation Name\n",
      "00:11:00 Co-Chair Helm\n",
    ]);
  });

  test("a turn the text does not hold has no span", () => {
    const spans = speakerTurnSpans(wrapped, [{ timecode: "09:09:09", speaker: "Nobody" }]);

    expect(spans).toEqual([null]);
  });
});
