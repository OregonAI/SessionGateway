import { describe, expect, test } from "vitest";
import { statuteLinksOfMeasure, type StatuteLinksOfMeasure, type TableOfVersion } from "../measure.ts";
import { heldVersion, link, measureOf, sb69Links, tableOfMeasure, tripleOf } from "./measure-cases.ts";

// Seam 4: which links the Statutes Affected Table confirms, and where the table and the links disagree (ticket #99;
// ADR-0033, GLOSSARY.md "Confirmed link" and "Table entry"). A Table entry names one Version by its engrossing level, and
// the links read from that Version's text which change the law (amends, repeals, adds-to) are compared with the entries
// that name it: the same kind, the same ORS target and the same measure section. Citations are never compared. No
// database: the Versions the Index holds and the table's rows are the input.
//
// The rows of the table are lines of the PDF.js text of documents/reports/artables2025R1.pdf, as the seam-2 tables quote them
// (table-entries.test.ts), and the parser reads them into entries. The links of a Version are what its text says, taken from
// the seam-1 file that quotes `pdftotext` of the Version (get-measure-statute-links.test.ts). A case that changes the real
// table or the real Version says so, as the seam-1 file of the made-up table does (get-measure-statutes-affected-table-pull.test.ts).

const sb69 = measureOf("SB", 69);
const sb69Listed = ["Introduced", "A-Engrossed", "Enrolled"];

const sb69Versions = [
  heldVersion(sb69, "Introduced", { links: [link("cites", "ors-192.245", "1")] }),
  heldVersion(sb69, "A-Engrossed", { links: sb69Links }),
  heldVersion(sb69, "Enrolled", { links: sb69Links }),
];

// The nine rows the table prints for SB 69, all "SB 69 A": the A-Engrossed Version (table-fixture.test.ts; `pdftotext -layout`
// lines 4022, 4025, 4110, 4129, 4145, 4147, 4180, 4181 and 4183).
const sb69Rows = [
  "653.616 A §8 SB 69 A",
  "653.626 A §9 SB 69 A",
  "Ch. 657B Add §1 SB 69 A",
  "657B.060 A §7 SB 69 A",
  "657B.070 A §3 SB 69 A",
  "657B.400 A §6 SB 69 A",
  "659A.156 A §10 SB 69 A",
  "659A.159 A §4 SB 69 A",
  "659A.165 A §5 SB 69 A",
];

function versionNamed(result: StatuteLinksOfMeasure, label: string): { table: TableOfVersion | undefined } {
  const found = result.versions.find((entry) => entry.version.label === label);
  if (found === undefined)
    throw new Error(`No ${label} Version among ${result.versions.map((v) => v.version.label).join(", ")}`);
  return found;
}

function compared(table: TableOfVersion | undefined): Extract<TableOfVersion, { kind: "compared" }> {
  if (table?.kind !== "compared")
    throw new Error(`expected a table compared with the text, got ${JSON.stringify(table)}`);
  return table;
}

