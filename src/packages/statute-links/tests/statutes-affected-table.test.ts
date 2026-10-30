import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";

// Where the Statutes Affected Table (documents/reports/artables2025R1.pdf) covers a Measure, the
// expected links are its rows, copied from `pdftotext -layout` of that file: the ORS section, A
// (amends), R (repeals) or Add, and the measure section. Each row here quotes the section header
// of the Version the table's row was made from, as `pdftotext` prints it from the fixture.
// SB 69 A-Engrossed is every row the table lists for SB 69 A.

type Row = {
  /** The table's row, as it prints the ORS section, the letter, the measure section and the measure. */
  tableRow: string;
  /** The Version, and the lines of its pdftotext output. */
  source: string;
  text: string;
  expected: [kind: string, targetId: string, measureSection: string];
};

const rows: Row[] = [
  {
    tableRow: "Ch. 657B Add §1 SB 69 A",
    source: "measure-documents/SB69/A-Engrossed.pdf, line 61",
    text: `SECTION 1. Section 2 of this 2025 Act is added to and made a part of ORS chapter 657B.`,
    expected: ["adds-to", "ors-chapter-657b", "1"],
  },
  {
    tableRow: "657B.070 A §3 SB 69 A",
    source: "measure-documents/SB69/A-Engrossed.pdf, line 90",
    text: `SECTION 3. ORS 657B.070 is amended to read:`,
    expected: ["amends", "ors-657b.070", "3"],
  },
  {
    tableRow: "659A.159 A §4 SB 69 A",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 156-157",
    text: `SECTION 4. ORS 659A.159, as amended by section 8, chapter 20, Oregon Laws 2024, is amended
to read:`,
    expected: ["amends", "ors-659a.159", "4"],
  },
  {
    tableRow: "659A.165 A §5 SB 69 A",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 217-219",
    text: `SECTION 5. ORS 659A.165, as amended by section 10, chapter 20, Oregon Laws 2024, is
amended to read:`,
    expected: ["amends", "ors-659a.165", "5"],
  },
  {
    tableRow: "657B.400 A §6 SB 69 A",
    source: "measure-documents/SB69/A-Engrossed.pdf, line 310",
    text: `SECTION 6. ORS 657B.400 is amended to read:`,
    expected: ["amends", "ors-657b.400", "6"],
  },
  {
    tableRow: "657B.060 A §7 SB 69 A",
    source: "measure-documents/SB69/A-Engrossed.pdf, line 936",
    text: `SECTION 7. ORS 657B.060 is amended to read:`,
    expected: ["amends", "ors-657b.060", "7"],
  },
  {
    tableRow: "653.616 A §8 SB 69 A",
    source: "measure-documents/SB69/A-Engrossed.pdf, line 1190",
    text: `SECTION 8. ORS 653.616 is amended to read:`,
    expected: ["amends", "ors-653.616", "8"],
  },
  {
    tableRow: "653.626 A §9 SB 69 A",
    source: "measure-documents/SB69/A-Engrossed.pdf, line 1278",
    text: `SECTION 9. ORS 653.626 is amended to read:`,
    expected: ["amends", "ors-653.626", "9"],
  },
  {
    tableRow: "659A.156 A §10 SB 69 A",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 1386-1387",
    text: `SECTION 10. ORS 659A.156, as amended by section 16, chapter 20, Oregon Laws 2024, is
amended to read:`,
    expected: ["amends", "ors-659a.156", "10"],
  },
  {
    tableRow: "409.711 A §1 HB 3795 B",
    source: "measure-documents/HB3795/B-Engrossed.pdf, line 36",
    text: `SECTION 1. ORS 409.711 is amended to read:`,
    expected: ["amends", "ors-409.711", "1"],
  },
  {
    tableRow: "418.808 A §2 HB 3795 B",
    source: "measure-documents/HB3795/B-Engrossed.pdf, line 153",
    text: `SECTION 2. ORS 418.808 is amended to read:`,
    expected: ["amends", "ors-418.808", "2"],
  },
  {
    tableRow: "244.120 A §1 SB 983 A",
    source: "measure-documents/SB983/A-Engrossed.pdf, line 34",
    text: `SECTION 1. ORS 244.120 is amended to read:`,
    expected: ["amends", "ors-244.120", "1"],
  },
];

describe("Statute Links agree with the Statutes Affected Table", () => {
  test.for(rows)("$tableRow ($source)", ({ text, expected }) => {
    const { links } = parseStatuteLinks({ documentKind: "version", text, orsSections: [] });
    expect(links.map((link) => [link.kind, link.target.id, link.measureSection])).toEqual([expected]);
  });
});
