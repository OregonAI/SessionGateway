import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";
import { orsSectionList } from "./section-ids.ts";

// Seam 2: lists, ranges and chapter lists. A range such as "ORS 418.806 to 418.816" is expanded
// into each section of the ORS section list passed in (spec spec #1, story 26; OregonAI resolves
// such a range to its last section only). The list in each row is a literal chosen for the row, not
// the real snapshot (that comes with #10): it holds sections inside each range, and neighbours
// outside it. Expected links are [kind, target id, measure section].

type Expected = [kind: string, targetId: string, measureSection: string | null];

type Row = {
  name: string;
  /** The document and the lines of its `pdftotext` output the passage is. */
  source: string;
  /** The ORS section list passed in, in the order given. */
  sectionList: string[];
  text: string;
  expected: Expected[];
};

const rows: Row[] = [
  {
    name: "a range in a section that amends a section of the range: each listed section of the range, ends included, in order",
    source: "measure-documents/HB3795/B-Engrossed.pdf, lines 153-157",
    // Handed over in descending order: the expansion comes out ascending all the same.
    sectionList: ["ors-418.817", "ors-418.816", "ors-418.811", "ors-418.808", "ors-418.806", "ors-418.805"],
    text: `SECTION 2. ORS 418.808 is amended to read:

13

418.808. As used in ORS 418.806 to 418.816, “critical incident” means an incident that resulted`,
    expected: [
      ["amends", "ors-418.808", "2"],
      ["cites", "ors-418.806", "2"],
      ["cites", "ors-418.808", "2"],
      ["cites", "ors-418.811", "2"],
      ["cites", "ors-418.816", "2"],
    ],
  },
  {
    name: "added to and made a part of a range of sections (a line number splits the range)",
    source:
      "measure-documents/HB3027/Introduced.pdf, lines 28-33. Statutes Affected Table: 345.010 to 345.340 Add §1 HB 3027",
    sectionList: ["ors-344.990", "ors-345.010", "ors-345.075", "ors-345.100", "ors-345.340", "ors-345.400"],
    text: `SECTION 1. Section 2 of this 2025 Act is added to and made a part of ORS 345.010 to

4
5

345.340.`,
    expected: [
      ["adds-to", "ors-345.010", "1"],
      ["adds-to", "ors-345.075", "1"],
      ["adds-to", "ors-345.100", "1"],
      ["adds-to", "ors-345.340", "1"],
    ],
  },
  {
    name: "the same range named twice gives each section once",
    source: "measure-documents/HB3027/Introduced.pdf, lines 37-49",
    sectionList: ["ors-344.990", "ors-345.010", "ors-345.075", "ors-345.100", "ors-345.340", "ors-345.400"],
    text: `SECTION 2. (1) The Higher Education Coordinating Commission may seek an injunction

7

against a person or career school that is engaged, has engaged or is about to engage in any

8

activity in violation of ORS 345.010 to 345.340 or any rule adopted under the authority of ORS

9

345.010 to 345.340.`,
    expected: [
      ["cites", "ors-345.010", "2"],
      ["cites", "ors-345.075", "2"],
      ["cites", "ors-345.100", "2"],
      ["cites", "ors-345.340", "2"],
    ],
  },
  {
    // Replaces the row "the ends of a range are links even when the section list lacks them": that
    // row pinned an expansion that left the list it was given (#6 F5).
    name: "an end of a range the section list lacks is no link: the expansion stays inside the list",
    source: "measure-documents/SB921/A-Engrossed.pdf, lines 35-39",
    sectionList: ["ors-285a.700"],
    text: `4

SECTION 1. (1) Subject to the provisions of ORS 285A.666 to 285A.732, the Oregon

5`,
    expected: [["cites", "ors-285a.700", "1"]],
  },
  {
    name: "ranges and chapters in one list: 'ORS 279C.800 to 279C.870, 658.005 to 658.245 or 658.405 to 658.511 or ORS chapter 652, 653 or 659A'",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 566-572",
    sectionList: [
      "ors-279c.800",
      "ors-279c.850",
      "ors-279c.870",
      "ors-658.005",
      "ors-658.100",
      "ors-658.245",
      "ors-658.300",
      "ors-658.405",
      "ors-658.450",
      "ors-658.511",
    ],
    text: `(c) To the Bureau of Labor and Industries for the purpose of performing duties under ORS

41

279C.800 to 279C.870, 658.005 to 658.245 or 658.405 to 658.511 or ORS chapter 652, 653 or 659A. The

42`,
    expected: [
      ["cites", "ors-279c.800", null],
      ["cites", "ors-279c.850", null],
      ["cites", "ors-279c.870", null],
      ["cites", "ors-658.005", null],
      ["cites", "ors-658.100", null],
      ["cites", "ors-658.245", null],
      ["cites", "ors-658.405", null],
      ["cites", "ors-658.450", null],
      ["cites", "ors-658.511", null],
      ["cites", "ors-chapter-652", null],
      ["cites", "ors-chapter-653", null],
      ["cites", "ors-chapter-659a", null],
    ],
  },
  {
    name: "'ORS chapters 654, 656 and 731'",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 647-651",
    sectionList: [],
    text: `15

ties under ORS chapters 654, 656 and 731. The information disclosed may include, but is not limited

16`,
    expected: [
      ["cites", "ors-chapter-654", null],
      ["cites", "ors-chapter-656", null],
      ["cites", "ors-chapter-731", null],
    ],
  },
  {
    name: "two ranges and a section, then a chapter: 'ORS 184.610 to 184.665, 184.670 to 184.733 and 805.263, ORS chapter 319'",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 713-719",
    sectionList: [
      "ors-184.610",
      "ors-184.640",
      "ors-184.665",
      "ors-184.670",
      "ors-184.700",
      "ors-184.733",
      "ors-805.263",
    ],
    text: `lating to collection of delinquent and liquidated debts, including taxes, under ORS 184.610 to 184.665,

32

184.670 to 184.733 and 805.263, ORS chapter 319 and the Oregon Vehicle Code, or in auditing or

33`,
    expected: [
      ["cites", "ors-184.610", null],
      ["cites", "ors-184.640", null],
      ["cites", "ors-184.665", null],
      ["cites", "ors-184.670", null],
      ["cites", "ors-184.700", null],
      ["cites", "ors-184.733", null],
      ["cites", "ors-805.263", null],
      ["cites", "ors-chapter-319", null],
    ],
  },
];

describe("lists, ranges and chapter lists", () => {
  test.for(rows)("$name ($source)", ({ sectionList, text, expected }) => {
    const { links } = parseStatuteLinks({ documentKind: "version", text, orsSections: orsSectionList(...sectionList) });
    expect(links.map((link): Expected => [link.kind, link.target.id, link.measureSection])).toEqual(expected);
  });
});
