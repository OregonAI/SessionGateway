import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { extractPdfLinks } from "../index.ts";

// Seam 4: the pdf-text entry point `extractPdfLinks` (ticket #126). It reads the link annotations of a PDF as
// { page, url, rect }, page 1-based, rect as PDF.js gives it ([x0, y0, x1, y1] in points, y up from the bottom).
//
// The real case is the fixture's Recording Log of HALNRW 2025-01-22 (CommitteeMeetingDocument 288741). Its expected values
// are read from the raw PDF, not from PDF.js's own `getAnnotations()` output, which is the tool under test: the file holds
// its annotations as plain objects, so `grep -a "/Rect" 288741.pdf` prints each link's rectangle and address, for example
//   <</Subtype/Link/Rect[ 424.04 405.98 451.77 418.63] /BS<</W 0>>/F 4/A<</Type/Action/S/URI/URI(https://olis.oregonlegislature.gov/liz/2025R1/Committees/HALNRW/2025-01-22-08-00/MeetingMaterials) >>...>>
//   <</Subtype/Link/Rect[ 69.75 250.74 122.29 264.54] /BS<</W 0>>/F 4/A<</Type/Action/S/URI/URI(https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=2025011038&startStreamAt=3) >>...>>
// The first is the "here" of the line "EXHIBITS: Exhibits from this meeting are available here", the second the timecode
// "00:00:03" of "Meeting Called to Order". The file's three page objects list 19, 77 and 15 annotations in their /Annots arrays
// (111 /Subtype/Link objects in all), which the second case counts from the bytes. The cases on MADE UP files (several
// pages, no link, bytes that are no PDF) are in test/support/made-up-pdf.test.ts, because a package's tests import no `test/` file.

const LOG_288741 = new URL(
  "../../../../test/fixtures/olis-2025R1/documents/committee-meeting-documents/288741.pdf",
  import.meta.url,
);

describe("extractPdfLinks on the real Recording Log 288741", () => {
  test("finds as many links on each page as the file's own /Annots arrays list, and as many in all as it has link objects", async () => {
    const bytes = new Uint8Array(readFileSync(LOG_288741));
    const raw = Buffer.from(bytes).toString("latin1");
    const perPage = [...raw.matchAll(/\/Annots *\[([^\]]*)\]/g)].map(
      (found) => (found[1] ?? "").match(/ R/g)?.length ?? 0,
    );
    const result = await extractPdfLinks(bytes);

    expect(perPage).toEqual([19, 77, 15]);
    expect(raw.match(/\/Subtype\/Link/g)).toHaveLength(111);
    expect(result.kind).toBe("read");
    if (result.kind !== "read") return;
    expect([1, 2, 3].map((page) => result.links.filter((link) => link.page === page).length)).toEqual(perPage);
  });

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
