import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";

// Seam 2: a repeal list followed by a session-law citation (#55; the gap #22 found in PR #44). Legislative Counsel
// repeals ORS sections and sections of an earlier session's law in one sentence, "ORS A and B and section 9, chapter
// 492, Oregon Laws 2023, are repealed", and every ORS section of the list is repealed by the measure section that holds
// it, whatever citation follows the list. Expected links are [kind, target id, measure section].

type Expected = [kind: string, targetId: string, measureSection: string | null];

function linksOf(text: string): Expected[] {
  const { links } = parseStatuteLinks({ documentKind: "version", text, orsSections: [] });
  return links.map((link): Expected => [link.kind, link.target.id, link.measureSection]);
}

describe("a repeal list followed by a session-law citation", () => {
  test("HB 3723 §1: ORS 247.016 and 247.018 are repealed, with 'section 9, chapter 492, Oregon Laws 2023' after them", () => {
    // measure-documents/HB3723/Introduced.pdf, as the pdf-text package extracts it (the text the store holds): §1 and the
    // header of §2. Statutes Affected Table: 247.016 R §1 HB 3723 E, 247.018 R §1 HB 3723 E, 247.017 A §2 HB 3723 E.
    const text =
      "SECTION 1. ORS 247.016 and 247.018 and section 9, chapter 492, Oregon Laws 2023, are\nrepealed.\nSECTION 2. ORS 247.017 is amended to read:\n";
    expect(linksOf(text)).toEqual([
      ["repeals", "ors-247.016", "1"],
      ["repeals", "ors-247.018", "1"],
      ["amends", "ors-247.017", "2"],
    ]);
  });
});

// No committed fixture or research cache document has a repeal list of more than one ORS section without a citation after
// it, so these sentences are constructed, in Legislative Counsel's wording, and are not quotes.
describe("a repeal list with no session-law citation after it (constructed sentences)", () => {
  test("'ORS A and B are repealed' repeals both", () => {
    expect(linksOf("SECTION 4. ORS 238A.010 and 238A.020 are repealed.")).toEqual([
      ["repeals", "ors-238a.010", "4"],
      ["repeals", "ors-238a.020", "4"],
    ]);
  });

  test("a session-law citation that no repeal follows leaves the ORS sections as citations", () => {
    expect(linksOf("SECTION 4. ORS 238A.010 and section 9, chapter 492, Oregon Laws 2023, apply to a member.")).toEqual(
      [["cites", "ors-238a.010", "4"]],
    );
  });
});
