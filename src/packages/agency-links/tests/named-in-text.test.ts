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
    ])("$source", expectLinks);
  });
});
