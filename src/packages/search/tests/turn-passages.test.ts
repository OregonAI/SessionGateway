import { describe, expect, test } from "vitest";
import { splitAroundTurns, type TokenMeter } from "../passages.ts";

// Seam 4: a document's text and the spans of its turns in; the passages out (ticket #127, ADR-0052's "Turns and Passages").
// The text is MADE UP in the shape of a Recording Log: a header, timecoded lines, and the lines that are not turns. The
// meter counts a whitespace-separated word as a token and a passage holds at most 12, so a short text is cut in several.
// Expected values are the text's own lines.

const meter: TokenMeter = {
  countTokens: (text) => text.split(/\s+/).filter((word) => word !== "").length,
  maxPassageTokens: 12,
};

const lines = [
  "MADE UP COMMITTEE", // 0
  "January 1, 2099 Room 1", // 1
  "00:00:03 Meeting Called to Order", // 2
  "00:00:04 Co-Chair Helm", // 3 turn
  "00:00:48 HB 1 - Public Hearing", // 4
  "00:00:49 Pat Poe, Director, Made Up Agency", // 5 turn
  "00:01:09 VOTE: 7-0-2", // 6
  "00:01:10 Rep. Boice", // 7 turn
  "00:02:00 Meeting Adjourned", // 8
];
const text = `${lines.join("\n")}\n`;

function spanOfLine(index: number): { start: number; end: number } {
  const start = lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
  return { start, end: start + (lines[index]?.length ?? 0) + 1 };
}

const turnSpans = [spanOfLine(3), spanOfLine(5), spanOfLine(7)];

describe("a text cut around its turns", () => {
  const passages = splitAroundTurns(text, turnSpans, meter);

  test("each turn is a passage of its own, linked to its turn by its place in the list", () => {
    expect(
      passages.filter((passage) => passage.turn !== undefined).map((passage) => [passage.turn, passage.text]),
    ).toEqual([
      [0, "00:00:04 Co-Chair Helm\n"],
      [1, "00:00:49 Pat Poe, Director, Made Up Agency\n"],
      [2, "00:01:10 Rep. Boice\n"],
    ]);
  });

  test("the text between the turns is cut as any text is, and no text is lost or held twice", () => {
    const others = passages.filter((passage) => passage.turn === undefined).map((passage) => passage.text);

    // The lines that are not turns, in order, each once: the header and the first lines, the Agenda item and the vote
    // between the turns, and the adjournment.
    expect(others.join("").replaceAll(/\s+/g, " ").trim()).toBe(
      [0, 1, 2, 4, 6, 8].map((index) => lines[index]).join(" "),
    );
    // Every passage is a slice of the text, in order, and no two overlap.
    const ordered = passages.map((passage) => [passage.start, passage.end]);
    expect(ordered).toEqual(ordered.toSorted((a, b) => (a[0] ?? 0) - (b[0] ?? 0)));
    passages.forEach((passage, index) => {
      expect(text.slice(passage.start, passage.end)).toBe(passage.text);
      if (index > 0) expect(passage.start).toBeGreaterThanOrEqual(passages[index - 1]?.end ?? 0);
    });
  });

  test("no turns leaves the text cut as it was", () => {
    const plain = splitAroundTurns(text, [], meter);

    expect(plain.every((passage) => passage.turn === undefined)).toBe(true);
    expect(plain.map((passage) => passage.text).join("")).toBe(text);
  });

  test("a turn longer than a passage may be stays in the text between turns and is not a turn passage", () => {
    const long = `00:00:01 ${"word ".repeat(20).trim()}\n`;
    const around = splitAroundTurns(long, [{ start: 0, end: long.length }], meter);

    expect(around.some((passage) => passage.turn !== undefined)).toBe(false);
    expect(
      around
        .map((passage) => passage.text)
        .join(" ")
        .replaceAll(/\s+/g, " ")
        .trim(),
    ).toBe(long.trim());
  });
});
