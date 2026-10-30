import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";

// Seam 2: where a list of ORS chapters ends (#6 F7). "ORS chapter 652, 653 or 659A" is a list; a
// number that follows it is a chapter only when it is one more item of the list. Expected links are
// [kind, target id, measure section].

type Expected = [kind: string, targetId: string, measureSection: string | null];

function linksOf(text: string): Expected[] {
  const { links } = parseStatuteLinks({ documentKind: "version", text, orsSections: [] });
  return links.map((link): Expected => [link.kind, link.target.id, link.measureSection]);
}

// No fixture or research cache document puts a count after a chapter list, so these two sentences are
// constructed, as the F7 review constructed them, and are not quotes. Each has a number of days or
// weeks in the place the parser took for another chapter. Legislative Counsel writes a list as "A, B
// or C" (no comma before "and" or "or"; no document in the cache has one), and a quantity is not an item.
const constructedRows: { name: string; text: string; expected: Expected[] }[] = [
  {
    name: "', and 30 days' after a chapter: a comma before 'and' does not continue the list",
    text: "SECTION 1. A hearing is held under ORS chapter 183, and 30 days after notice the board decides.",
    expected: [["cites", "ors-chapter-183", "1"]],
  },
  {
    name: "'or 12 weeks' after a chapter: a number of weeks is not a chapter",
    text: "SECTION 1. Leave under ORS chapter 659A or 12 weeks of leave.",
    expected: [["cites", "ors-chapter-659a", "1"]],
  },
];

describe("a number after a chapter list that is not an item of it (constructed sentences)", () => {
  test.for(constructedRows)("$name", ({ text, expected }) => {
    expect(linksOf(text)).toEqual(expected);
  });
});

// Real lists whose last item is followed by a word are still read to their end.
const realRows: { name: string; source: string; text: string; expected: Expected[] }[] = [
  {
    name: "'ORS chapter 72 or 72A to retain or acquire' gives both chapters",
    source:
      "research cache documents-sample-2/MeasureDocuments_17.pdf (SB 167 Enrolled, not in the committed fixture), lines 165-167",
    text: `(C) Except as otherwise provided in ORS 72.5050, the right of a seller or lessor of goods under
ORS chapter 72 or 72A to retain or acquire possession of the goods is not a “security interest,” but
a seller or lessor may also acquire a “security interest” by complying with ORS chapter 79.`,
    expected: [
      ["cites", "ors-72.5050", null],
      ["cites", "ors-chapter-72", null],
      ["cites", "ors-chapter-72a", null],
      ["cites", "ors-chapter-79", null],
    ],
  },
];

describe("a chapter list followed by a word", () => {
  test.for(realRows)("$name ($source)", ({ text, expected }) => {
    expect(linksOf(text)).toEqual(expected);
  });
});
