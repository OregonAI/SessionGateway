import { test } from "@fast-check/vitest";
import fc from "fast-check";
import { describe, expect } from "vitest";
import { parseOrsChapterId, parseOrsSectionId } from "#/packages/domain/oregonai.ts";
import { parseStatutesAffectedTable } from "../index.ts";
import { orsSectionList } from "./section-ids.ts";

// Seam 2, the invariant a table cannot enumerate (test/CLAUDE.md, "Speed and property tests"): the parser reads
// anything at all without throwing, and whatever entry it returns is well formed. The text is arbitrary, or a mix of
// pieces of the table's own text (copied from documents/reports/artables2025R1.pdf as PDF.js extracts it) and of
// characters that break them, so that a title, a column head, a series, a page foot and a row meet in orders no
// passage of the real table has.

const pieces = [
  "TABLES - 2025 REGULAR SESSION RS25-T-2\n",
  "ORS SECTIONS AMENDED, REPEALED OR “ADDED TO”\n",
  "OREGON RULES OF CIVIL PROCEDURE (ORCP) AMENDED,\n",
  "(1) (2) (3) (4) (1) (2) (3) (4)\n",
  "653.616 A §8 SB 69 A\n",
  "A §1 SB 1108 A\n",
  "Ch. 657B Add §1 SB 69 A\n",
  "Add §1 SB 1052\n",
  "Ch. 71 to)\n",
  "Ch. 79 ) Add §93a SB 167\n",
  "9.005 to)\n",
  "9.757 ) Add §1 SB 880\n",
  "2.150 A §20 SB 98 B E\n",
  "A §9 HB 2614 BCC E\n",
  "A §21 SB 678 E\n",
  "653.616 A §8 SB 69 B OV E\n",
  "A §1 HB 2001 OVP\n",
  "A §2 SB 121 OV\n",
  "A §3 SB 121 E OV\n",
  "475C.525 ) Add §2 BM 119\n",
  "7B A §115 SB 166 A\n",
  "2013 c. 4 §8 R §14 HB 2931 A\n",
  "8/19/2025",
  "8/19/2025\f",
  "1/19/2025\f",
  "\f",
  "\n",
  " ",
  "     ",
  ")",
  "to)",
  "§",
  "E",
  "A",
  "Add",
  "SB",
  "A §1 SB 99999999999999999999\n",
  "99999999999999999999",
  "ors-1.001",
];

const sectionIds = fc.record({
  chapter: fc.integer({ min: 1, max: 838 }),
  section: fc.integer({ min: 1, max: 9999 }),
});

describe("the table's parser", () => {
  test.prop(
    [
      fc.oneof(
        fc.string({ maxLength: 2000 }),
        fc.string({ unit: "binary", maxLength: 2000 }),
        fc.array(fc.constantFrom(...pieces), { maxLength: 200 }).map((parts) => parts.join("")),
      ),
      fc.array(sectionIds, { maxLength: 20 }),
    ],
    { numRuns: 1000 },
  )("never throws on arbitrary text, and every entry it returns is well formed", (text, sections) => {
    const parsed = parseStatutesAffectedTable({
      text,
      orsSections: orsSectionList(
        ...sections.map(({ chapter, section }) => `ors-${String(chapter)}.${String(section).padStart(3, "0")}`),
      ),
    });
    for (const entry of [...parsed.entries, ...parsed.previousSessionEntries]) {
      expect(entry.measure.prefix).toMatch(/^[A-Z]{2,3}$/);
      expect(Number.isSafeInteger(entry.measure.number)).toBe(true);
      expect(entry.measureSection).toMatch(/^\d+[a-z]?$/);
      expect(["A", "R", "Add"]).toContain(entry.action);
      expect(entry.level === null || /^[A-Z]{1,3}\d?$/.test(entry.level)).toBe(true);
      expect(["OV", "OVP"]).not.toContain(entry.level);
      if (entry.target.type === "section") {
        expect(parseOrsSectionId(entry.target.id)).toBe(entry.target.id);
        expect(entry.target.resolvableOnOregonAi).toBe(true);
      } else {
        expect(parseOrsChapterId(entry.target.id)).toBe(entry.target.id);
        expect(entry.target.resolvableOnOregonAi).toBe(false);
      }
    }
  });
});
