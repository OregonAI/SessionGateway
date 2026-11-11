import { describe, expect, test } from "vitest";
import { parseStatuteLinks, type StatuteLinkDocumentKind } from "../index.ts";

// Seam 2: the history after an ORS section, "ORS X, as amended by <session-law citations>, is amended to read" (#169).
// Legislative Counsel's history names only sections of session laws ("section 7, chapter 292, Oregon Laws 2025", "section
// 3a of this 2026 Act"), so a clause after the history ("applies to a member, and section 9, chapter 492, Oregon Laws
// 2023, is amended") ends it, and the ORS section is a citation, as #111 decided for a repeal list's session-law citation
// (repeal-list-session-law.test.ts). The real rows quote every form of history the 2026R1 stored text and the 2025R1
// fixture and research cache show beyond the plain one (kinds.test.ts has that): a history longer than 400 characters, a
// section named with its subsections, and an Enrolled bill with no chapter number yet. The 2026R1 rows quote the stored
// text (the PDF.js text the store holds, ADR-0010) of the document named, from the page given; the research cache is not
// committed (the Acceptable Use Agreement grants no redistribution license) and not in CI, so its quote is inline, as
// the pdf-text package extracts it. No real document crosses a clause after an ORS section's history, so those rows are
// made up and say so. Expected links are [kind, target id, measure section], read from the passage itself.

type Expected = [kind: string, targetId: string, measureSection: string | null];

type Row = {
  name: string;
  /** The document and the page (2026R1) or the lines of its pdf-text extraction (research cache); "made up" for a constructed sentence. */
  source: string;
  documentKind: StatuteLinkDocumentKind;
  text: string;
  links: Expected[];
};

