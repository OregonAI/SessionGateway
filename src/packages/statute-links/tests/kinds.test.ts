import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";

// Seam 2 (test/CLAUDE.md): extracted document text in, Statute Links out. One row per wording
// variant. Each row quotes a passage of a real document as `pdftotext <file>.pdf -` prints it
// (line numbers, wrapped lines and page furniture included), names the document and the lines of
// that output, and gives the expected links as literals: [kind, target id, measure section].
// Documents are under test/fixtures/olis-2025R1/documents/. Where a row cites the Statutes
// Affected Table, the expected link is that table's own row (reports/artables2025R1.pdf).

type Expected = [kind: string, targetId: string, measureSection: string | null];

type Row = {
  name: string;
  /** The document the passage comes from, and which lines of its pdftotext output. */
  source: string;
  text: string;
  expected: Expected[];
};

const kindRows: Row[] = [
  {
    name: "ORS X is amended to read",
    source: "measure-documents/HB3795/A-Engrossed.pdf, lines 28-42. Statutes Affected Table: 409.711 A §1 HB 3795 B",
    text: `2

Relating to human services; amending ORS 409.711.

3

Be It Enacted by the People of the State of Oregon:

4

SECTION 1. ORS 409.711 is amended to read:

5

409.711. (1) The Department of Human Services shall adopt by rule a grant program to provide`,
    expected: [["amends", "ors-409.711", "1"]],
  },
  {
    // No fixture document repeals an ORS section. The wording is ADR-0001's: "ORS 657B.070 is
    // amended to read", "is repealed". The section number is the row's own.
    name: "ORS X is repealed",
    source: "docs/adr/0001-live-session-first-statute-links-from-text.md, paragraph 1 (not a fixture document)",
    text: "SECTION 3. ORS 657B.070 is repealed.",
    expected: [["repeals", "ors-657b.070", "3"]],
  },
  {
    name: "is added to and made a part of ORS chapter X",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 56-62. Statutes Affected Table: Ch. 657B Add §1 SB 69 A",
    text: `5
6

Be It Enacted by the People of the State of Oregon:
SECTION 1. Section 2 of this 2025 Act is added to and made a part of ORS chapter 657B.`,
    expected: [["adds-to", "ors-chapter-657b", "1"]],
  },
  {
    name: "a plain mention is a cite, and a sunset of the Act's own section is no link",
    source: "measure-documents/HB3795/Introduced.pdf, lines 28-48",
    text: `4

SECTION 1. The Department of Human Services shall study human services. The de-

5

partment shall submit a report in the manner provided by ORS 192.245, and may include

6

recommendations for legislation, to the interim committees of the Legislative Assembly re-

7

lated to human services no later than September 15, 2026.

8

SECTION 2. Section 1 of this 2025 Act is repealed on January 2, 2027.`,
    expected: [["cites", "ors-192.245", "1"]],
  },
  {
    name: "plain mentions in a section that amends nothing",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 65-80",
    text: `SECTION 2. Notwithstanding any other provision under this chapter, the Bureau of La-

8

bor and Industries is responsible for administrative and regulatory oversight regarding the

9

requirements under ORS 657B.060, and the provisions of ORS 657B.070 relating to retaliation

10

and discrimination, and shall adopt any rules necessary and proper for the administration

11`,
    expected: [
      ["cites", "ors-657b.060", "2"],
      ["cites", "ors-657b.070", "2"],
    ],
  },
  {
    name: "Section 1 of this Act is repealed on a date: no ORS target, no link",
    source: "measure-documents/SB69/Introduced.pdf, lines 44-48",
    text: `8

SECTION 2. Section 1 of this 2025 Act is repealed on January 2, 2027.`,
    expected: [],
  },
  {
    name: "ORS X, as amended by section N, chapter M, Oregon Laws YYYY, is amended to read",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 154-157. Statutes Affected Table: 659A.159 A §4 SB 69 A",
    text: `21

SECTION 4. ORS 659A.159, as amended by section 8, chapter 20, Oregon Laws 2024, is amended
to read:`,
    expected: [["amends", "ors-659a.159", "4"]],
  },
  {
    name: "as amended by, with the sentence wrapped before 'amended'",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 1384-1387. Statutes Affected Table: 659A.156 A §10 SB 69 A",
    text: `(4) As used in this section, “health care provider” has the meaning given that term in ORS
659A.150.
SECTION 10. ORS 659A.156, as amended by section 16, chapter 20, Oregon Laws 2024, is
amended to read:`,
    expected: [["amends", "ors-659a.156", "10"]],
  },
  {
    name: "an Oregon Laws section amended is no ORS link, and the ORS section it mentions is a cite",
    source: "measure-documents/SB121/Introduced.pdf, lines 20-37",
    text: `Relating to earned income tax credits; amending section 6, chapter 880, Oregon Laws 2007.

3

Be It Enacted by the People of the State of Oregon:

4

SECTION 1. Section 6, chapter 880, Oregon Laws 2007, as amended by section 1, chapter 750,

5

Oregon Laws 2013, and section 32, chapter 579, Oregon Laws 2019, is amended to read:

6

Sec. 6. ORS 315.266 applies to tax years beginning before January 1, [2026] 2032.`,
    expected: [["cites", "ors-315.266", "1"]],
  },
  {
    name: "a subsection is cut back to its section",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 215-253. Statutes Affected Table: 659A.165 A §5 SB 69 A",
    text: `(b) Leave under subsection (1)(b) of this section must be completed within 60 days of the date
on which the eligible employee receives notice of the death of a family member.
SECTION 5. ORS 659A.165, as amended by section 10, chapter 20, Oregon Laws 2024, is
amended to read:

39

659A.165. (1) Except as provided in subsection (2) of this section, a covered employer may re-

40

quire an eligible employee to give the employer written notice at least 30 days before commencing

41

family leave. The employer may require the employee to include an explanation of the need for the

42

leave in the notice.

43
44
45

(2) An eligible employee may commence taking family leave without prior notice under the following circumstances:
(a) An unexpected illness, injury or condition of a child of the employee that requires home care;

[2]

\fA-Eng. SB 69
1

(b) The death of a family member; [or]

2

(c) The leave is for the purpose described under ORS 659A.162 (3)[.]; or`,
    expected: [
      ["amends", "ors-659a.165", "5"],
      ["cites", "ors-659a.162", "5"],
    ],
  },
  {
    name: "a subsection written (1)(b) and a subsection range written (1) to [(4)] (5)",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 1276-1294. Statutes Affected Table: 653.626 A §9 SB 69 A",
    text: `(c) The exclusion of the employee from the workplace under any law or rule that requires the
employer to exclude the employee from the workplace for health reasons.
SECTION 9. ORS 653.626 is amended to read:

39

653.626. (1)(a) If an employee takes more than three consecutive scheduled workdays of sick time

40

for a purpose described in ORS 653.616 (1) to [(4)] (5), an employer may require the employee to

41

provide verification from a health care provider of the need for the sick time, or certification of the

42

need for leave for purposes of ORS 659A.272 as provided in ORS 659A.280.`,
    expected: [
      ["amends", "ors-653.626", "9"],
      ["cites", "ors-653.616", "9"],
      ["cites", "ors-659a.272", "9"],
      ["cites", "ors-659a.280", "9"],
    ],
  },
  {
    name: "text with no SECTION header has no measure section",
    source: "measure-documents/SB69/A-Engrossed.pdf, lines 300-309",
    text: `14

under a uniformly applied policy or practice of the employer. A reduction of family leave under this

15

subsection may not limit leave described in ORS 659A.159 (1)(b).

16`,
    expected: [["cites", "ors-659a.159", null]],
  },
];

function linksOf(text: string): Expected[] {
  const { links } = parseStatuteLinks({ documentKind: "version", text, orsSections: [] });
  return links.map((link): Expected => [link.kind, link.target.id, link.measureSection]);
}

describe("Statute Link kinds in a Version", () => {
  test.for(kindRows)("$name ($source)", ({ text, expected }) => {
    expect(linksOf(text)).toEqual(expected);
  });
});
