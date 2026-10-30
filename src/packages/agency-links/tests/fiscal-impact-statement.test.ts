// Seam 2 (test/CLAUDE.md): a Fiscal Impact Statement's text goes in, Agency Links come out. One row
// per wording variant. Each row quotes the text `pdftotext` prints for a document in
// test/fixtures/olis-2025R1/ and names that document. Expected slugs and units are read off the
// document and the registry rows copied into ./registry.ts, never computed by the code under test.
//
// A row whose path says "not in the fixture" quotes a Fiscal Impact Statement from the full local
// 2025R1 cache instead, because no statement in test/fixtures/ shows that wording (the fixture's
// README.md, "Alias coverage", says so for the alias case). The statement is named by the
// MeasureAnalysisId the feed gives for the Measure and Version printed on it. No statement in the
// cache spells "ODHS" in its unit line, so the alias rows use two other aliases the catalog lists.

import { describe, expect, test } from "vitest";
import { fiscalImpactAgencyLinks, type RegistryAgency } from "../index.ts";
import { testAgencyId, testRegistry } from "./registry.ts";

type UnitRow = {
  /** The fixture document the lines are quoted from, in a label short enough for a test name. */
  document: string;
  /** What is special about this wording. */
  variant: string;
  /** The document's path under test/fixtures/olis-2025R1/documents/, or "not in the fixture" and where it was read. */
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

  describe("the Legislative Fiscal Office writes a name without the Oregon the registry puts first", () => {
    test.for<UnitRow>([
      {
        document: "FIS 89975 (SB 302, A-Engrossed)",
        variant: "Department of Education, registry has Oregon Department of Education",
        path: "not in the fixture: cached copy of MeasureAnalysisDocument 89975",
        text: [
          "Bill Title: Relating to kindergarten through grade 12 education.",
          "Government Unit(s) Affected: Department of Education",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "oregon-department-of-education", unit: "Department of Education" }],
        unresolved: [],
      },
      {
        document: "FIS 85624 (HB 2348, Introduced)",
        variant: "one name without Oregon, one with it, the second wrapped",
        path: "not in the fixture: cached copy of MeasureAnalysisDocument 85624",
        text: [
          "Bill Title: Relating to economic development programs.",
          "Government Unit(s) Affected: Housing and Community Services Department, Oregon Business Development",
          "Department",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          {
            slug: "oregon-housing-and-community-services-department",
            unit: "Housing and Community Services Department",
          },
          { slug: "oregon-business-development-department", unit: "Oregon Business Development Department" },
        ],
        unresolved: [],
      },
    ])("$document: $variant", expectUnits);
  });

  describe("an alias the registry lists", () => {
    test.for<UnitRow>([
      {
        document: "FIS 88389 (SB 463, A-Engrossed)",
        variant: "State Treasurer, an alias of Oregon State Treasury",
        path: "not in the fixture: cached copy of MeasureAnalysisDocument 88389",
        text: [
          "Bill Title: Relating to reporting on the soundness of the state's Insurance Fund; prescribing an effective date.",
          "Government Unit(s) Affected: State Treasurer, Department of Administrative Services",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          { slug: "oregon-state-treasury", unit: "State Treasurer" },
          { slug: "department-of-administrative-services", unit: "Department of Administrative Services" },
        ],
        unresolved: [],
      },
      {
        document: "FIS 87807 (SB 907, Introduced)",
        variant: "Oregon Liquor and Cannabis Commission, an alias of Oregon Liquor Control Commission",
        path: "not in the fixture: cached copy of MeasureAnalysisDocument 87807",
        text: [
          "Bill Title: Relating to ownership of premises; prescribing an effective date.",
          "Government Unit(s) Affected: Oregon Health Authority, Oregon Liquor and Cannabis Commission",
          "Summary of Fiscal Impact",
          "2025-27 Biennium",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          { slug: "oregon-health-authority", unit: "Oregon Health Authority" },
          { slug: "oregon-liquor-control-commission", unit: "Oregon Liquor and Cannabis Commission" },
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
        // The registry has a row for the Legislative Assembly, and spec #1 (story 34) keeps the
        // Assembly an unresolved unit all the same. No statement in the fixture lists it.
        document: "FIS 86290 (SCR 10, Introduced)",
        variant: "Legislative Assembly, which the registry has a row for",
        path: "not in the fixture: cached copy of MeasureAnalysisDocument 86290",
        text: [
          "Bill Title: In memoriam: Senate President Peter Courtney, 1943-2024.",
          "Government Unit(s) Affected: Legislative Assembly",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry,
        agencies: [],
        unresolved: ["Legislative Assembly"],
      },
      {
        // The same line, read with a registry that names the row "Oregon Legislative Assembly": the
        // name without Oregon, which the statement prints, must not reach the row either.
        document: "FIS 86290 (SCR 10, Introduced)",
        variant: "the registry row is named Oregon Legislative Assembly",
        path: "not in the fixture: cached copy of MeasureAnalysisDocument 86290",
        text: [
          "Bill Title: In memoriam: Senate President Peter Courtney, 1943-2024.",
          "Government Unit(s) Affected: Legislative Assembly",
          "Summary of Fiscal Impact",
          "The proposed legislation has been determined to have",
        ].join("\n"),
        registry: testRegistry.map((agency) =>
          agency.slug === testAgencyId("legislative-assembly")
            ? { ...agency, name: "Oregon Legislative Assembly" }
            : agency,
        ),
        agencies: [],
        unresolved: ["Legislative Assembly"],
      },
    ])("$document: $variant", expectUnits);
  });

  describe("a unit the registry has no row for stays unresolved", () => {
    // By GLOSSARY.md an Agency is a unit the registry names, so a state body the registry given
    // does not list is an unresolved unit for that registry.
    test.for<UnitRow>([
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
        registry: testRegistry.filter((agency) => agency.slug !== testAgencyId("judicial-department")),
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
