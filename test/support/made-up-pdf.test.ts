// The made-up PDF helper (`madeUpPdf`, ticket #126 gave it link annotations) read back through the pdf-text package's entry
// point `extractPdfLinks`. EVERY FILE HERE IS MADE UP: its lines and its links are written by this test. The real
// Recording Log read the same way is in src/packages/pdf-text/tests/links.test.ts; the made-up Recording Logs of
// seam 1 (test/tools/get-document-speaker-turns-pull.test.ts) use the helper's links end to end.
import { describe, expect, test } from "vitest";
import { extractPdfLinks } from "#/packages/pdf-text/index.ts";
import { madeUpPdf } from "./made-up-pdf.ts";

describe("extractPdfLinks on files madeUpPdf wrote", () => {
  test("numbers pages from 1 and gives each link its own page", async () => {
    const bytes = madeUpPdf([["page one"], ["page two"]], {
      links: [
        { page: 2, url: "https://example.test/two", rect: [10, 20, 30, 40] },
        { page: 1, url: "https://example.test/one", rect: [1, 2, 3, 4] },
      ],
    });

    const result = await extractPdfLinks(bytes);

    expect(result).toEqual({
      kind: "read",
      links: [
        { page: 1, url: "https://example.test/one", rect: [1, 2, 3, 4] },
        { page: 2, url: "https://example.test/two", rect: [10, 20, 30, 40] },
      ],
    });
  });

  test("a PDF with no link annotation has no links", async () => {
    expect(await extractPdfLinks(madeUpPdf([["no links here"]]))).toEqual({ kind: "read", links: [] });
  });

  test("bytes that are not a PDF come back unreadable", async () => {
    const result = await extractPdfLinks(new TextEncoder().encode("not a pdf"));

    expect(result.kind).toBe("unreadable");
  });
});
