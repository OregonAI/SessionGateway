import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { madeUpPdf } from "../../../../test/support/made-up-pdf.ts";
import { extractPdfLinks } from "../index.ts";

// Seam 4: the pdf-text entry point `extractPdfLinks` (ticket #126). It reads the link annotations of a PDF as
// { page, url, rect }, page 1-based, rect as PDF.js gives it ([x0, y0, x1, y1] in points, y up from the bottom).
//
// The real case is the fixture's Recording Log of HALNRW 2025-01-22 (CommitteeMeetingDocument 288741). Its expected
// values are what PDF.js's own `getAnnotations()` prints for page 1 of that file, read by hand on 2026-11-05: 19 link
// annotations, the first the "here" of the line "EXHIBITS: Exhibits from this meeting are available here", the
// second the timecode "00:00:03" of "Meeting Called to Order". The made-up cases are MADE UP files (labelled, built
// by test/support/made-up-pdf.ts), because a real log has links only on page 1 of a short list.

const LOG_288741 = new URL(
  "../../../../test/fixtures/olis-2025R1/documents/committee-meeting-documents/288741.pdf",
  import.meta.url,
);

describe("extractPdfLinks on the real Recording Log 288741", () => {
  test("gives the first two links of page 1 with their address and rectangle, as the file holds them", async () => {
    const result = await extractPdfLinks(new Uint8Array(readFileSync(LOG_288741)));

    expect(result.kind).toBe("read");
    if (result.kind !== "read") return;
    expect(result.links.filter((link) => link.page === 1)).toHaveLength(19);
    expect(result.links.slice(0, 2)).toEqual([
      {
        page: 1,
        url: "https://olis.oregonlegislature.gov/liz/2025R1/Committees/HALNRW/2025-01-22-08-00/MeetingMaterials",
        rect: [424.04, 405.98, 451.77, 418.63],
      },
      {
        page: 1,
        url: "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=2025011038&startStreamAt=3",
        rect: [69.75, 250.74, 122.29, 264.54],
      },
    ]);
  });
});

describe("extractPdfLinks on MADE UP files", () => {
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
