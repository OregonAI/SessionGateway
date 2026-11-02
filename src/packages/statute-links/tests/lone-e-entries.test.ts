import { describe, expect, test } from "vitest";
import { parseStatutesAffectedTable } from "../index.ts";
import { statuteLinksOfMeasure, tallyLoneEEntries, type StatuteLinksOfMeasure } from "../measure.ts";
import { heldVersion, link, measureOf, tableOfMeasure, tripleOf } from "./measure-cases.ts";

// Seam 4: which Version a Table entry that ends in an E alone names (ticket #99; ADR-0033, GLOSSARY.md "Table entry"). The
// table's legend gives "E" both as the mark that an emergency clause applies (column 4) and, by its examples, as the level of an
// E-Engrossed Version, and PDF.js's text has no columns, so a row that ends "HB 2052 E" is either. The feed says which Versions a
// Measure has, and an E can be a level only if the Measure has an E-Engrossed Version. The rule is applied where the Versions the
// feed lists are known, and nothing is guessed (ADR-0013's rule):
//  - no E-Engrossed Version listed: the E is the emergency clause of a row at the Introduced Version, and the entry names it;
//  - an E-Engrossed Version listed, held or not: the E is either, and the entry names no Version.
//
// The rows are lines of the PDF.js text of documents/reports/artables2025R1.pdf, as table-entries.test.ts quotes them (lines
// 4153-4158, the foot of page 26 and the head of page 27): "339.990 A §5 HB 2052 E". The 2025R1 feed lists no E-Engrossed Version
// of any Measure (none of its 6,178 MeasureDocuments rows; ADR-0033), so the Versions that make HB 2052 a Measure with one are
// MADE UP, as the E-Engrossed Versions of get-measure-statutes-affected-table-pull.test.ts are. HB 2052's text is not in the
// fixture: its Introduced Version is given the one link the row names, so that the case asks only which Version the row is set
// beside.

const hb2052 = measureOf("HB", 2052);
const row = "339.990 A §5 HB 2052 E";
const introduced = heldVersion(hb2052, "Introduced", { links: [link("amends", "ors-339.990", "5")] });

function versionNamed(result: StatuteLinksOfMeasure, label: string): StatuteLinksOfMeasure["versions"][number] {
  const found = result.versions.find((entry) => entry.version.label === label);
  if (found === undefined)
    throw new Error(`No ${label} Version among ${result.versions.map((v) => v.version.label).join(", ")}`);
  return found;
}

