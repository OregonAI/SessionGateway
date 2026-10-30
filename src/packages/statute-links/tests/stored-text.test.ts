import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";

// Seam 2: the Statute Link parser on the text the store holds. The ingest worker reads a file's stored text (ADR-0015),
// and the store holds what the pdf-text package extracted with PDF.js (ADR-0010), not what `pdftotext` prints. The two
// differ in the page furniture: pdftotext prints the foot of a page on three lines ("SB 69-1 1/17/25", "Proposed
// Amendments to SB 69", "Page 13"), PDF.js on two, the second running the title and the page number together and
// ending in the form feed that begins the next page ("Proposed Amendments to SB 69 Page 13\f1", the 1 being line
// number 1 of the next page). Each row is a passage of the PDF.js text of a Proposed Amendment, extracted with
// `extractPdfText` from the file named, with the passage's line numbers (counting the lines of that text, split at "\n")
// and pasted as a literal; the line-number block that starts each page is part of the text. The expected links are
// [kind, target id, measure section], read from the passage itself. Rows from the gitignored research cache say so.

type Expected = [kind: string, targetId: string, measureSection: string | null];

type Row = {
  name: string;
  /** The file, the extractor and the lines of the extracted text the passage is. */
  source: string;
  text: string;
  links: Expected[];
};

const rows: Row[] = [
  {
    name: "SB 69-1 SECTION 8: 'notwithstanding ORS' / page footer / '659A.270 (1)' is one citation of ORS 659A.270",
    source:
      "PDF.js text (pdf-text package) of proposed-amendments/26284.pdf (SB 69-1), lines 767-811. Statutes Affected Table: 653.616 A §8 SB 69 A",
    text: `“SECTION 8. ORS 653.616 is amended to read:
“653.616. An employee may use sick time earned under ORS 653.606:
“(1) For an employee’s mental or physical illness, injury or health condi-
tion, need for medical diagnosis, care or treatment of a mental or physical
illness, injury or health condition or need for preventive medical care.
“(2) For care of a family member with a mental or physical illness, injury
or health condition, care of a family member who needs medical diagnosis,
care, or treatment of a mental or physical illness, injury or health condition
or care of a family member who needs preventive medical care.
“(3) Notwithstanding ORS 659A.153, for any other purpose specified in
ORS 659A.159.
“(4) For a purpose specified in ORS 659A.272, notwithstanding ORS
SB 69-1 1/17/25
Proposed Amendments to SB 69 Page 13\f1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
659A.270 (1).
“ (5) For a purpose specified in ORS 657B.020.`,
    links: [
      ["amends", "ors-653.616", "8"],
      ["cites", "ors-653.606", "8"],
      ["cites", "ors-659a.153", "8"],
      ["cites", "ors-659a.159", "8"],
      ["cites", "ors-659a.272", "8"],
      ["cites", "ors-659a.270", "8"],
      ["cites", "ors-657b.020", "8"],
    ],
  },
  {
    name: "HB 3544-B8 SECTION 20a: 'as amended by section 20 of this' / page footer / '2025 Act, is amended to read' is an amendment of ORS 540.520. Statutes Affected Table: 540.520 A §20a HB 3544 C",
    source:
      "PDF.js text (pdf-text package) of the research cache's documents-sample-2/CommitteeProposedAmendments_49 (HB 3544-B8, not in the committed fixture), lines 531-565",
    text: `“SECTION 20a. If House Bill 3342 becomes law, section 5, chapter
282, Oregon Laws 2025 (Enrolled House Bill 3342) (amending ORS
540.520), is repealed and ORS 540.520, as amended by section 20 of this
HB 3544-B8 6/26/25
Proposed Amendments to B-Eng. HB 3544 (A to RC) Page 9\f1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
2025 Act, is amended to read:`,
    links: [
      ["cites", "ors-540.520", "20a"],
      ["amends", "ors-540.520", "20a"],
    ],
  },
  {
    name: "SB 947-1 SECTION 16a: 'is added to and made a part of ORS' / page footer / 'chapter 396' adds a section to ORS chapter 396",
    source:
      "PDF.js text (pdf-text package) of the research cache's documents-sample-2/CommitteeProposedAmendments_40 (SB 947-1, not in the committed fixture), lines 839-872",
    text: `“SECTION 16a. ORS 396.128 is added to and made a part of ORS
SB 947-1 3/11/25
Proposed Amendments to SB 947 Page 14\f1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
chapter 396.
“SECTION 17. ORS 396.130 is amended to read:`,
    // The section number being added is named in the text, so it is a mention (cites); the chapter it is added to
    // is the adds-to; SECTION 17 amends ORS 396.130.
    links: [
      ["cites", "ors-396.128", "16a"],
      ["adds-to", "ors-chapter-396", "16a"],
      ["amends", "ors-396.130", "17"],
    ],
  },
];

describe("the text the store holds: a page footer that PDF.js writes on two lines", () => {
  test.for(rows)("$name ($source)", ({ text, links }) => {
    const parsed = parseStatuteLinks({ documentKind: "proposed-amendment", text, orsSections: [] });
    expect(parsed.links.map((link): Expected => [link.kind, link.target.id, link.measureSection])).toEqual(links);
  });
});
