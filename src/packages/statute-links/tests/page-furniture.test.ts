import { describe, expect, test } from "vitest";
import { parseStatuteLinks, type StatuteLinkDocumentKind } from "../index.ts";

// Seam 2: the page furniture of Versions and printed amendments (#170). A Version prints its page number ("[4]") at the
// foot of each page and the measure ("HB 4015", "A-Eng. HB 4040") at the head of the next; its first page ends with the
// NOTE on boldfaced and bracketed type and the LC number. An Enrolled bill prints "Enrolled Senate Bill 1507 (SB
// 1507-A) Page 43" at the foot. A printed amendment prints "SA to SB 1544 Page 6" at the foot, and its first page ends
// with "LC 290/SB 1570-5". A citation can run over a page break, so all of it goes before links are read, as the
// proposed amendments' footers do (stored-text.test.ts). Every row quotes the 2026R1 stored text (the PDF.js text the
// store holds, ADR-0010) of the document named, from the page given, with the line-number blocks and the form feed as
// stored; none is in the committed fixture. No statute parse reads a printed amendment today; its rows read it as a
// proposed amendment, whose inserted sections it prints the same way. Expected links are [kind, target id, measure
// section], read from the passage itself; a passage that starts inside a section has no measure section.

type Expected = [kind: string, targetId: string, measureSection: string | null];

type Row = {
  name: string;
  /** The document, its address and the pages the passage is. */
  source: string;
  documentKind: StatuteLinkDocumentKind;
  text: string;
  links: Expected[];
};

