// Seam 2 (test/CLAUDE.md): a Fiscal Impact Statement's text goes in, Agency Links come out. One row
// per wording variant. Each row quotes the text `pdftotext` prints for a document in
// test/fixtures/olis-2025R1/ and names that document. Expected slugs and units are read off the
// document and the registry rows copied into ./registry.ts, never computed by the code under test.

import { describe, expect, test } from "vitest";
import { fiscalImpactAgencyLinks, type RegistryAgency } from "../index.ts";
import { testRegistry } from "./registry.ts";

type UnitRow = {
  /** The fixture document the lines are quoted from. */
  source: string;
  /** Lines as `pdftotext` prints them, joined with newlines. */
  text: string;
  /** The registry the extractor is given. */
  registry: readonly RegistryAgency[];
  /** The Agencies the statement names, in the order it lists them, with the unit text as listed. */
  agencies: { slug: string; unit: string }[];
  /** The units the registry does not name, as written and in order. */
  unresolved: string[];
};

describe("Fiscal Impact Statement: Government Unit(s) Affected", () => {
  describe("one Agency", () => {
    test.for<UnitRow>([
      {
        source: "measure-analysis-documents/85869.pdf (Fiscal Impact Statement, HB 3131, Introduced)",
        text: [
          "Bill Title: Relating to the Oregon Agricultural Heritage Fund; declaring an emergency.",
          "Government Unit(s) Affected: Oregon Watershed Enhancement Board",
          "Summary of Fiscal Impact",
          "2025-27 Biennium",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          {
            slug: "oregon-watershed-enhancement-board",
            unit: "Oregon Watershed Enhancement Board",
          },
        ],
        unresolved: [],
      },
      {
        source: "measure-analysis-documents/89095.pdf (Fiscal Impact Statement, HB 3795, A-Engrossed)",
        text: [
          "Bill Title: Relating to human services.",
          "Government Unit(s) Affected: Department of Human Services",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "department-of-human-services", unit: "Department of Human Services" }],
        unresolved: [],
      },
    ])("$source", ({ text, registry, agencies, unresolved }) => {
      expect(fiscalImpactAgencyLinks(text, registry)).toEqual({
        kind: "units",
        links: agencies.map(({ slug, unit }) => ({
          agency: slug,
          evidence: { kind: "fiscal-impact-statement", unit },
        })),
        unresolvedUnits: unresolved,
      });
    });
  });
});
