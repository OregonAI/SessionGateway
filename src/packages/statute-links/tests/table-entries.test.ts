import { describe, expect, test } from "vitest";
import { parseStatutesAffectedTable } from "../index.ts";
import { orsSectionList } from "./section-ids.ts";

// Seam 2: the Statutes Affected Table's entries, read from the table's text (ticket #22; ADR-0033). The table is
// Legislative Counsel's artables2025R1.pdf, kept in the fixture as documents/reports/artables2025R1.pdf. The store
// holds its text as the pdf-text package extracts it with PDF.js (ADR-0010), and PDF.js writes the table's two
// columns one after the other, the left column of a page and then its right, so a row that omits the ORS number
// ("continuation row") belongs to the last ORS number above it in the text, whichever column it is in. Each row of
// the tables below is a passage of that extracted text, pasted as a literal with its line numbers (counting the lines
// of the extracted text, split at "\n"; a form feed sits inside the one line that ends a page and begins the next). The expected
// entries are read from the passage by hand: the ORS target, the table's letter (A amends, R repeals, Add adds to),
// the measure section, the Measure and the engrossing level printed beside it.

// The level is the letter printed beside the Measure, null when none is, or "E alone" when the row ends in an E alone,
// which is the emergency clause or the E-Engrossed level and names no Version (ADR-0033).
type Expected = [target: string, action: string, measureSection: string, measure: string, level: string | null];

type Row = {
  name: string;
  /** The file, the extractor and the lines of the extracted text the passage is. */
  source: string;
  text: string;
  /** The ORS section list a series is expanded against. Rows with no series need none. */
  orsSections?: string[];
  entries: Expected[];
  /** The lines of the ORS table the parser could not read. None, unless the row is about a line it cannot read. */
  unread?: string[];
};

function readRow(row: Row): { entries: Expected[]; unread: string[] } {
  const { entries, unreadLines } = parseStatutesAffectedTable({
    text: row.text,
    orsSections: orsSectionList(...(row.orsSections ?? [])),
  });
  return {
    entries: entries.map((entry): Expected => [
      entry.target.id,
      entry.action,
      entry.measureSection,
      `${entry.measure.prefix} ${String(entry.measure.number)}`,
      entry.loneE ? "E alone" : entry.level,
    ]),
    unread: unreadLines,
  };
}