describe("a Table entry that names a Version", () => {
  test("SB 69's nine rows at level A confirm the nine links of the A-Engrossed Version that change the law, and the table and the text disagree nowhere", () => {
    const result = statuteLinksOfMeasure({
      measure: sb69,
      versions: sb69Versions,
      amendments: [],
      table: tableOfMeasure(sb69, sb69Rows, sb69Listed),
    });

    const table = compared(versionNamed(result, "A-Engrossed").table);
    expect(table.confirmed.map(tripleOf)).toEqual([
      ["adds-to", "ors-chapter-657b", "1"],
      ["amends", "ors-657b.070", "3"],
      ["amends", "ors-659a.159", "4"],
      ["amends", "ors-659a.165", "5"],
      ["amends", "ors-657b.400", "6"],
      ["amends", "ors-657b.060", "7"],
      ["amends", "ors-653.616", "8"],
      ["amends", "ors-653.626", "9"],
      ["amends", "ors-659a.156", "10"],
    ]);
    expect(table.onlyInTable).toEqual([]);
    expect(table.onlyInParsedLinks).toEqual([]);
  });

  test("the Introduced and Enrolled Versions of SB 69 are compared with nothing: no row names them", () => {
    const result = statuteLinksOfMeasure({
      measure: sb69,
      versions: sb69Versions,
      amendments: [],
      table: tableOfMeasure(sb69, sb69Rows, sb69Listed),
    });

    expect(versionNamed(result, "Introduced").table).toBeUndefined();
    expect(versionNamed(result, "Enrolled").table).toBeUndefined();
  });

  // HB 3795 -A3 amends ORS 409.711 and 418.808 (spec #1 case (b)). The table prints "409.711 A §1 HB 3795 B" and "418.808 A §2
  // HB 3795 B": the B-Engrossed Version. Its text amends both and also cites 418.808 in SECTION 2 (it names the range 418.806
  // to 418.816), which is a citation: only the amendment is confirmed.
  test("HB 3795's two rows at level B confirm the B-Engrossed Version's two amendments, not its citation of ORS 418.808", () => {
    const hb3795 = measureOf("HB", 3795);
    const versions = [
      heldVersion(hb3795, "Introduced", { links: [link("cites", "ors-192.245", "1")] }),
      heldVersion(hb3795, "B-Engrossed", {
        links: [
          link("amends", "ors-409.711", "1"),
          link("cites", "ors-192.245", "1"),
          link("amends", "ors-418.808", "2"),
          link("cites", "ors-418.806", "2"),
          link("cites", "ors-418.808", "2"),
          link("cites", "ors-418.811", "2"),
        ],
      }),
    ];

    const result = statuteLinksOfMeasure({
      measure: hb3795,
      versions,
      amendments: [],
      table: tableOfMeasure(
        hb3795,
        ["409.711 A §1 HB 3795 B", "418.808 A §2 HB 3795 B"],
        ["Introduced", "B-Engrossed"],
      ),
    });

    const table = compared(versionNamed(result, "B-Engrossed").table);
    expect(table.confirmed.map(tripleOf)).toEqual([
      ["amends", "ors-409.711", "1"],
      ["amends", "ors-418.808", "2"],
    ]);
    expect(table.onlyInTable).toEqual([]);
    expect(table.onlyInParsedLinks).toEqual([]);
    expect(versionNamed(result, "Introduced").table).toBeUndefined();
  });
});