describe("an entry that ends in an E alone", () => {
  test("HB 2052 '339.990 A §5 HB 2052 E', when the feed lists no E-Engrossed Version: the E is the emergency clause, and the entry is compared with the Introduced Version", () => {
    const result = statuteLinksOfMeasure({
      measure: hb2052,
      versions: [introduced],
      amendments: [],
      table: tableOfMeasure(hb2052, [row], ["Introduced"]),
    });

    const table = versionNamed(result, "Introduced").table;
    expect(table?.kind === "compared" ? table.confirmed.map(tripleOf) : table).toEqual([
      ["amends", "ors-339.990", "5"],
    ]);
    expect(result.table?.apart).toEqual([]);
  });

  test("the same row, when the feed lists an E-Engrossed Version of HB 2052: the E may be that Version's level, so the entry names no Version and is set apart", () => {
    const result = statuteLinksOfMeasure({
      measure: hb2052,
      versions: [introduced, heldVersion(hb2052, "E-Engrossed")],
      amendments: [],
      table: tableOfMeasure(hb2052, [row], ["Introduced", "E-Engrossed"]),
    });

    expect(versionNamed(result, "Introduced").table).toBeUndefined();
    expect(versionNamed(result, "E-Engrossed").table).toBeUndefined();
    expect(result.table?.apart.map((entries) => [entries.printed, entries.why, entries.links.map(tripleOf)])).toEqual([
      ["E", { kind: "e_alone_may_be_a_level" }, [["amends", "ors-339.990", "5"]]],
    ]);
  });

  // The listing is the feed's, not the Index's: a Version whose file the worker could not fetch is listed all the same
  // (ADR-0033), so a Measure whose E-Engrossed file did not come is not read as having none.
  test("the same row, when the feed lists an E-Engrossed Version whose file the Index does not hold: the listing says it exists, so the entry still names no Version", () => {
    const result = statuteLinksOfMeasure({
      measure: hb2052,
      versions: [introduced],
      amendments: [],
      table: tableOfMeasure(hb2052, [row], ["Introduced", "E-Engrossed"]),
    });

    expect(versionNamed(result, "Introduced").table).toBeUndefined();
    expect(result.table?.apart.map((entries) => entries.why)).toEqual([{ kind: "e_alone_may_be_a_level" }]);
  });

  // "2.150 A §20 SB 98 B E" (lines 36-46, page 1): a level B and then the emergency clause. That E follows a level, so it is
  // column (4) and nothing else, and the row names the B-Engrossed Version whatever the feed lists. SB 98 is not a Measure of the
  // fixture, so its Versions are given the one link the row names.
  test("SB 98 '2.150 A §20 SB 98 B E' has a level before its E: it names B-Engrossed even when the feed lists an E-Engrossed Version", () => {
    const sb98 = measureOf("SB", 98);
    const versions = [
      heldVersion(sb98, "Introduced"),
      heldVersion(sb98, "B-Engrossed", { links: [link("amends", "ors-2.150", "20")] }),
    ];

    const result = statuteLinksOfMeasure({
      measure: sb98,
      versions,
      amendments: [],
      table: tableOfMeasure(sb98, ["2.150 A §20 SB 98 B E"], ["Introduced", "B-Engrossed", "E-Engrossed"]),
    });

    const table = versionNamed(result, "B-Engrossed").table;
    expect(table?.kind === "compared" ? table.confirmed.map(tripleOf) : table).toEqual([["amends", "ors-2.150", "20"]]);
    expect(result.table?.apart).toEqual([]);
  });
});

// The Build report counts the table's entries that end in an E alone, and of those the ones the rule above leaves naming no
// Version (`lone_e_entries` and `lone_e_with_e_engrossed_version`, ADR-0034), so the operator reads how much of the table the
// feed's listing cannot place. It asks the rule the comparison asks, and is given what the worker knows: which Measures the feed
// lists an E-Engrossed Version of.
describe("the Build report's count of the entries that end in an E alone", () => {
  // Lines 2195-2201 and 4153-4158 of the PDF.js text of documents/reports/artables2025R1.pdf (table-entries.test.ts). Four rows
  // end in an E alone (HB 3944 §8, SB 678 §21, HB 2052 §5 and HB 2187 §1); "SB 83 A E" has a level before its E, and "SB 75 A"
  // and "SB 78" have no E.
  const rows = `215.291 A §8 HB 3944 E
A §2 SB 75 A
A §1 SB 78
A §17 SB 83 A E
A §21 SB 678 E
339.990 A §5 HB 2052 E
R §1 HB 2187 E`;
  const { entries } = parseStatutesAffectedTable({ text: rows, orsSections: [] });

  test("counts the four rows that end in an E alone when the feed lists no E-Engrossed Version of any of their Measures, and none names no Version", () => {
    expect(tallyLoneEEntries(entries, () => false)).toEqual({ entries: 4, namingNoVersion: 0 });
  });

  // MADE UP: the feed lists an E-Engrossed Version of SB 678 and HB 2187 (the 2025R1 feed lists none of any Measure).
  test("counts the rows of a Measure the feed lists an E-Engrossed Version of as naming no Version: SB 678 §21 and HB 2187 §1, and not the others", () => {
    const listsEEngrossed = (measure: { prefix: string; number: number }): boolean =>
      `${measure.prefix} ${String(measure.number)}` === "SB 678" ||
      `${measure.prefix} ${String(measure.number)}` === "HB 2187";

    expect(tallyLoneEEntries(entries, listsEEngrossed)).toEqual({ entries: 4, namingNoVersion: 2 });
  });

  test("does not count a row with a level before its E, whatever the feed lists: SB 83 'A E' names A-Engrossed", () => {
    expect(tallyLoneEEntries(entries, (measure) => measure.prefix === "SB" && measure.number === 83)).toEqual({
      entries: 4,
      namingNoVersion: 0,
    });
  });
});
