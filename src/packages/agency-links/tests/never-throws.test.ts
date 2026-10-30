// Property tests (test/CLAUDE.md, "Speed and property tests"): a parser never throws on arbitrary
// text. The real-text tables in the other files stay the oracle for what the extractor returns;
// these only say that no text, however odd, makes an entry point throw or return a link the
// registry could not have produced. Each invariant is read off the registry, not computed the way
// the extractor computes it.

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { fiscalImpactAgencyLinks, testimonyAgencyLinks, textAgencyLinks, type AgencyLink } from "../index.ts";
import { testRegistry } from "./registry.ts";

/** Pieces of the printed forms the extractor reads, mixed with noise, so random text reaches every branch. */
const fragment = fc.oneof(
  fc.string(),
  fc.constantFrom(
    "Government Unit(s) Affected:",
    "Summary of Fiscal Impact",
    "Filed in Office of Secretary of State:",
    "Department of Human Services",
    "Oregon Department of Education",
    "State Treasurer",
    "Legislative Assembly",
    "ODHS",
    "United States ",
    "..................",
    ", Secretary of State",
    "Employ-",
    ",",
    "\n",
    "\n\n",
    "\r\n",
    " ",
    "42",
  ),
);
const text = fc.oneof(
  fc.string({ unit: "binary" }),
  fc.array(fragment, { maxLength: 40 }).map((parts) => parts.join("")),
);

const termsOfRegistry = new Map(testRegistry.map((agency) => [agency.slug, [agency.name, ...agency.aliases]]));

/** An Organization that is a registry name or alias with stray spaces around it, so the link branch runs too. */
const paddedTerm = fc
  .tuple(
    fc.stringMatching(/^ {0,3}$/),
    fc.constantFrom(...[...termsOfRegistry.values()].flat()),
    fc.stringMatching(/^ {0,3}$/),
  )
  .map((parts) => parts.join(""));

function expectFromRegistry(links: readonly AgencyLink[]): void {
  for (const link of links) expect(termsOfRegistry.has(link.agency)).toBe(true);
}

describe("the Agency Link extractor on arbitrary text", () => {
  test.prop([text], { numRuns: 300 })("a Version's text gives links to registry Agencies, each once", (input) => {
    const links = textAgencyLinks(input, testRegistry);
    expectFromRegistry(links);
    expect(new Set(links.map((link) => link.agency)).size).toBe(links.length);
    for (const link of links) {
      if (link.evidence.kind !== "named-in-text") throw new Error("text links carry named-in-text evidence");
      expect(link.evidence.terms.length).toBeGreaterThan(0);
      for (const term of link.evidence.terms) expect(termsOfRegistry.get(link.agency)).toContain(term);
    }
  });

  test.prop([text], { numRuns: 300 })("a Fiscal Impact Statement's text gives one of the three results", (input) => {
    const result = fiscalImpactAgencyLinks(input, testRegistry);
    if (result.kind !== "units") {
      expect(["no-unit-line", "unbounded-unit-line"]).toContain(result.kind);
      return;
    }
    expectFromRegistry(result.links);
    for (const unit of result.unresolvedUnits) expect(unit).toBe(unit.trim());
    for (const unit of result.unresolvedUnits) expect(unit).not.toBe("");
  });

  test.prop([fc.oneof(text, paddedTerm)], { numRuns: 300 })(
    "a Testimony Organization gives at most one link, to the trimmed value",
    (input) => {
      const links = testimonyAgencyLinks(input, testRegistry);
      expect(links.length).toBeLessThanOrEqual(1);
      expectFromRegistry(links);
      for (const link of links) {
        if (link.evidence.kind !== "testimony") throw new Error("Organization links carry testimony evidence");
        expect(link.evidence.organization).toBe(input.trim());
      }
    },
  );
});