// MADE UP, as get-measure-statutes-affected-table-pull.test.ts makes it up: SB 69's rows, changed one by one. 653.616 is R
// where the real table says A; 657B.070 is §2 where the real table says §3; 659A.150 is a section SB 69 cites (in the range
// 659A.150 to 659A.186) and does not amend; and five of the real rows are left out. The text of the Version is the real one.
describe("a table that disagrees with the text of SB 69's A-Engrossed Version", () => {
  const disagreeingRows = [
    "653.616 R §8 SB 69 A",
    "653.626 A §9 SB 69 A",
    "Ch. 657B Add §1 SB 69 A",
    "657B.070 A §2 SB 69 A",
    "659A.150 A §4 SB 69 A",
    "657B.080 A §5 SB 69 BCC E",
    "657B.090 A §6 SB 69 B",
  ];

  test("names both sides: what only the table has, as the table has it, and what only the text has, as the text has it", () => {
    const result = statuteLinksOfMeasure({
      measure: sb69,
      versions: sb69Versions,
      amendments: [],
      table: tableOfMeasure(sb69, disagreeingRows, sb69Listed),
    });

    const table = compared(versionNamed(result, "A-Engrossed").table);
    expect(table.confirmed.map(tripleOf)).toEqual([
      ["adds-to", "ors-chapter-657b", "1"],
      ["amends", "ors-653.626", "9"],
    ]);
    // The table says 653.616 is repealed in §8, 657B.070 is amended in §2 and 659A.150 is amended in §4; the text does not.
    expect(table.onlyInTable.map(tripleOf)).toEqual([
      ["repeals", "ors-653.616", "8"],
      ["amends", "ors-657b.070", "2"],
      ["amends", "ors-659a.150", "4"],
    ]);
    // The text amends these seven, 653.616 in §8 (which the table says is repealed) and 657B.070 in §3 (which it says is §2) among
    // them, and the table has no entry for them. Neither side is resolved: 653.616 is in both lists, as each source has it.
    expect(table.onlyInParsedLinks.map(tripleOf)).toEqual([
      ["amends", "ors-657b.070", "3"],
      ["amends", "ors-659a.159", "4"],
      ["amends", "ors-659a.165", "5"],
      ["amends", "ors-657b.400", "6"],
      ["amends", "ors-657b.060", "7"],
      ["amends", "ors-653.616", "8"],
      ["amends", "ors-659a.156", "10"],
    ]);
  });

  test("leaves the Version's links as its text has them: the table is beside them, never over them", () => {
    const result = statuteLinksOfMeasure({
      measure: sb69,
      versions: sb69Versions,
      amendments: [],
      table: tableOfMeasure(sb69, disagreeingRows, sb69Listed),
    });

    expect(versionNamed(result, "A-Engrossed")).toMatchObject({ version: { parse: { links: sb69Links } } });
  });

  test("sets the entries that name no Version the Index holds apart: a conference committee's level names none, and B-Engrossed is not held", () => {
    const result = statuteLinksOfMeasure({
      measure: sb69,
      versions: sb69Versions,
      amendments: [],
      table: tableOfMeasure(sb69, disagreeingRows, sb69Listed),
    });

    expect(result.table?.listsMeasure).toBe(true);
    expect(result.table?.apart.map((entries) => [entries.printed, entries.why, entries.links.map(tripleOf)])).toEqual([
      ["BCC", { kind: "level_names_no_version" }, [["amends", "ors-657b.080", "5"]]],
      ["B", { kind: "version_not_held", version: "B-Engrossed" }, [["amends", "ors-657b.090", "6"]]],
    ]);
  });
});

describe("a Version whose text was not read", () => {
  // MADE UP, as get-measure-statutes-affected-table-pull.test.ts makes it up: a B-Engrossed Version of SB 69 whose file is the
  // fixture's scan (Exhibit 288141, a PDF with no text layer), so the Index holds the Version and has read nothing of it.
  test("is not compared: the table's entries for it are listed, because an empty list would read as the text saying nothing", () => {
    const versions = [...sb69Versions, heldVersion(sb69, "B-Engrossed", { read: false })];

    const result = statuteLinksOfMeasure({
      measure: sb69,
      versions,
      amendments: [],
      table: tableOfMeasure(sb69, ["657B.080 A §5 SB 69 B", "657B.090 R §6 SB 69 B"], [...sb69Listed, "B-Engrossed"]),
    });

    const table = versionNamed(result, "B-Engrossed").table;
    expect(table?.kind).toBe("not_compared");
    expect(table?.kind === "not_compared" ? table.entries.map(tripleOf) : undefined).toEqual([
      ["amends", "ors-657b.080", "5"],
      ["repeals", "ors-657b.090", "6"],
    ]);
    expect(result.table?.apart).toEqual([]);
  });
});

describe("a Measure the table has no row for, and an Index with no table", () => {
  // HB 3131 amends no ORS section, and the table prints no row for it.
  test("HB 3131: the table says it does not list the Measure and sets nothing beside its Version", () => {
    const hb3131 = measureOf("HB", 3131);

    const result = statuteLinksOfMeasure({
      measure: hb3131,
      versions: [heldVersion(hb3131, "Introduced")],
      amendments: [],
      table: tableOfMeasure(hb3131, sb69Rows, ["Introduced"]),
    });

    expect(result.table).toMatchObject({ listsMeasure: false, apart: [] });
    expect(versionNamed(result, "Introduced").table).toBeUndefined();
  });

  test("an Index that holds no table has no table of the Measure and none beside any Version", () => {
    const result = statuteLinksOfMeasure({ measure: sb69, versions: sb69Versions, amendments: [], table: undefined });

    expect(result.table).toBeUndefined();
    expect(result.versions.map((entry) => entry.table)).toEqual([undefined, undefined, undefined]);
  });
});