const rows: Row[] = [
  {
    name: "HB 4015 Introduced: 'under ORS' / '[4]' and 'HB 4015' / '652.190.' is one citation of ORS 652.190",
    source:
      "2026R1 stored text of version-2026r1-hb4015-introduced (HB 4015 Introduced, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/HB4015/Introduced), pages 4-5; the page number '[4]' ends page 4 and the measure 'HB 4015' heads page 5",
    documentKind: "version",
    text: `(H) Wages of a deceased member paid to a surviving spouse or dependent children under ORS
[4]\fHB 4015
1
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
31
32
33
34
35
36
37
38
39
40
41
42
43
44
45
652.190.`,
    links: [["cites", "ors-652.190", null]],
  },
  {
    name: "HB 4040 A-Engrossed SECTION 44: 'is' / '[34]' and 'A-Eng. HB 4040' / 'amended to read' is an amendment of ORS 656.005",
    source:
      "2026R1 stored text of version-2026r1-hb4040-a-engrossed (HB 4040 A-Engrossed, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/HB4040/A-Engrossed), pages 34-35; the engrossed measure 'A-Eng. HB 4040' heads page 35",
    documentKind: "version",
    text: `SECTION 44. ORS 656.005, as amended by section 22, chapter 78, Oregon Laws 2025, is
[34]\fA-Eng. HB 4040
1
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
31
32
33
34
35
36
37
38
39
40
41
42
43
44
45
amended to read:`,
    links: [["amends", "ors-656.005", "44"]],
  },
  {
    name: "SB 1507 Enrolled SECTION 48 (3)(a): 'ORS chapter' / 'Enrolled Senate Bill 1507 (SB 1507-A) Page 43' / '305, 314, ...' cites seven ORS chapters",
    source:
      "2026R1 stored text of version-2026r1-sb1507-enrolled (SB 1507 Enrolled, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/SB1507/Enrolled), pages 43-44; an Enrolled bill has no line numbers and no page header, only the footer",
    documentKind: "version",
    text: `(3)(a) If a deficiency is assessed against any taxpayer for a tax year beginning before
January 1, 2026, and the deficiency or any portion thereof is attributable to any retroactive
treatment under the amendments to ORS 178.300, 178.375, 305.239, 305.494, 305.690, 305.842,
314.011, 314.306, 315.004, 316.012, 316.147, 316.157, 317.010, 317.097 and 317A.100 by sections 16,
17 and 31 to 44 of this 2026 Act, then any interest or penalty assessed under ORS chapter
Enrolled Senate Bill 1507 (SB 1507-A) Page 43\f305, 314, 315, 316, 317, 317A or 318 with respect to the deficiency or portion thereof shall be
canceled.`,
    links: [
      ["cites", "ors-178.300", null],
      ["cites", "ors-178.375", null],
      ["cites", "ors-305.239", null],
      ["cites", "ors-305.494", null],
      ["cites", "ors-305.690", null],
      ["cites", "ors-305.842", null],
      ["cites", "ors-314.011", null],
      ["cites", "ors-314.306", null],
      ["cites", "ors-315.004", null],
      ["cites", "ors-316.012", null],
      ["cites", "ors-316.147", null],
      ["cites", "ors-316.157", null],
      ["cites", "ors-317.010", null],
      ["cites", "ors-317.097", null],
      ["cites", "ors-317a.100", null],
      ["cites", "ors-chapter-305", null],
      ["cites", "ors-chapter-314", null],
      ["cites", "ors-chapter-315", null],
      ["cites", "ors-chapter-316", null],
      ["cites", "ors-chapter-317", null],
      ["cites", "ors-chapter-317a", null],
      ["cites", "ors-chapter-318", null],
    ],
  },
  {
    name: "SB 1568 A-Engrossed: 'established under ORS' / the first page's NOTE, 'New sections are in boldfaced type.' and 'LC 228' / '413.600' is one citation of ORS 413.600",
    source:
      "2026R1 stored text of version-2026r1-sb1568-a-engrossed (SB 1568 A-Engrossed, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/SB1568/A-Engrossed), pages 1-2; the first page of a Version ends with the NOTE on boldfaced and bracketed type and the LC number",
    documentKind: "version",
    text: `(2) In consultation with the Traditional Health Workers Commission established under ORS
NOTE: Matter in boldfaced type in an amended section is new; matter [italic and bracketed] is existing law to be omitted.
New sections are in boldfaced type.
LC 228\fA-Eng. SB 1568
1
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
31
32
33
34
35
36
37
38
39
40
41
42
43
44
45
413.600, the Oregon Health Authority, for purposes related to the regulation of traditional health
workers, shall adopt by rule:`,
    links: [["cites", "ors-413.600", null]],
  },
  {
    name: "SB 1570 Senate Amendments to Introduced SECTION 2: 'provided by ORS' / 'LC 290/SB 1570-5' / '659A.820.' is one citation of ORS 659A.820",
    source:
      "2026R1 stored text of printed-amendment-2026r1-sb1570-senate-amendments-to-introduced (SB 1570 Senate Amendments to Introduced, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/SB1570/Senate%20Amendments%20to%20Introduced), pages 1-2; a printed amendment's first page ends with its LC number and amendment",
    documentKind: "proposed-amendment",
    text: `“ SECTION 2. (1) As used in this section, ‘health care facility’ means:
“(a) A hospital as defined in ORS 442.015.
“(b) A federally qualified health center as defined in 42 U.S.C. 1396d(l)(2).
“(2) It is an unlawful employment practice for a health care facility to retaliate or take
disciplinary action against an employee of the health care facility because the employee has
distributed informational or educational materials concerning immigrant rights and available
immigration legal services if the materials are published or otherwise made available by a
state agency.
“(3) An employee who alleges a violation of this section may file a complaint with the
Commissioner of the Bureau of Labor and Industries in the manner provided by ORS
LC 290/SB 1570-5\f1
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
659A.820.`,
    links: [
      ["cites", "ors-442.015", "2"],
      ["cites", "ors-659a.820", "2"],
    ],
  },
  {
    name: "SB 1544 Senate Amendments to Introduced SECTION 15: 'set forth in ORS' / 'SA to SB 1544 Page 6' / '319.020 (1)(b) and 319.530 (1)' cites both sections",
    source:
      "2026R1 stored text of printed-amendment-2026r1-sb1544-senate-amendments-to-introduced (SB 1544 Senate Amendments to Introduced, https://olis.oregonlegislature.gov/liz/2026R1/Downloads/MeasureDocument/SB1544/Senate%20Amendments%20to%20Introduced), pages 6-7",
    documentKind: "proposed-amendment",
    text: `“ SECTION 15. ORS 366.506, as amended by sections 11 and 12, chapter 1, Oregon Laws 2025
(special session), is amended to read:
“366.506. (1) Once every two years, the Oregon Department of Administrative Services shall
conduct a highway cost allocation study. The purpose of the study is to determine:
“(a) The proportionate share that the users of each class of vehicle should pay for the costs of
maintenance, operation and improvement of the highways, roads and streets in the state; and
“(b) Whether the users of each class are paying that share.
“(2) Each study must include:
“(a) An examination of the most recent study period for which actual data are available for the
purpose of determining the accuracy of the most recently published study results; and
“(b) An examination of the prospective study period based on projected data for the purpose
described in subsection (1) of this section that incorporates the results of the examination described
in paragraph (a) of this subsection.
“(3) The department may use any study design the department determines will best accomplish
the purposes stated in subsection (1) of this section. In designing the study, the department may
make decisions that include, but are not limited to, the methodology to be used for the study, what
constitutes a class of vehicle for purposes of collection of data under subsections (1) to (5) of this
section and the nature and scope of costs that will be included in the study.
“(4) The department may appoint a study review team to participate in the study required by
subsection (1) of this section. The team may perform any functions assigned by the department, in-
cluding, but not limited to, consulting on the design of the study.
“(5) A report on the results of the study shall be submitted to the legislative revenue committees
and the [Joint Committee on Transportation] committees or interim committees of the Legisla-
tive Assembly related to transportation by January 31 of each odd-numbered year.
“(6) The Legislative Assembly shall use the report described in subsection (5) of this section to
determine whether adjustments to revenue sources described in Article IX, section 3a (3), of the
Oregon Constitution, are needed in order to carry out the purposes of Article IX, section 3a (3), of
the Oregon Constitution. If such adjustments are needed, the Legislative Assembly shall enact
whatever measures are necessary to make the adjustments.
“(7)(a) This subsection applies if:
“(A) The highway cost allocation report indicates that the equity ratio for the heavy vehicle
class or the light vehicle class is at least 1.05; and
“(B) The Legislative Assembly has not complied with subsection (6) of this section within 120
days following the date on which the [Joint Committee on Transportation] committees or interim
committees of the Legislative Assembly related to transportation received the report submitted
under subsection (5) of this section.
“(b)(A) On or after September 1 of each odd-numbered year, the department shall adopt rules
that lower the fee rates per mile set forth in ORS 825.476 or the fuel tax rates set forth in ORS
SA to SB 1544 Page 6\f1
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
31
32
33
34
35
36
37
38
39
40
41
42
43
44
45
319.020 (1)(b) and 319.530 (1) as necessary so that whichever class has an equity ratio of 1.05 or
greater will have an equity ratio of 1.045.`,
    links: [
      ["amends", "ors-366.506", "15"],
      ["cites", "ors-825.476", "15"],
      ["cites", "ors-319.020", "15"],
      ["cites", "ors-319.530", "15"],
    ],
  },
];

describe("a citation over the page break of a Version or a printed amendment", () => {
  test.for(rows)("$name ($source)", ({ documentKind, text, links }) => {
    const parsed = parseStatuteLinks({ documentKind, text, orsSections: [] });
    expect(parsed.links.map((link): Expected => [link.kind, link.target.id, link.measureSection])).toEqual(links);
  });
});
