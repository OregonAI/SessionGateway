// Seam 2 (test/CLAUDE.md): the text of a Version or Proposed Amendment goes in, Agency Links come
// out. Each row quotes the text `pdftotext` prints for a document in test/fixtures/olis-2025R1/ and
// names that document. Expected slugs and terms are read off the document and the registry rows
// copied into ./registry.ts, never computed by the code under test.

import { describe, expect, test } from "vitest";
import { textAgencyLinks, type RegistryAgency } from "../index.ts";
import { testRegistry } from "./registry.ts";

type TextRow = {
  /** The fixture document the lines are quoted from. */
  source: string;
  /** Lines as `pdftotext` prints them, joined with newlines. */
  text: string;
  /** The registry the extractor is given. */
  registry: readonly RegistryAgency[];
  /** The Agencies the text names, in the order they first appear, with the terms that named them. */
  agencies: { slug: string; terms: string[] }[];
};

function expectLinks({ text, registry, agencies }: TextRow): void {
  expect(textAgencyLinks(text, registry)).toEqual(
    agencies.map(({ slug, terms }) => ({
      agency: slug,
      evidence: { kind: "named-in-text", terms },
    })),
  );
}

describe("Agencies named in Version and Proposed Amendment text", () => {
  describe("a name, and an alias in the same Digest", () => {
    test.for<TextRow>([
      {
        source:
          "measure-documents/HB3795/Introduced.pdf (HB 3795, Introduced): the Digest says ODHS, the summary the full name",
        text: [
          "Digest: The Act tells ODHS to study human services. (Flesch Readability Score: 82.3).",
          "Requires the Department of Human Services to study human services. Directs the department",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "department-of-human-services", terms: ["ODHS", "Department of Human Services"] }],
      },
    ])("$source", expectLinks);
  });
  describe("several Agencies, and an alias, in one Version", () => {
    test.for<TextRow>([
      {
        source:
          'measure-documents/SB69/A-Engrossed.pdf (SB 69, A-Engrossed): four Agencies in order, "State Treasurer" being an alias of Oregon State Treasury and used with an apostrophe',
        text: [
          "10",
          "",
          "Department of Human Services or the Oregon Health Authority.",
          "",
          "11",
          "",
          "(i) To the State Treasurer useful for the purpose of performing the State Treasurer’s duties un-",
          "",
          "12",
          "",
          "der ORS 98.302 to 98.436, 98.992, 113.235 and 116.253. The information disclosed is confidential and",
          "",
          "13",
          "",
          "may not be used by the State Treasurer for any other purpose. If the information disclosed under",
          "",
          "14",
          "",
          "this paragraph is not prepared for the use of the Employment Department, the costs of disclosing",
          "",
          "15",
          "",
          "the information shall be paid by the State Treasurer.",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          { slug: "department-of-human-services", terms: ["Department of Human Services"] },
          { slug: "oregon-health-authority", terms: ["Oregon Health Authority"] },
          { slug: "oregon-state-treasury", terms: ["State Treasurer"] },
          { slug: "employment-department", terms: ["Employment Department"] },
        ],
      },
      {
        source: "measure-documents/HB3131/Introduced.pdf (HB 3131, Introduced): one Agency named in the summary",
        text: [
          "Digest: The Act gives money to a state agency for uses related to working lands. The Act goes",
          "into effect when the Governor signs it. (Flesch Readability Score: 71.2).",
          "Appropriates moneys to the Oregon Watershed Enhancement Board, out of the General Fund,",
          "for deposit in the Oregon Agricultural Heritage Fund.",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          {
            slug: "oregon-watershed-enhancement-board",
            terms: ["Oregon Watershed Enhancement Board"],
          },
        ],
      },
    ])("$source", expectLinks);
  });

  describe("an alias written beside the full name", () => {
    // Staff Measure Summaries are not Versions, but they are the fixture's text where ODHS is
    // written out as "(ODHS)" (the brief for ticket #7 names both).
    test.for<TextRow>([
      {
        source:
          'measure-analysis-documents/90799.pdf (Staff Measure Summary, SB 64): "Oregon Department of Human Services (ODHS)", then ODHS alone',
        text: [
          "populations. The Oregon Department of Human Services (ODHS) is responsible for performing eligibility",
          "determinations through the Oregon Eligibility Partnership. Federal law allows ODHS to not consider certain types",
          "of household income when determining eligibility for SNAP, such as cash and medical assistance, but other types",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "department-of-human-services", terms: ["Department of Human Services", "ODHS"] }],
      },
      {
        source:
          'measure-analysis-documents/92329.pdf (Staff Measure Summary, HB 3795): "(ODHS)", "ODHS administrative rules"',
        text: [
          "Tax Infrastructure Grant Program",
          "In 2022, the Legislative Assembly passed House Bill 4117, which established the Tax Infrastructure Grant Program",
          "and appropriated $4 million to the Oregon Department of Human Services (ODHS) for the remainder of that",
          "biennium to provide grants to culturally specific organizations, Tribal governments, and under-resourced rural",
          "community service organizations that assisted low-income households in filing tax returns. According to ODHS",
          "administrative rules, the objective of the program is to provide free income tax services and education about",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "department-of-human-services", terms: ["Department of Human Services", "ODHS"] }],
      },
    ])("$source", expectLinks);
  });

  describe("Proposed Amendment text", () => {
    test.for<TextRow>([
      {
        source:
          "proposed-amendments/27966.pdf (HB 3795-1, Proposed Amendment): the Department of Human Services in the text of an amended section",
        text: [
          "“SECTION 1. ORS 409.711 is amended to read:",
          "",
          "5",
          "",
          "“409.711. (1) The Department of Human Services shall adopt by rule a",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "department-of-human-services", terms: ["Department of Human Services"] }],
      },
      {
        source:
          "proposed-amendments/26843.pdf (SB 921-3, Proposed Amendment): an appropriation to the Oregon Business Development Department",
        text: [
          "12",
          "",
          "2025, from the Administrative Services Economic Development Fund,",
          "",
          "13",
          "",
          "to the Oregon Business Development Department, the amount of",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          {
            slug: "oregon-business-development-department",
            terms: ["Oregon Business Development Department"],
          },
        ],
      },
    ])("$source", expectLinks);
  });

  describe("a name that the printed line wraps", () => {
    test.for<TextRow>([
      {
        source:
          "measure-documents/SB69/A-Engrossed.pdf (SB 69, A-Engrossed): the line breaks between the words of a name",
        text: [
          "21",
          "",
          "(a) Is confidential and for the exclusive use and information of the Director of the Employment",
          "Department in administering this chapter;",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "employment-department", terms: ["Employment Department"] }],
      },
      {
        source:
          "measure-documents/SB69/Senate-Amendments-to-Introduced.pdf (Senate Amendments to SB 69): a word hyphenated at the line end, a line number, then the rest of the word",
        text: [
          "“(b) Upon request to the United States Attorney’s Office.",
          "",
          "Under this paragraph, the Employ-",
          "",
          "12",
          "",
          "ment Department may disclose an individual’s employment and wage information in response to a",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "employment-department", terms: ["Employment Department"] }],
      },
      {
        source:
          'measure-documents/SB69/Senate-Amendments-to-Introduced.pdf (Senate Amendments to SB 69): a hyphenated name, then a second name wrapped after "and"',
        text: [
          "43",
          "",
          "information disclosed under this paragraph is not prepared for the use of the Employment Depart-",
          "",
          "44",
          "",
          "ment, the costs of disclosing the information shall be paid by the Department of Consumer and",
          "",
          "45",
          "",
          "Business Services.",
        ].join("\n"),
        registry: testRegistry,
        agencies: [
          { slug: "employment-department", terms: ["Employment Department"] },
          {
            slug: "department-of-consumer-and-business-services",
            terms: ["Department of Consumer and Business Services"],
          },
        ],
      },
    ])("$source", expectLinks);
  });
  describe("words that look like an Agency's name but are not", () => {
    test.for<TextRow>([
      {
        source:
          'measure-documents/SB64/Introduced.pdf (SB 64, Introduced): "the United States Department of Agriculture" is the federal department, not Oregon\'s Department of Agriculture',
        text: [
          "",
          "Be It Enacted by the People of the State of Oregon:",
          "",
          "4",
          "",
          "SECTION 1. (1) No later than 90 days after the effective date of this 2025 Act, the De-",
          "",
          "5",
          "",
          "partment of Human Services shall submit to the United States Department of Agriculture a",
          "",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "department-of-human-services", terms: ["Department of Human Services"] }],
      },
      {
        // The registry has a row for the Legislative Assembly, but every printed Version names the
        // Assembly in its own boilerplate (lines 1, 9 and 15), and spec #1 keeps it an unresolved unit.
        source:
          'measure-documents/HB3795/Introduced.pdf (HB 3795, Introduced): "the Legislative Assembly" in the page header and the summary is ordinary text',
        text: [
          "83rd OREGON LEGISLATIVE ASSEMBLY--2025 Regular Session",
          "",
          "House Bill 3795",
          "Sponsored by COMMITTEE ON EARLY CHILDHOOD AND HUMAN SERVICES (at the request of Representative",
          "Annessa Hartman)",
          "",
          "SUMMARY",
          "The following summary is not prepared by the sponsors of the measure and is not a part of the body thereof subject",
          "to consideration by the Legislative Assembly. It is an editor’s brief statement of the essential features of the",
          "measure as introduced. The statement includes a measure digest written in compliance with applicable readability",
          "standards.",
          "",
          "Digest: The Act tells ODHS to study human services. (Flesch Readability Score: 82.3).",
          "Requires the Department of Human Services to study human services. Directs the department",
          "to submit findings to the interim committees of the Legislative Assembly related to human services",
          "not later than September 15, 2026.",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "department-of-human-services", terms: ["ODHS", "Department of Human Services"] }],
      },
      {
        // The fixture's Versions hold no name inside a longer word, so this row is a committee
        // agenda (text of the same kind, `pdftotext` output of an OLIS document). The registry
        // names the Legislative Revenue Office; the agenda writes the officer's title.
        source:
          'committee-agendas/SFR/2025-04-14-08-00.pdf (Senate Committee On Finance and Revenue agenda): "Legislative Revenue Officer" starts with a registry name',
        text: [
          "Public Hearing and Work Session",
          "SB 120",
          "Requires the Legislative Revenue Officer to study tax expenditures.",
          "Public Hearing",
        ].join("\n"),
        registry: testRegistry,
        agencies: [],
      },
    ])("$source", expectLinks);
  });
});