const rows: Row[] = [
  {
    name: "a row, and the continuation rows that omit its ORS number",
    source: "PDF.js text of documents/reports/artables2025R1.pdf, lines 36-46 (page 1)",
    text: `1.851 A §9 HB 3376
2.150 A §20 SB 98 B E
3.012 A §1 SB 95 A E
A §2 SB 95 A E
3.030 A §30 HB 3166
3.050 A §65 SB 166 A
3.260 A §106 SB 163 C
3.300 A §66 SB 166 A
3.450 A §3 HB 2632 A
5.125 A §11 SB 98 B E
8.125 A §2 SB 710 A`,
    entries: [
      ["ors-1.851", "A", "9", "HB 3376", null],
      ["ors-2.150", "A", "20", "SB 98", "B"],
      ["ors-3.012", "A", "1", "SB 95", "A"],
      ["ors-3.012", "A", "2", "SB 95", "A"],
      ["ors-3.030", "A", "30", "HB 3166", null],
      ["ors-3.050", "A", "65", "SB 166", "A"],
      ["ors-3.260", "A", "106", "SB 163", "C"],
      ["ors-3.300", "A", "66", "SB 166", "A"],
      ["ors-3.450", "A", "3", "HB 2632", "A"],
      ["ors-5.125", "A", "11", "SB 98", "B"],
      ["ors-8.125", "A", "2", "SB 710", "A"],
    ],
  },
  {
    name: "SB 69's 653.616 and 653.626: each has a continuation row for another Measure, and the next ORS number ends it",
    source: "PDF.js text of documents/reports/artables2025R1.pdf, lines 7117-7128 (page 45)",
    text: `653.601 A §3 HB 2790
653.606 A §3 HB 2786
A §17 HB 2962
653.616 A §8 SB 69 A
A §1 SB 1108 A
653.626 A §4 HB 2790
A §9 SB 69 A
653.646 A §7 HB 2790
A §1 SB 86
653.651 A §5 HB 2790
653.656 A §6 HB 2790
Ch. 654 Add §1 HB 2314`,
    entries: [
      ["ors-653.601", "A", "3", "HB 2790", null],
      ["ors-653.606", "A", "3", "HB 2786", null],
      ["ors-653.606", "A", "17", "HB 2962", null],
      ["ors-653.616", "A", "8", "SB 69", "A"],
      ["ors-653.616", "A", "1", "SB 1108", "A"],
      ["ors-653.626", "A", "4", "HB 2790", null],
      ["ors-653.626", "A", "9", "SB 69", "A"],
      ["ors-653.646", "A", "7", "HB 2790", null],
      ["ors-653.646", "A", "1", "SB 86", null],
      ["ors-653.651", "A", "5", "HB 2790", null],
      ["ors-653.656", "A", "6", "HB 2790", null],
      ["ors-chapter-654", "Add", "1", "HB 2314", null],
    ],
  },
  {
    name: "a chapter row ('Ch. 657B Add §1 SB 69 A') and the Add row that omits the chapter after it, then repeals and amendments of 657B.010",
    source: "PDF.js text of documents/reports/artables2025R1.pdf, lines 7298-7306 (page 46)",
    text: `657.855 A §69 HB 3348 A
Ch. 657B Add §1 SB 69 A
Add §1 SB 1052
657B.005 R §10 HB 2188
657B.010 A §33 HB 2092 A
R §10 HB 2188
A §31 SB 109
A §3 SB 1052
657B.015 R §10 HB 2188`,
    entries: [
      ["ors-657.855", "A", "69", "HB 3348", "A"],
      ["ors-chapter-657b", "Add", "1", "SB 69", "A"],
      ["ors-chapter-657b", "Add", "1", "SB 1052", null],
      ["ors-657b.005", "R", "10", "HB 2188", null],
      ["ors-657b.010", "A", "33", "HB 2092", "A"],
      ["ors-657b.010", "R", "10", "HB 2188", null],
      ["ors-657b.010", "A", "31", "SB 109", null],
      ["ors-657b.010", "A", "3", "SB 1052", null],
      ["ors-657b.015", "R", "10", "HB 2188", null],
    ],
  },
  {
    name: "a level of three letters (BCC) with an emergency clause",
    source: "PDF.js text of documents/reports/artables2025R1.pdf, lines 1283-1285 (page 9)",
    text: `151.213 A §2 HB 2614 BCC E
A §3 HB 2614 BCC E
151.216 A §4 HB 2296`,
    entries: [
      ["ors-151.213", "A", "2", "HB 2614", "BCC"],
      ["ors-151.213", "A", "3", "HB 2614", "BCC"],
      ["ors-151.216", "A", "4", "HB 2296", null],
    ],
  },
  {
    name: "a measure section lettered 30d, a level and an emergency clause together, a level alone, and a Measure with neither",
    source: "PDF.js text of documents/reports/artables2025R1.pdf, lines 145-148 (page 2)",
    text: `19.235 A §1 SB 98 B E
19.240 A §30d HB 2460 B
19.270 A §3 SB 98 B E
19.450 A §4 SB 98 B E`,
    entries: [
      ["ors-19.235", "A", "1", "SB 98", "B"],
      ["ors-19.240", "A", "30d", "HB 2460", "B"],
      ["ors-19.270", "A", "3", "SB 98", "B"],
      ["ors-19.450", "A", "4", "SB 98", "B"],
    ],
  },
  {
    name: "an E alone after the Measure number ('A §8 HB 3944 E', 'A §21 SB 678 E') is the emergency clause or an E-Engrossed level, and the entry's Version is not known; the next page's rows then begin",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 2195-2201 (the foot of page 14 and the head of page 15), where the date is glued to 'SB 678 E'",
    text: `215.291 A §8 HB 3944 E
A §2 SB 75 A
A §1 SB 78
A §17 SB 83 A E
A §21 SB 678 E8/19/2025\fTABLES - 2025 REGULAR SESSION RS25-T-15
(1) (2) (3) (4) (1) (2) (3) (4)
215.293 A §33 HB 2347 A`,
    entries: [
      ["ors-215.291", "A", "8", "HB 3944", "E alone"],
      ["ors-215.291", "A", "2", "SB 75", "A"],
      ["ors-215.291", "A", "1", "SB 78", null],
      ["ors-215.291", "A", "17", "SB 83", "A"],
      ["ors-215.291", "A", "21", "SB 678", "E alone"],
      ["ors-215.293", "A", "33", "HB 2347", "A"],
    ],
  },
  {
    name: "a series over two lines ('151.211 to)' and '151.221 ) Add ...'), and the Add rows that omit its target, are one entry for each section of the series",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 1276-1280 (page 9); the section list is made up for the row",
    text: `151.211 to)
151.221 ) Add §1 HB 2296
Add §9 HB 2614 BCC E
Add §1 HB 3376
151.211 A §3 HB 2296`,
    orsSections: ["ors-151.211", "ors-151.213", "ors-151.216", "ors-151.219", "ors-151.221", "ors-151.485"],
    entries: [
      ...["ors-151.211", "ors-151.213", "ors-151.216", "ors-151.219", "ors-151.221"].map((id): Expected => [
        id,
        "Add",
        "1",
        "HB 2296",
        null,
      ]),
      ...["ors-151.211", "ors-151.213", "ors-151.216", "ors-151.219", "ors-151.221"].map((id): Expected => [
        id,
        "Add",
        "9",
        "HB 2614",
        "BCC",
      ]),
      ...["ors-151.211", "ors-151.213", "ors-151.216", "ors-151.219", "ors-151.221"].map((id): Expected => [
        id,
        "Add",
        "1",
        "HB 3376",
        null,
      ]),
      ["ors-151.211", "A", "3", "HB 2296", null],
    ],
  },
  {
    name: "a series of chapters ('Ch. 71 to)' and 'Ch. 79 ) Add §93a SB 167') is its two chapters and the chapters of the section list between them",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 488-490 (page 4); the section list is made up for the row",
    text: `Ch. 71 to)
Ch. 79 ) Add §93a SB 167
71.1010 A §1 SB 167`,
    orsSections: ["ors-71.1010", "ors-72.1010", "ors-79.0101"],
    entries: [
      ["ors-chapter-71", "Add", "93a", "SB 167", null],
      ["ors-chapter-72", "Add", "93a", "SB 167", null],
      ["ors-chapter-79", "Add", "93a", "SB 167", null],
      ["ors-71.1010", "A", "1", "SB 167", null],
    ],
  },
  {
    name: "a series of chapters ('Ch. 731 to)' and 'Ch. 750 ) Add §1 HB 2011') takes in the lettered chapters between them in ORS order: 743, then 743A, then 743B",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 8021-8023 (page 50); the section list is made up for the row",
    text: `Ch. 731 to)
Ch. 750 ) Add §1 HB 2011
Add §1 HB 2029 A`,
    orsSections: [
      "ors-750.005",
      "ors-743b.005",
      "ors-743a.010",
      "ors-743.001",
      "ors-731.004",
      "ors-751.010",
      "ors-163a.040",
    ],
    entries: [
      ...["ors-chapter-731", "ors-chapter-743", "ors-chapter-743a", "ors-chapter-743b", "ors-chapter-750"].map(
        (id): Expected => [id, "Add", "1", "HB 2011", null],
      ),
      ...["ors-chapter-731", "ors-chapter-743", "ors-chapter-743a", "ors-chapter-743b", "ors-chapter-750"].map(
        (id): Expected => [id, "Add", "1", "HB 2029", "A"],
      ),
    ],
  },
  {
    name: "a series whose first line ends a page and whose second line begins the next, with the page's date glued to the first",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 1057-1061 (the foot of page 7 and the head of page 8); the section list is made up for the row",
    text: `125.693 A §6 SB 794 A
127.505 to)8/19/2025\fRS25-T-8 TABLES - 2025 REGULAR SESSION
(1) (2) (3) (4) (1) (2) (3) (4)
127.660 ) Add §1 HB 3080
127.505 A §7 HB 3080`,
    orsSections: ["ors-127.505", "ors-127.520", "ors-127.660"],
    entries: [
      ["ors-125.693", "A", "6", "SB 794", "A"],
      ["ors-127.505", "Add", "1", "HB 3080", null],
      ["ors-127.520", "Add", "1", "HB 3080", null],
      ["ors-127.660", "Add", "1", "HB 3080", null],
      ["ors-127.505", "A", "7", "HB 3080", null],
    ],
  },
  {
    name: "the head of the right column opens with a continuation row: it belongs to the last ORS number of the left column",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 650-655 (page 5): the left column ends at 90.320, the right column begins at 'A §6 SB 54'",
    text: `90.315 A §9 HB 2305
90.320 A §1 HB 3378
A §6 SB 54
90.322 A §10 HB 2305
90.323 A §1 HB 2070
A §3 HB 3642`,
    entries: [
      ["ors-90.315", "A", "9", "HB 2305", null],
      ["ors-90.320", "A", "1", "HB 3378", null],
      ["ors-90.320", "A", "6", "SB 54", null],
      ["ors-90.322", "A", "10", "HB 2305", null],
      ["ors-90.323", "A", "1", "HB 2070", null],
      ["ors-90.323", "A", "3", "HB 3642", null],
    ],
  },
  {
    name: "a page opens with a continuation row: it belongs to the last ORS number of the page before, and the page's date is glued to the Measure number of its last row",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 892-897 (the foot of page 6 and the head of page 7): '109.056' is the last ORS number of page 6, and 'A §5 SB 548' is followed by '8/19/2025' with no space",
    text: `109.035 A §6 HB 2439
109.056 A §1 HB 2331
A §3 HB 3968
A §5 SB 5488/19/2025\fTABLES - 2025 REGULAR SESSION RS25-T-7
(1) (2) (3) (4) (1) (2) (3) (4)
A §4 SB 947 A`,
    entries: [
      ["ors-109.035", "A", "6", "HB 2439", null],
      ["ors-109.056", "A", "1", "HB 2331", null],
      ["ors-109.056", "A", "3", "HB 3968", null],
      ["ors-109.056", "A", "5", "SB 548", null],
      ["ors-109.056", "A", "4", "SB 947", "A"],
    ],
  },
  {
    name: "the date at the foot of a page is glued to the Measure number SB 1, and rows that end in an E alone follow on the next page",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 4153-4158 (the foot of page 26 and the head of page 27): 'SB 1' and '8/19/2025' with no space",
    text: `339.866 A §1 SB 1
339.867 A §2 SB 1
339.871 A §3 SB 18/19/2025\fTABLES - 2025 REGULAR SESSION RS25-T-27
(1) (2) (3) (4) (1) (2) (3) (4)
339.990 A §5 HB 2052 E
R §1 HB 2187 E`,
    entries: [
      ["ors-339.866", "A", "1", "SB 1", null],
      ["ors-339.867", "A", "2", "SB 1", null],
      ["ors-339.871", "A", "3", "SB 1", null],
      ["ors-339.990", "A", "5", "HB 2052", "E alone"],
      ["ors-339.990", "R", "1", "HB 2187", "E alone"],
    ],
  },
  {
    name: "the page's title, the explanation of the columns and the column heads are not rows; the first rows after them are",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 1-3 and 24-30 (page 1; the explanation between them is cut)",
    text: `TABLES - 2025 REGULAR SESSION RS25-T-1
ORS SECTIONS AMENDED, REPEALED OR “ADDED TO”
From left to right in the columns of the table below are found:
number.
(4) An “E” if an emergency clause applies to the amendment, repeal or addition.
(1) (2) (3) (4) (1) (2) (3) (4)
1.002 A §6 SB 98 B E
A §1 SB 710 A
1.006 A §7 SB 98 B E
1.012 R §3 SB 200 A E`,
    entries: [
      ["ors-1.002", "A", "6", "SB 98", "B"],
      ["ors-1.002", "A", "1", "SB 710", "A"],
      ["ors-1.006", "A", "7", "SB 98", "B"],
      ["ors-1.012", "R", "3", "SB 200", "A"],
    ],
  },
  {
    name: "the ORS table ends where the next table's title stands: the court-rules rows after it, which look like ORS rows, are not read",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 9015-9018, 9042 and 9049-9052 (the foot of page 56 and the head of page 57; the explanation between is cut)",
    text: `837.374 A §1 HB 3426 A
A §1 SB 1125 B8/19/2025\fTABLES - 2025 REGULAR SESSION RS25-T-57
OREGON RULES OF CIVIL PROCEDURE (ORCP) AMENDED,
REPEALED OR ADDED
(1) (2) (3) (4) (1) (2) (3) (4)
7B A §115 SB 166 A
7C A §116 SB 166 A
7D A §129 SB 164 A
7D A §130 SB 164 A`,
    entries: [
      ["ors-837.374", "A", "1", "HB 3426", "A"],
      ["ors-837.374", "A", "1", "SB 1125", "B"],
    ],
  },
  {
    name: "pdftotext -layout, the left column of each line, with the spacing it prints: a Measure's number runs from 'SB     69 A' to 'HB   3376'",
    source:
      "pdftotext -layout of documents/reports/artables2025R1.pdf, lines 4020-4023 of its output (page 45) and line 51 (page 1), cut at the left column. A labelled extra: the store holds PDF.js's text, in which a row has single spaces",
    text: `653.606       A     §3    HB   2786
              A     §17   HB   2962
653.616       A     §8    SB     69 A
              A     §1    SB   1108 A
1.851       A      §9     HB   3376`,
    entries: [
      ["ors-653.606", "A", "3", "HB 2786", null],
      ["ors-653.606", "A", "17", "HB 2962", null],
      ["ors-653.616", "A", "8", "SB 69", "A"],
      ["ors-653.616", "A", "1", "SB 1108", "A"],
      ["ors-1.851", "A", "9", "HB 3376", null],
    ],
  },
  {
    name: "a series that a ballot measure adds to ('BM 119'), with the Add rows of two Measures that omit it",
    source:
      "PDF.js text of documents/reports/artables2025R1.pdf, lines 6142-6146 (page 39); the section list is made up for the row",
    text: `475C.001 A §46 SB 1111
475C.005 to)
475C.525 ) Add §2 BM 119
Add §31 HB 2464
Add §1 HB 3790`,
    orsSections: ["ors-475c.005", "ors-475c.525"],
    entries: [
      ["ors-475c.001", "A", "46", "SB 1111", null],
      ["ors-475c.005", "Add", "2", "BM 119", null],
      ["ors-475c.525", "Add", "2", "BM 119", null],
      ["ors-475c.005", "Add", "31", "HB 2464", null],
      ["ors-475c.525", "Add", "31", "HB 2464", null],
      ["ors-475c.005", "Add", "1", "HB 3790", null],
      ["ors-475c.525", "Add", "1", "HB 3790", null],
    ],
  },
  {
    name: "pdftotext -layout prints both columns on a line: that line is two rows, not one, and it is left unread, not read as the left row alone",
    source:
      "pdftotext -layout of documents/reports/artables2025R1.pdf, line 3990 of its output (the column heads of page 45) and line 4022 (a row of page 45). A labelled extra: the store holds PDF.js's text, which has one row to a line",
    text: `  (1)         (2)              (3)       (4)                 (1)         (2)               (3)      (4)
653.616       A     §8    SB     69 A                      654.423       R     §19    HB   3778     E`,
    entries: [],
    unread: ["653.616       A     §8    SB     69 A                      654.423       R     §19    HB   3778     E"],
  },
];

describe("the Statutes Affected Table's entries, read from the text the store holds", () => {
  test.for(rows)("$name ($source)", (row) => {
    expect(readRow(row)).toEqual({ entries: row.entries, unread: row.unread ?? [] });
  });
});
