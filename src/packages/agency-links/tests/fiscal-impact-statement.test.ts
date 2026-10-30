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

function expectUnits({ text, registry, agencies, unresolved }: UnitRow): void {
  expect(fiscalImpactAgencyLinks(text, registry)).toEqual({
    kind: "units",
    links: agencies.map(({ slug, unit }) => ({
      agency: slug,
      evidence: { kind: "fiscal-impact-statement", unit },
    })),
    unresolvedUnits: unresolved,
  });
}

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
      {
        // The statement's body then calls the same Agency "OBDD"; the unit line spells it out.
        source: "measure-analysis-documents/87631.pdf (Fiscal Impact Statement, SB 921, A-Engrossed)",
        text: [
          "Bill Title: Relating to shipyards.",
          "Government Unit(s) Affected: Oregon Business Development Department",
          "Summary of Fiscal Impact",
          "2025-27 Biennium",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          {
            slug: "oregon-business-development-department",
            unit: "Oregon Business Development Department",
          },
        ],
        unresolved: [],
      },
    ])("$source", expectUnits);
  });

  describe("several Agencies, the list wrapped onto a second line", () => {
    test.for<UnitRow>([
      {
        source:
          "measure-analysis-documents/85414.pdf (Fiscal Impact Statement, SB 69, A-Engrossed): the line breaks after a comma",
        text: [
          "Bill Title: Relating to laws concerning job-protected leave from work.",
          "Government Unit(s) Affected: Bureau of Labor and Industries, Employment Department, Judicial Department,",
          "Department of Justice",
          "Summary of Fiscal Impact",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          { slug: "bureau-of-labor-and-industries", unit: "Bureau of Labor and Industries" },
          { slug: "employment-department", unit: "Employment Department" },
          { slug: "judicial-department", unit: "Judicial Department" },
          { slug: "department-of-justice", unit: "Department of Justice" },
        ],
        unresolved: [],
      },
      {
        source:
          "measure-analysis-documents/85868.pdf (Fiscal Impact Statement, HB 3027, Introduced): the line breaks inside a name",
        text: [
          "Bill Title: Relating to injunctions regarding career school regulatory violations.",
          "Government Unit(s) Affected: Higher Education Coordinating Commission, Department of Justice, Judicial",
          "Department",
          "Summary of Fiscal Impact",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          {
            slug: "higher-education-coordinating-commission",
            unit: "Higher Education Coordinating Commission",
          },
          { slug: "department-of-justice", unit: "Department of Justice" },
          { slug: "judicial-department", unit: "Judicial Department" },
        ],
        unresolved: [],
      },
    ])("$source", expectUnits);
  });

  describe("several Agencies on one line", () => {
    test.for<UnitRow>([
      {
        source: "measure-analysis-documents/90573.pdf (Fiscal Impact Statement, SB 121, Introduced)",
        text: [
          "Bill Title: Relating to earned income tax credits.",
          "Government Unit(s) Affected: Judicial Department, Department of Revenue",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          { slug: "judicial-department", unit: "Judicial Department" },
          { slug: "department-of-revenue", unit: "Department of Revenue" },
        ],
        unresolved: [],
      },
      {
        source: "measure-analysis-documents/85476.pdf (Fiscal Impact Statement, SB 64, Introduced)",
        text: [
          "Bill Title: Relating to payment of dependent care tax credits in installments; prescribing an effective date.",
          "Government Unit(s) Affected: Department of Human Services, Department of Revenue",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          { slug: "department-of-human-services", unit: "Department of Human Services" },
          { slug: "department-of-revenue", unit: "Department of Revenue" },
        ],
        unresolved: [],
      },
    ])("$source", expectUnits);
  });
  describe("units that are not state agencies stay unresolved", () => {
    test.for<UnitRow>([
      {
        source:
          "measure-analysis-documents/88044.pdf (Fiscal Impact Statement, SB 983, Introduced): no unit is a state agency",
        text: [
          "Bill Title: Relating to the adoption of local budgets.",
          "Government Unit(s) Affected: Cities, Counties, School Districts, Special Districts, Metro, TriMet",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry,
        agencies: [],
        unresolved: ["Cities", "Counties", "School Districts", "Special Districts", "Metro", "TriMet"],
      },
      {
        // The same line as the SB 121 row above, read with a registry that lacks the Judicial
        // Department. A unit the registry does not name stays in the list in its place, and the
        // unit it does name still resolves.
        source:
          "measure-analysis-documents/90573.pdf (Fiscal Impact Statement, SB 121, Introduced): registry without the Judicial Department",
        text: [
          "Bill Title: Relating to earned income tax credits.",
          "Government Unit(s) Affected: Judicial Department, Department of Revenue",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry.filter((agency) => agency.slug !== "judicial-department"),
        agencies: [{ slug: "department-of-revenue", unit: "Department of Revenue" }],
        unresolved: ["Judicial Department"],
      },
    ])("$source", expectUnits);
  });
  describe("a document with no unit line", () => {
    test("a Revenue Impact Statement says so instead of listing nothing", () => {
      // measure-analysis-documents/90375.pdf (Revenue Impact Statement, SB 121, Introduced), lines 1 to 22.
      const text = [
        "REVENUE IMPACT OF",
        "PROPOSED LEGISLATION",
        "",
        "Bill Number:",
        "Revenue Area:",
        "Economist:",
        "Date:",
        "",
        "83rd Oregon Legislative Assembly",
        "2025 Regular Session",
        "Legislative Revenue Office",
        "",
        "SB 121",
        "Personal Income Tax",
        "Kyle Easton",
        "4/10/2025",
        "",
        "Only Impacts on Original or Engrossed",
        "Versions are Considered Official",
        "____________________________________________________________________________________________________",
        "",
        "Measure Description:",
      ].join("\n");
      expect(fiscalImpactAgencyLinks(text, testRegistry)).toEqual({ kind: "no-unit-line" });
    });
  });
});