const rows: Row[] = [
  {
    name: "HB 4040 A-Engrossed SECTION 30: ORS 750.055 with a history of 27 session-law citations, longer than the old 400-character limit, is amended",
    source:
      "2026R1 stored text of version-2026r1-hb4040-a-engrossed (HB 4040 A-Engrossed, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/HB4040/A-Engrossed), page 19; not in the committed fixture",
    documentKind: "version",
    text: `SECTION 30. ORS 750.055, as amended by section 21, chapter 771, Oregon Laws 2013, section
7, chapter 25, Oregon Laws 2014, section 82, chapter 45, Oregon Laws 2014, section 9, chapter 59,
Oregon Laws 2015, section 7, chapter 100, Oregon Laws 2015, section 7, chapter 224, Oregon Laws
2015, section 11, chapter 362, Oregon Laws 2015, section 10, chapter 470, Oregon Laws 2015, section
30, chapter 515, Oregon Laws 2015, section 10, chapter 206, Oregon Laws 2017, section 6, chapter
417, Oregon Laws 2017, section 22, chapter 479, Oregon Laws 2017, section 10, chapter 7, Oregon
Laws 2018, section 69, chapter 13, Oregon Laws 2019, section 38, chapter 151, Oregon Laws 2019,
section 5, chapter 441, Oregon Laws 2019, section 85, chapter 97, Oregon Laws 2021, section 12,
chapter 37, Oregon Laws 2022, section 5, chapter 111, Oregon Laws 2023, section 2, chapter 152,
Oregon Laws 2023, section 4, chapter 24, Oregon Laws 2024, section 5, chapter 35, Oregon Laws
2024, section 22, chapter 70, Oregon Laws 2024, section 163, chapter 73, Oregon Laws 2024, sections
6 and 8, chapter 388, Oregon Laws 2025, section 6, chapter 536, Oregon Laws 2025, and section 19,
chapter 539, Oregon Laws 2025, is amended to read:`,
    links: [["amends", "ors-750.055", "30"]],
  },
  {
    name: "HB 4063 Introduced SECTION 5: 'as amended by section 18 (6)(e), chapter 1, Oregon Laws 2025 (special session)', a history that names a subsection",
    source:
      "2026R1 stored text of version-2026r1-hb4063-introduced (HB 4063 Introduced, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/HB4063/Introduced), page 3; not in the committed fixture",
    documentKind: "version",
    text: `SECTION 5. ORS 803.420, as amended by section 18 (6)(e), chapter 1, Oregon Laws 2025 (special
session), is amended to read:`,
    links: [["amends", "ors-803.420", "5"]],
  },
  {
    name: "HB 4063 Introduced SECTION 6: 'as amended by section 18 (6)(a) to (e), chapter 1, Oregon Laws 2025 (special session)', a history that names a run of subsections",
    source:
      "2026R1 stored text of version-2026r1-hb4063-introduced (HB 4063 Introduced, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/HB4063/Introduced), page 10; not in the committed fixture",
    documentKind: "version",
    text: `SECTION 6. If Ballot Measure ___ (2026) (referring parts of chapter 1, Oregon Laws 2025
(special session)) is approved by the voters at an election held throughout this state, ORS 803.420,
as amended by section 18 (6)(a) to (e), chapter 1, Oregon Laws 2025 (special session), is amended to
read:`,
    links: [["amends", "ors-803.420", "6"]],
  },
  {
    name: "HB 4060 A-Engrossed SECTION 4a: a history that names an Enrolled bill with no chapter number yet ('chapter , Oregon Laws 2026 (Enrolled House Bill 4066)') and 'section 3a of this 2026 Act'",
    source:
      "2026R1 stored text of version-2026r1-hb4060-a-engrossed (HB 4060 A-Engrossed, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/HB4060/A-Engrossed), page 4; not in the committed fixture",
    documentKind: "version",
    text: `SECTION 4a. If House Bill 4066 becomes law, section 4 of this 2026 Act (amending ORS
459.488) is repealed and ORS 459.488, as amended by section 2, chapter 195, Oregon Laws 2025,
section 22, chapter , Oregon Laws 2026 (Enrolled House Bill 4066), and section 3a of
this 2026 Act, is amended to read:`,
    links: [
      ["cites", "ors-459.488", "4a"],
      ["amends", "ors-459.488", "4a"],
    ],
  },
  {
    name: "HB 3038-A9 SECTION 14a: a history that names an Enrolled bill by a blank to fill ('chapter ___, Oregon Laws 2025 (Enrolled House Bill 3083)')",
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_1 (HB 3038-A9, proposed amendments to A-Engrossed House Bill 3038; not in the committed fixture), lines 36-39 of its pdf-text extraction",
    documentKind: "proposed-amendment",
    text: `“SECTION 14a. If House Bill 3083 becomes law, section 14 of this
2025 Act (amending ORS 336.071) is repealed and ORS 336.071, as
amended by section 1, chapter ___, Oregon Laws 2025 (Enrolled House
Bill 3083), is amended to read:`,
    links: [
      ["cites", "ors-336.071", "14a"],
      ["amends", "ors-336.071", "14a"],
    ],
  },
  {
    name: "a history, then a clause that applies the section, then another law that is amended, leaves the ORS section as a citation",
    source: "made up: complete citations, in Legislative Counsel's wording; no real document is quoted",
    documentKind: "version",
    text: "SECTION 4. ORS 238A.010, as amended by section 7, chapter 292, Oregon Laws 2025, applies to a member, and section 9, chapter 492, Oregon Laws 2023, is amended to read:",
    links: [["cites", "ors-238a.010", "4"]],
  },
  {
    name: "a history, 'becomes operative', then a section of this Act that is amended, leaves the ORS section as a citation",
    source: "made up: complete citations, in Legislative Counsel's wording; no real document is quoted",
    documentKind: "version",
    text: "SECTION 5. ORS 1.010, as amended by section 6, chapter 248, Oregon Laws 2023, becomes operative on January 1, 2027, and section 2 of this 2026 Act is amended to read:",
    links: [["cites", "ors-1.010", "5"]],
  },
  {
    name: "'Notwithstanding' an ORS section with a history, then provisions 'that are amended', leaves the ORS section as a citation",
    source: "made up: complete citations, in Legislative Counsel's wording; no real document is quoted",
    documentKind: "version",
    text: "SECTION 6. Notwithstanding ORS 1.010, as amended by section 6, chapter 248, Oregon Laws 2023, the provisions of section 9 of this 2026 Act that are amended remain in effect.",
    links: [["cites", "ors-1.010", "6"]],
  },
  {
    name: "two ORS sections with a history that apply, then two that are amended: only the second pair is amended",
    source: "made up: complete citations, in Legislative Counsel's wording; no real document is quoted",
    documentKind: "version",
    text: "SECTION 7. ORS 1.010 and 1.020, as amended by section 2, chapter 5, Oregon Laws 2024, apply to actions commenced on or after the effective date of this 2026 Act, and ORS 1.030 and 1.040 are amended to read:",
    links: [
      ["cites", "ors-1.010", "7"],
      ["cites", "ors-1.020", "7"],
      ["amends", "ors-1.030", "7"],
      ["amends", "ors-1.040", "7"],
    ],
  },
];

describe("an ORS section's history names only session-law citations", () => {
  test.for(rows)("$name ($source)", ({ documentKind, text, links }) => {
    const parsed = parseStatuteLinks({ documentKind, text, orsSections: [] });
    expect(parsed.links.map((link): Expected => [link.kind, link.target.id, link.measureSection])).toEqual(links);
  });
});
