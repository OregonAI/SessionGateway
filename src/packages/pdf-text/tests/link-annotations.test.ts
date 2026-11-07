import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { extractPdfLinks, linkAnnotationsOf, type LinkAnnotation } from "../index.ts";

// Seam 2: the link annotations of a Recording Log as the worker stores them (ticket #160): each link's address and its page,
// in the order the file lists them, and nothing derived. A row reads a real Recording Log of the 2025R1 fixture (#124) through
// `extractPdfLinks` and hands the links to `linkAnnotationsOf`, and quotes what the file holds.
//
// The expected values are read from the raw PDF, not from PDF.js's `getAnnotations()` (the tool under test): the file keeps
// each page's annotations as plain objects, listed by the page's /Annots array, so a script that reads the array's references
// and the /URI(...) of each object prints them (`grep -a "/URI(" <file>.pdf` shows the same addresses). Both files below were
// read that way on 2026-11-06:
// - 307521.pdf, SHS 2025-05-15 (CommitteeMeetingDocument 307521): one page, 26 links. The first is the meeting's materials;
//   the other 25 are player links to event 2025051185, two for each timecode line (one over the timecode, one over the
//   line's text), the second of 542 listed five times because five lines carry that timecode;
// - 307515.pdf, SHS 2025-04-29 (CommitteeMeetingDocument 307515): two pages, 35 links on page 1 and 11 on page 2, 46 in all,
//   the meeting's materials and player links to event 2025041377.

const FIXTURE = "../../../../test/fixtures/olis-2025R1/documents/committee-meeting-documents";

async function annotationsOfFixture(file: string): Promise<LinkAnnotation[]> {
  const result = await extractPdfLinks(new Uint8Array(readFileSync(new URL(`${FIXTURE}/${file}`, import.meta.url))));
  if (result.kind !== "read") throw new Error(`${file} could not be read: ${result.reason}`);
  return linkAnnotationsOf(result.links);
}

const player = (event: string, second: number): string =>
  `https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=${event}&startStreamAt=${String(second)}`;

describe("the link annotations of a real Recording Log", () => {
  test("307521 (SHS 2025-05-15): the page and address of each of its 26 links, in the file's order, and no rectangle", async () => {
    const seconds = [
      1, 1, 2, 2, 42, 42, 43, 43, 370, 370, 484, 484, 485, 485, 486, 486, 526, 526, 542, 542, 542, 542, 542, 572, 572,
    ];

    expect(await annotationsOfFixture("307521.pdf")).toEqual([
      {
        page: 1,
        url: "https://olis.oregonlegislature.gov/liz/2025R1/Committees/SHS/2025-05-15-08-00/MeetingMaterials",
      },
      ...seconds.map((second) => ({ page: 1, url: player("2025051185", second) })),
    ]);
  });

  test("307515 (SHS 2025-04-29): 35 links on page 1 and 11 on page 2, each with the page it is on", async () => {
    const annotations = await annotationsOfFixture("307515.pdf");
    const onPage2 = [230, 230, 230, 327, 327, 341, 341, 379, 379, 844, 844];

    expect(annotations).toHaveLength(46);
    expect(annotations.filter((annotation) => annotation.page === 1)).toHaveLength(35);
    expect(annotations.slice(0, 3)).toEqual([
      {
        page: 1,
        url: "https://olis.oregonlegislature.gov/liz/2025R1/Committees/SHS/2025-04-29-08-45/MeetingMaterials",
      },
      { page: 1, url: player("2025041377", 3) },
      { page: 1, url: player("2025041377", 3) },
    ]);
    expect(annotations.slice(35)).toEqual(onPage2.map((second) => ({ page: 2, url: player("2025041377", second) })));
  });
});
