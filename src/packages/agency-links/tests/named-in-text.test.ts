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
});
