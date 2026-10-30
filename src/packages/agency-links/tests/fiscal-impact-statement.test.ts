// Seam 2 (test/CLAUDE.md): a Fiscal Impact Statement's text goes in, Agency Links come out. One row
// per wording variant. Each row quotes the text `pdftotext` prints for a document in
// test/fixtures/olis-2025R1/ and names that document. Expected slugs and units are read off the
// document and the registry rows copied into ./registry.ts, never computed by the code under test.

import { describe, expect, test } from "vitest";
import { fiscalImpactAgencyLinks, type RegistryAgency } from "../index.ts";
import { testRegistry } from "./registry.ts";

type UnitRow = {
  /** The fixture document the lines are quoted from, in a label short enough for a test name. */
  document: string;
  /** What is special about this wording. */
  variant: string;
  /** The document's path under test/fixtures/olis-2025R1/documents/. */
  path: string;
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
        document: "FIS 85869 (HB 3131, Introduced)",
        variant: "one Agency",
        path: "measure-analysis-documents/85869.pdf",
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
        document: "FIS 89095 (HB 3795, A-Engrossed)",
        variant: "one Agency",
        path: "measure-analysis-documents/89095.pdf",
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
        document: "FIS 87631 (SB 921, A-Engrossed)",
        variant: "one Agency",
        path: "measure-analysis-documents/87631.pdf",
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
    ])("$document: $variant", expectUnits);
  });

  describe("several Agencies, the list wrapped onto a second line", () => {
    test.for<UnitRow>([
      {
        document: "FIS 85414 (SB 69, A-Engrossed)",
        variant: "line breaks after a comma",
        path: "measure-analysis-documents/85414.pdf",
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
        document: "FIS 85868 (HB 3027, Introduced)",
        variant: "line breaks inside a name",
        path: "measure-analysis-documents/85868.pdf",
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
    ])("$document: $variant", expectUnits);
  });

  describe("several Agencies on one line", () => {
    test.for<UnitRow>([
      {
        document: "FIS 90573 (SB 121, Introduced)",
        variant: "two Agencies",
        path: "measure-analysis-documents/90573.pdf",
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
        document: "FIS 85476 (SB 64, Introduced)",
        variant: "two Agencies",
        path: "measure-analysis-documents/85476.pdf",
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
    ])("$document: $variant", expectUnits);
  });
  describe("units that are not state agencies stay unresolved", () => {
    test.for<UnitRow>([
      {
        document: "FIS 88044 (SB 983, Introduced)",
        variant: "no unit is a state agency",
        path: "measure-analysis-documents/88044.pdf",
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
        document: "FIS 90573 (SB 121, Introduced)",
        variant: "registry lacks Judicial Department",
        path: "measure-analysis-documents/90573.pdf",
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
    ])("$document: $variant", expectUnits);
  });
  describe("a document with no unit line", () => {
    test("RIS 90375 (SB 121, Introduced): says there is no unit line instead of listing nothing", () => {
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
