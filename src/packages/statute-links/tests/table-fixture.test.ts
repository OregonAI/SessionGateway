import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import { extractPdfText } from "#/packages/pdf-text/index.ts";
import { parseStatutesAffectedTable, type StatutesAffectedTableParse } from "../index.ts";

// Seam 2, on the whole of the 2025R1 table: the fixture file (documents/reports/artables2025R1.pdf, the committed
// copy of https://www.oregonlegislature.gov/AutoPubs/artables2025R1.pdf, 64 pages dated 8/19/2025) as the pdf-text
// package extracts it, which is the text the store holds. The rows of table-entries.test.ts are passages of this same
// text; this file asks what the parser makes of all of it.
//
// The counts below are not the parser's: they were counted in the output of `pdftotext -layout` of the same file, a
// different extractor and a different reading of the page, with
//   pdftotext -layout artables2025R1.pdf - | head -n <the last line of page 56> | grep -oP '(?<![A-Za-z])(A|R|Add)\s+§\d' | sort | uniq -c
// (the pages of the ORS table are 1 to 56; page 57 begins the court-rules table). The Add rows are not compared: a
// series ("9.005 to 9.757") is one row of the table and one entry for each section of the series that the ORS section
// list holds, so a count of its entries depends on the list.

const tableFile = new URL(
  "../../../../test/fixtures/olis-2025R1/documents/reports/artables2025R1.pdf",
  import.meta.url,
);

let parsed: StatutesAffectedTableParse;

beforeAll(async () => {
  const extraction = await extractPdfText(readFileSync(tableFile));
  if (extraction.kind !== "read") throw new Error(extraction.reason);
  parsed = parseStatutesAffectedTable({ text: extraction.pdf.text, orsSections: [] });
}, 60_000);

describe("the whole Statutes Affected Table of 2025R1", () => {
  test("every line of its ORS table is read: no line is left over", () => {
    expect(parsed.unreadLines).toEqual([]);
  });

  test("its amendments and repeals are the ones pdftotext -layout counts: 7,020 rows with an A and 937 with an R", () => {
    const count = (action: string): number => parsed.entries.filter((entry) => entry.action === action).length;
    expect([count("A"), count("R")]).toEqual([7020, 937]);
  });

  // The three rows the ticket names, and the six more the table has for SB 69 (it prints them, with their ORS numbers,
  // at 653.616, 653.626, Ch. 657B, 657B.060, 657B.070, 657B.400, 659A.156, 659A.159 and 659A.165: `pdftotext -layout`
  // lines 4022, 4025, 4129, 4145, 4147, 4110, 4180, 4181 and 4183). Each is "SB 69 A": the A-Engrossed Version.
  test("SB 69 has nine rows, among them 653.616 A §8, Ch. 657B Add §1 and 659A.159 A §4, all from the A-Engrossed Version", () => {
    const sb69 = parsed.entries
      .filter((entry) => entry.measure.prefix === "SB" && entry.measure.number === 69)
      .map((entry) => [entry.target.id, entry.action, entry.measureSection, entry.level, entry.emergency]);
    expect(sb69).toEqual([
      ["ors-653.616", "A", "8", "A", false],
      ["ors-653.626", "A", "9", "A", false],
      ["ors-chapter-657b", "Add", "1", "A", false],
      ["ors-657b.060", "A", "7", "A", false],
      ["ors-657b.070", "A", "3", "A", false],
      ["ors-657b.400", "A", "6", "A", false],
      ["ors-659a.156", "A", "10", "A", false],
      ["ors-659a.159", "A", "4", "A", false],
      ["ors-659a.165", "A", "5", "A", false],
    ]);
    expect(sb69).toContainEqual(["ors-653.616", "A", "8", "A", false]);
    expect(sb69).toContainEqual(["ors-chapter-657b", "Add", "1", "A", false]);
    expect(sb69).toContainEqual(["ors-659a.159", "A", "4", "A", false]);
  });

  test("a chapter row is a chapter, which OregonAI has no id for; a section row is a section it has", () => {
    const sb69 = parsed.entries.filter((entry) => entry.measure.prefix === "SB" && entry.measure.number === 69);
    expect(sb69.map((entry) => [entry.target.type, entry.target.resolvableOnOregonAi])).toEqual([
      ["section", true],
      ["section", true],
      ["chapter", false],
      ["section", true],
      ["section", true],
      ["section", true],
      ["section", true],
      ["section", true],
      ["section", true],
    ]);
  });

  // HB 3795 -A3 amends 409.711 and 418.808 (olis-odata.md; `pdftotext -layout` shows "409.711 A §1 HB 3795 B" and
  // "418.808 A §2 HB 3795 B"): its B-Engrossed Version. SB 983's A-Engrossed Version amends 244.120, with an emergency clause.
  test("HB 3795 has 409.711 A §1 and 418.808 A §2 from its B-Engrossed Version, and SB 983 has 244.120 A §1 from its A-Engrossed Version, with an emergency clause", () => {
    const rowsOf = (prefix: string, number: number): unknown[] =>
      parsed.entries
        .filter((entry) => entry.measure.prefix === prefix && entry.measure.number === number)
        .map((entry) => [entry.target.id, entry.action, entry.measureSection, entry.level, entry.emergency]);
    expect(rowsOf("HB", 3795)).toEqual([
      ["ors-409.711", "A", "1", "B", false],
      ["ors-418.808", "A", "2", "B", false],
    ]);
    expect(rowsOf("SB", 983)).toEqual([["ors-244.120", "A", "1", "A", true]]);
  });
});
