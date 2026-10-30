import { test } from "@fast-check/vitest";
import fc from "fast-check";
import { describe, expect } from "vitest";
import { parseOrsSectionId } from "#/packages/domain/statute-links.ts";
import type { StatuteLinkDocumentKind } from "../index.ts";
import { parseStatuteLinks } from "../index.ts";
import { orsSectionList } from "./section-ids.ts";

// Seam 2, the two invariants tables cannot enumerate (test/CLAUDE.md, "Speed and property tests").
// The real-text tables stay the oracle: nothing here is built from the parser's own grammar. The
// first property builds a range from an ORS section list and checks it against the list; the
// second feeds the parser anything at all.

type Section = { chapter: number; letter: string; section: number };

const sectionArbitrary = fc.record({
  chapter: fc.integer({ min: 1, max: 838 }),
  letter: fc.constantFrom("", "A", "B", "C"),
  section: fc.integer({ min: 1, max: 9999 }),
});

/** A section as printed ("163A.040") and as OregonAI's id ("ors-163a.040"). */
function printed(section: Section): string {
  return `${section.chapter}${section.letter}.${String(section.section).padStart(3, "0")}`;
}
function idOf(section: Section): string {
  return `ors-${printed(section).toLowerCase()}`;
}

/** ORS order: chapter number, then the chapter's letter ("163" before "163A"), then the section. */
function byOrsOrder(a: Section, b: Section): number {
  return a.chapter - b.chapter || a.letter.localeCompare(b.letter) || a.section - b.section;
}

describe("an expanded range", () => {
  test.prop([fc.uniqueArray(sectionArbitrary, { selector: idOf, minLength: 2, maxLength: 40 }), fc.nat(), fc.nat()], {
    numRuns: 300,
  })("stays inside the section list, sorted, with both ends present", (sections, one, other) => {
    // `sections` is the list as handed over, in whatever order the generator made it.
    const inOrsOrder = [...sections].sort(byOrsOrder);
    const [first = 0, last = 0] = [one % sections.length, other % sections.length].sort((a, b) => a - b);
    const from = inOrsOrder[first];
    const to = inOrsOrder[last];
    if (from === undefined || to === undefined) throw new Error("the generator made an empty list");

    const { links } = parseStatuteLinks({
      documentKind: "version",
      text: `SECTION 1. A person may apply under ORS ${printed(from)} to ${printed(to)} if the person qualifies.`,
      orsSections: orsSectionList(...sections.map(idOf)),
    });
    const expansion = links.map((link) => link.target.id as string);

    const listed = new Set(sections.map(idOf));
    expect(expansion.every((id) => listed.has(id))).toBe(true);
    expect(expansion).toContain(idOf(from));
    expect(expansion).toContain(idOf(to));
    expect(expansion).toEqual(inOrsOrder.slice(first, last + 1).map(idOf));
    expect(links.every((link) => link.kind === "cites" && link.measureSection === "1")).toBe(true);
  });
});

// Pieces of Legislative Counsel's wording and of PDF text, so that random text gets deep into the
// parser. Their order is random: the property is that nothing makes it throw.
const pieces = [
  "ORS ",
  "ORS chapter ",
  "ORS chapters ",
  "657B",
  "659A.159",
  "418.806",
  "418.816",
  " to ",
  ", ",
  " and ",
  " or ",
  "(3)",
  "(1)(b)",
  "[(4)] (5)",
  "SECTION 1. ",
  "SECTION 12a. ",
  "“SECTION 2. ",
  "“",
  "”",
  "”.",
  " is amended to read:",
  " are repealed",
  " is repealed on January 2, 2027.",
  " is added to and made a part of ",
  ", as amended by section 8, chapter 20, Oregon Laws 2024,",
  "In line 2 of the printed bill, ",
  "On page 1 of the printed A-engrossed bill, line 2, ",
  "delete ",
  " and insert ",
  "before the period insert ",
  "after “services” insert ",
  "amending ORS 409.711",
  "Page 13",
  "SB 69-1 1/17/25",
  "Proposed Amendments to SB 69",
  "\n",
  "\n\n12\n\n",
  "\f",
  "-\n",
  " ",
  ".",
  ";",
];

const documentKinds: StatuteLinkDocumentKind[] = ["version", "proposed-amendment"];

describe("the parser", () => {
  test.prop(
    [
      fc.constantFrom(...documentKinds),
      fc.oneof(
        fc.string({ maxLength: 2000 }),
        fc.string({ unit: "binary", maxLength: 2000 }),
        fc.array(fc.constantFrom(...pieces), { maxLength: 200 }).map((parts) => parts.join("")),
      ),
      fc.array(sectionArbitrary, { maxLength: 20 }),
    ],
    { numRuns: 1000 },
  )("never throws on arbitrary text, and every link it returns is well formed", (documentKind, text, sections) => {
    const parsed = parseStatuteLinks({ documentKind, text, orsSections: orsSectionList(...sections.map(idOf)) });
    for (const link of parsed.links) {
      expect(link.measureSection === null || /^\d+[a-z]?$/.test(link.measureSection)).toBe(true);
      if (link.target.type === "section") {
        expect(parseOrsSectionId(link.target.id)).toBe(link.target.id);
        expect(link.target.resolvableOnOregonAi).toBe(true);
      } else {
        expect(link.target.id).toMatch(/^ors-chapter-\d{1,3}[a-z]?$/);
        expect(link.target.resolvableOnOregonAi).toBe(false);
      }
    }
    if (documentKind === "version") expect(parsed.relatingClauseEdits).toEqual([]);
  });
});
