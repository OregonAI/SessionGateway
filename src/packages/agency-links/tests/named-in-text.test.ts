// Seam 2 (test/CLAUDE.md): the text of a Version or Proposed Amendment goes in, Agency Links come
// out. Each row quotes the text `pdftotext` prints for a document in test/fixtures/olis-2025R1/ and
// names that document. Expected slugs and terms are read off the document and the registry rows
// copied into ./registry.ts, never computed by the code under test.

import { describe, expect, test } from "vitest";
import { textAgencyLinks, type RegistryAgency } from "../index.ts";
import { testRegistry } from "./registry.ts";

type TextRow = {
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
        document: "HB 3795 Introduced",
        variant: "Digest says ODHS, summary the name",
        path: "measure-documents/HB3795/Introduced.pdf",
        text: [
          "Digest: The Act tells ODHS to study human services. (Flesch Readability Score: 82.3).",
          "Requires the Department of Human Services to study human services. Directs the department",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "department-of-human-services", terms: ["ODHS", "Department of Human Services"] }],
      },
    ])("$document: $variant", expectLinks);
  });
  describe("several Agencies, and an alias, in one Version", () => {
    test.for<TextRow>([
      {
        document: "SB 69 A-Engrossed",
        variant: "four Agencies, one by an alias",
        path: "measure-documents/SB69/A-Engrossed.pdf",
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
        document: "HB 3131 Introduced",
        variant: "one Agency in the summary",
        path: "measure-documents/HB3131/Introduced.pdf",
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
    ])("$document: $variant", expectLinks);
  });

  describe("an alias written beside the full name", () => {
    // Staff Measure Summaries are not Versions, but they are the fixture's text where the Agency's
    // name is followed by "(ODHS)".
    test.for<TextRow>([
      {
        document: "SMS 90799 (SB 64)",
        variant: '"(ODHS)" beside the full name',
        path: "measure-analysis-documents/90799.pdf",
        text: [
          "populations. The Oregon Department of Human Services (ODHS) is responsible for performing eligibility",
          "determinations through the Oregon Eligibility Partnership. Federal law allows ODHS to not consider certain types",
          "of household income when determining eligibility for SNAP, such as cash and medical assistance, but other types",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "department-of-human-services", terms: ["Department of Human Services", "ODHS"] }],
      },
      {
        document: "SMS 92329 (HB 3795)",
        variant: '"(ODHS)" and "ODHS rules"',
        path: "measure-analysis-documents/92329.pdf",
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
    ])("$document: $variant", expectLinks);
  });

  describe("Proposed Amendment text", () => {
    test.for<TextRow>([
      {
        document: "Proposed Amendment HB 3795-1",
        variant: "name in an amended section",
        path: "proposed-amendments/27966.pdf",
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
        document: "Proposed Amendment SB 921-3",
        variant: "an appropriation to an Agency",
        path: "proposed-amendments/26843.pdf",
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
    ])("$document: $variant", expectLinks);
  });

  describe("a name that the printed line wraps", () => {
    test.for<TextRow>([
      {
        document: "SB 69 A-Engrossed",
        variant: "line breaks inside a name",
        path: "measure-documents/SB69/A-Engrossed.pdf",
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
        document: "SB 69 Senate Amendments",
        variant: "hyphen, line number, rest of word",
        path: "measure-documents/SB69/Senate-Amendments-to-Introduced.pdf",
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
        document: "SB 69 Senate Amendments",
        variant: 'hyphenated name, then "and" wrap',
        path: "measure-documents/SB69/Senate-Amendments-to-Introduced.pdf",
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
    ])("$document: $variant", expectLinks);
  });
  describe("words that look like an Agency's name but are not", () => {
    test.for<TextRow>([
      {
        document: "SB 64 Introduced",
        variant: '"United States Department of..."',
        path: "measure-documents/SB64/Introduced.pdf",
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
        document: "HB 3795 Introduced",
        variant: '"Legislative Assembly" boilerplate',
        path: "measure-documents/HB3795/Introduced.pdf",
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
        document: "SFR agenda 2025-04-14",
        variant: '"Legislative Revenue Officer"',
        path: "committee-agendas/SFR/2025-04-14-08-00.pdf",
        text: [
          "Public Hearing and Work Session",
          "SB 120",
          "Requires the Legislative Revenue Officer to study tax expenditures.",
          "Public Hearing",
        ].join("\n"),
        registry: testRegistry,
        agencies: [],
      },
    ])("$document: $variant", expectLinks);
  });

  describe("the Secretary of State in an Enrolled Version's filing block is not a link", () => {
    // Every Enrolled Version ends with the filing block: "Filed in Office of Secretary of State:"
    // and the Secretary of State's signature line. The registry has a row for the Secretary of
    // State, but the block says nothing about the Measure.
    test.for<TextRow>([
      {
        document: "SB 983 Enrolled",
        variant: "filing block, lines 53 to 82",
        path: "measure-documents/SB983/Enrolled.pdf",
        text: [
          "Passed by Senate May 15, 2025",
          "",
          "Received by Governor:",
          "........................M.,........................................................., 2025",
          "",
          "..................................................................................",
          "Obadiah Rutledge, Secretary of Senate",
          "",
          "Approved:",
          "........................M.,........................................................., 2025",
          "",
          "..................................................................................",
          "Rob Wagner, President of Senate",
          "Passed by House June 17, 2025",
          "",
          "..................................................................................",
          "Tina Kotek, Governor",
          "Filed in Office of Secretary of State:",
          "",
          "..................................................................................",
          "Julie Fahey, Speaker of House",
          "",
          "........................M.,........................................................., 2025",
          "",
          "..................................................................................",
          "Tobias Read, Secretary of State",
          "",
          "Enrolled Senate Bill 983 (SB 983-A)",
          "",
          "Page 2",
        ].join("\n"),
        registry: testRegistry,
        agencies: [],
      },
      {
        // pdftotext reads this page's two columns in another order, so the filing label and the
        // signature line are further apart than in SB 983.
        document: "HB 3795 Enrolled",
        variant: "filing block, lines 62 to 91",
        path: "measure-documents/HB3795/Enrolled.pdf",
        text: [
          "Passed by House April 14, 2025",
          "",
          "Received by Governor:",
          "",
          "Repassed by House June 16, 2025",
          "",
          "........................M.,........................................................., 2025",
          "Approved:",
          "",
          "..................................................................................",
          "Timothy G. Sekerak, Chief Clerk of House",
          "",
          "..................................................................................",
          "Julie Fahey, Speaker of House",
          "",
          "........................M.,........................................................., 2025",
          "",
          "..................................................................................",
          "Tina Kotek, Governor",
          "Filed in Office of Secretary of State:",
          "",
          "Passed by Senate June 11, 2025",
          "........................M.,........................................................., 2025",
          "..................................................................................",
          "Rob Wagner, President of Senate",
          "",
          "Enrolled House Bill 3795 (HB 3795-B)",
          "",
          "..................................................................................",
          "Tobias Read, Secretary of State",
        ].join("\n"),
        registry: testRegistry,
        agencies: [],
      },
    ])("$document: $variant", expectLinks);
  });

  describe("the Secretary of State named in the text is a link", () => {
    // The fixture's Versions name the Secretary of State only in the filing block. An agenda's
    // summary of SB 224 is the fixture's text where the Secretary of State is named in prose.
    test.for<TextRow>([
      {
        document: "HRULES agenda 2025-06-09",
        variant: "Secretary of State in a sentence",
        path: "committee-agendas/HRULES/2025-06-09-08-30.pdf",
        text: [
          "SB 224 A",
          "Prohibits the Secretary of State from publishing the residence address of certain individuals who",
          "are affiliated with apolitical committee on the electronic filing system maintained by the",
          "secretary.",
        ].join("\n"),
        registry: testRegistry,
        agencies: [{ slug: "secretary-of-state", terms: ["Secretary of State"] }],
      },
    ])("$document: $variant", expectLinks);
  });
});
