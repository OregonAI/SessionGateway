import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";

// Seam 2: a repeal list followed by a session-law citation (#55; the gap #22 found in PR #44). Legislative Counsel
// repeals ORS sections and sections of an earlier session's law in one sentence, "ORS A and B and section 9, chapter
// 492, Oregon Laws 2023, are repealed", and every ORS section of the list is repealed by the measure section that holds
// it, whatever citation follows the list. Expected links are [kind, target id, measure section].
//
// The SB 1583 and HB 4060 rows (#111) quote the 2026R1 stored text, with its document id and page. The others quote the
// research cache (.cache/olis-2025R1/, not committed: the Acceptable Use Agreement grants no redistribution license; it
// is not in CI, so each quote is inline), as the pdf-text package extracts the document (the text the store holds), with
// the lines of that extraction the passage is. The made-up rows say why they are.

type Expected = [kind: string, targetId: string, measureSection: string | null];

type Row = {
  name: string;
  /**
   * The document and the page (2026R1) or the lines of its pdf-text extraction (research cache) the passage is;
   * "made up" for a constructed sentence.
   */
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
    name: "SB 1583 §15: ORS 430.388 is repealed, with 'section 6, chapter 248, Oregon Laws 2023, as amended by section 7, chapter 292, Oregon Laws 2025' after it (#111)",
    source:
      "2026R1 stored text of version-2026r1-sb1583-introduced (SB 1583 Introduced, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/SB1583/Introduced), page 15; not in the committed fixture. The history after a session-law citation (#111 form 5)",
    text: `REPEAL OF OVERSIGHT AND ACCOUNTABILITY COUNCIL
SECTION 15. ORS 430.388 and section 6, chapter 248, Oregon Laws 2023, as amended by
section 7, chapter 292, Oregon Laws 2025, are repealed.
CONFORMING AMENDMENTS`,
    expected: [["repeals", "ors-430.388", "15"]],
  },
  {
    // No document in the research cache or the committed fixture cites a session-law section after ORS sections without
    // a repeal following, so this sentence is made up, in Legislative Counsel's wording, and is not a quote.
    name: "a session-law citation that no repeal follows leaves the ORS sections as citations",
    source: "made up: no real document has the shape",
    text: "SECTION 4. ORS 238A.010 and section 9, chapter 492, Oregon Laws 2023, apply to a member.",
    expected: [["cites", "ors-238a.010", "4"]],
  },
  {
    name: "HB 4060 A-Eng. §4b: a repeal of a session-law section named by its enrolled bill, with '(amending ORS 459.488)' before 'is repealed'",
    source:
      "2026R1 stored text of version-2026r1-hb4060-a-engrossed (HB 4060 A-Engrossed, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/HB4060/A-Engrossed), page 5; not in the committed fixture. The Statutes Affected Table lists 459.488 for this measure as a citation, not a repeal",
    text: `SECTION 4b. If House Bill 4066 becomes law, section 23, chapter , Oregon Laws
2026 (Enrolled House Bill 4066) (amending ORS 459.488), is repealed.
SECTION 5. The amendments to`,
    expected: [["cites", "ors-459.488", "4b"]],
  },
  {
    name: "a session-law citation with a history, then a clause that applies, then a separate repeal, leaves the ORS section as a citation",
    source: "made up: complete citations, in Legislative Counsel's wording; no real document is quoted",
    text: "SECTION 4. ORS 238A.010 and section 9, chapter 492, Oregon Laws 2023, as amended by section 7, chapter 292, Oregon Laws 2025, apply to a member, and section 2 of this 2026 Act is repealed on January 2, 2028.",
    expected: [["cites", "ors-238a.010", "4"]],
  },
  {
    name: "a session-law citation with a history, 'become operative', then a separate repeal, leaves the ORS section as a citation",
    source: "made up: complete citations, in Legislative Counsel's wording; no real document is quoted",
    text: "SECTION 5. ORS 238A.010 and section 9, chapter 492, Oregon Laws 2023, as amended by section 7, chapter 292, Oregon Laws 2025, become operative on January 1, 2027, and section 9 of this 2026 Act is repealed.",
    expected: [["cites", "ors-238a.010", "5"]],
  },
  {
    name: "'Notwithstanding' a session-law citation with a history, then provisions 'that are repealed', leaves the ORS section as a citation",
    source: "made up: complete citations, in Legislative Counsel's wording; no real document is quoted",
    text: "SECTION 6. Notwithstanding ORS 1.010 and section 6, chapter 248, Oregon Laws 2023, as amended by section 7, chapter 292, Oregon Laws 2025, the provisions of section 9 of this 2026 Act that are repealed remain in effect.",
    expected: [["cites", "ors-1.010", "6"]],
  },
  {
    name: "'The amendments to' an ORS section and a session-law citation with a history, 'by sections 3 and 4 of this 2026 Act are repealed', leaves the ORS section as a citation",
    source: "made up: complete citations, in Legislative Counsel's wording; no real document is quoted",
    text: "SECTION 7. The amendments to ORS 1.010 and section 6, chapter 248, Oregon Laws 2023, as amended by section 7, chapter 292, Oregon Laws 2025, by sections 3 and 4 of this 2026 Act are repealed.",
    expected: [["cites", "ors-1.010", "7"]],
  },
];

describe("a repeal list, with or without a session-law citation after it", () => {
  test.for(rows)("$name ($source)", ({ text, expected }) => {
    expect(linksOf(text)).toEqual(expected);
  });
});
