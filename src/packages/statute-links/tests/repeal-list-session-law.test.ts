import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";

// Seam 2: a repeal list followed by a session-law citation (#55; the gap #22 found in PR #44). Legislative Counsel
// repeals ORS sections and sections of an earlier session's law in one sentence, "ORS A and B and section 9, chapter
// 492, Oregon Laws 2023, are repealed", and every ORS section of the list is repealed by the measure section that holds
// it, whatever citation follows the list. Expected links are [kind, target id, measure section].
//
// The rows quote the research cache (.cache/olis-2025R1/, not committed: the Acceptable Use Agreement grants no
// redistribution license; it is not in CI, so each quote is inline), as the pdf-text package extracts the document (the
// text the store holds), with the lines of that extraction the passage is. The one made-up row says why it is.

type Expected = [kind: string, targetId: string, measureSection: string | null];

type Row = {
  name: string;
  /** The document and the lines of its pdf-text extraction the passage is; "made up" for a constructed sentence. */
  source: string;
  text: string;
  expected: Expected[];
};

function linksOf(text: string): Expected[] {
  const { links } = parseStatuteLinks({ documentKind: "version", text, orsSections: [] });
  return links.map((link): Expected => [link.kind, link.target.id, link.measureSection]);
}

const rows: Row[] = [
  {
    name: "HB 3723 §1: ORS 247.016 and 247.018 are repealed, with 'section 9, chapter 492, Oregon Laws 2023' after them",
    source:
      "research cache documents-sample-1/MeasureDocuments_20 (HB 3723 Introduced, measure-documents/HB3723/Introduced.pdf), lines 49-51; Statutes Affected Table: 247.016 R §1 HB 3723 E, 247.018 R §1 HB 3723 E, 247.017 A §2 HB 3723 E",
    text: `SECTION 1. ORS 247.016 and 247.018 and section 9, chapter 492, Oregon Laws 2023, are
repealed.
SECTION 2. ORS 247.017 is amended to read:`,
    expected: [
      ["repeals", "ors-247.016", "1"],
      ["repeals", "ors-247.018", "1"],
      ["amends", "ors-247.017", "2"],
    ],
  },
  {
    name: "SB 83-7 §1(1): seven ORS sections are repealed, with 'sections 12a, 12b and 29, chapter 592, Oregon Laws 2021' after them",
    source:
      "research cache documents-sample-1/CommitteeProposedAmendments_22 (SB 83-7, LC 3373, proposed amendments to Senate Bill 83, requested by Senator Smith DB, 4/1/25), lines 36-38",
    text: `“SECTION 1. (1) ORS 455.612, 455.614, 476.390, 476.394, 477.027, 477.161
and 477.490 and sections 12a, 12b and 29, chapter 592, Oregon Laws 2021,
are repealed.`,
    expected: [
      ["repeals", "ors-455.612", "1"],
      ["repeals", "ors-455.614", "1"],
      ["repeals", "ors-476.390", "1"],
      ["repeals", "ors-476.394", "1"],
      ["repeals", "ors-477.027", "1"],
      ["repeals", "ors-477.161", "1"],
      ["repeals", "ors-477.490", "1"],
    ],
  },
  {
    name: "HB 3348 §78: a repeal list with no session-law citation after it repeals every section",
    source:
      "research cache documents-sample-2/MeasureDocuments_31 (HB 3348 Introduced, not in the committed fixture), lines 7530-7531",
    text: `REPEALS
SECTION 78. ORS 25.575, 25.576, 25.577 and 25.710 are repealed.`,
    expected: [
      ["repeals", "ors-25.575", "78"],
      ["repeals", "ors-25.576", "78"],
      ["repeals", "ors-25.577", "78"],
      ["repeals", "ors-25.710", "78"],
    ],
  },
  {
    name: "SB 238 §3: a repeal list inside quotation marks, with no session-law citation after it",
    source:
      "research cache documents-sample-2/MeasureDocuments_14 (SB 238, Senate Amendments by the Committee on Judiciary, April 14; not in the committed fixture), lines 139-140",
    text: `unmanned aircraft system.
“ SECTION 3. ORS 837.330, 837.335 and 837.340 are repealed.”.`,
    expected: [
      ["repeals", "ors-837.330", "3"],
      ["repeals", "ors-837.335", "3"],
      ["repeals", "ors-837.340", "3"],
    ],
  },
  {
    // No document in the research cache or the committed fixture cites a session-law section after ORS sections without
    // a repeal following, so this sentence is made up, in Legislative Counsel's wording, and is not a quote.
    name: "a session-law citation that no repeal follows leaves the ORS sections as citations",
    source: "made up: no real document has the shape",
    text: "SECTION 4. ORS 238A.010 and section 9, chapter 492, Oregon Laws 2023, apply to a member.",
    expected: [["cites", "ors-238a.010", "4"]],
  },
];

describe("a repeal list, with or without a session-law citation after it", () => {
  test.for(rows)("$name ($source)", ({ text, expected }) => {
    expect(linksOf(text)).toEqual(expected);
  });
});
