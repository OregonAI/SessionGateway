import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";
import { orsSectionList } from "./section-ids.ts";

// Seam 2: a Proposed Amendment is read for what it says itself (ADR-0001, spec #1 story 28): the
// Statute Links in the sections it inserts, and its edits to the relating clause. What it deletes
// from the Version it amends is never worked out. Each row quotes a fixture Proposed Amendment as
// `pdftotext <file>.pdf -` prints it (documents/proposed-amendments/<ProposedAmendmentId>.pdf). Expected
// links are [kind, target id, measure section]; the section numbers are the amendment's own.

type Expected = [kind: string, targetId: string, measureSection: string | null];

type RelatingClauseEdit = { deleted: string | null; inserted: string; insertedSections: string[] };

type Row = {
  name: string;
  /** The document and the lines of its `pdftotext` output the passage is. */
  source: string;
  sectionList?: string[];
  text: string;
  links: Expected[];
  relatingClauseEdits: RelatingClauseEdit[];
};

const rows: Row[] = [
  {
    name: "SB 69-1: inserted sections are read, and the relating clause edit is an edit, not a set of links",
    source: "proposed-amendments/26284.pdf (SB 69-1), lines 1-66",
    text: `SB 69-1
(LC 1368)
1/17/25 (JAS/ps)
Requested by SENATE COMMITTEE ON LABOR AND BUSINESS

PROPOSED AMENDMENTS TO
SENATE BILL 69
1

In line 2 of the printed bill, before the period insert “; creating new pro-

2

visions; amending ORS 653.616, 653.626, 657B.060, 657B.070, 657B.400,

3

659A.156, 659A.159 and 659A.165; and prescribing an effective date”.

4

Delete lines 4 through 9 and insert:

5

“SECTION 1. Section 2 of this 2025 Act is added to and made a part

6

of ORS chapter 657B.

7

“SECTION 2. Notwithstanding any other provision under this

8

chapter, the Bureau of Labor and Industries is responsible for admin-

9

istrative and regulatory oversight regarding the requirements under

10

ORS 657B.060, and the provisions of ORS 657B.070 relating to retali-

11

ation and discrimination, and shall adopt any rules necessary and

12

proper for the administration of those sections.

13

“SECTION 3. ORS 657B.070 is amended to read:

14

“657B.070. (1) It is an unlawful employment practice for an employer to:

15

“(a) Violate ORS 657B.060.`,
    links: [
      ["adds-to", "ors-chapter-657b", "1"],
      ["cites", "ors-657b.060", "2"],
      ["cites", "ors-657b.070", "2"],
      ["amends", "ors-657b.070", "3"],
      ["cites", "ors-657b.060", "3"],
    ],
    relatingClauseEdits: [
      {
        deleted: null,
        inserted:
          "; creating new provisions; amending ORS 653.616, 653.626, 657B.060, 657B.070, 657B.400, 659A.156, 659A.159 and 659A.165; and prescribing an effective date",
        insertedSections: [
          "ors-653.616",
          "ors-653.626",
          "ors-657b.060",
          "ors-657b.070",
          "ors-657b.400",
          "ors-659a.156",
          "ors-659a.159",
          "ors-659a.165",
        ],
      },
    ],
  },
  {
    name: "HB 3795-1: an edit that inserts '; amending ORS 409.711' after a word of the title, and the section that amends it",
    source: "proposed-amendments/27966.pdf (HB 3795-1), lines 1-169. Statutes Affected Table: 409.711 A §1 HB 3795 B",
    text: `HB 3795-1
(LC 1688)
3/31/25 (RH/ps)
Requested by HOUSE COMMITTEE ON EARLY CHILDHOOD AND HUMAN SERVICES (at the
request of Representative Annessa Hartman)

PROPOSED AMENDMENTS TO
HOUSE BILL 3795
1
2

In line 2 of the printed bill, after “services” insert “; amending ORS
409.711”.

3

Delete lines 4 through 8 and insert:

4

“SECTION 1. ORS 409.711 is amended to read:

5

“409.711. (1) The Department of Human Services shall adopt by rule a

6

grant program to provide funding for the purposes described in subsections

7

(2) and (3) of this section to culturally specific and responsive organizations,

8

tribal governments and under-resourced rural community service organiza-

9

tions.

10

“(2) Grants must be used to help low-income residents of this state by:

11

“(a) Providing education about federal earned income tax credits and

12

other tax benefits available to low-income individuals;

13

“(b) Assisting residents in navigating tax systems; and

14

“(c) Filing income tax returns.

15

“(3) The grants must be used to:

16

“(a) Strengthen the existing network of culturally specific and responsive

17

tax preparation organizations;

18

“(b) Expand organizational capacity in geographically diverse areas of

19

this state to improve access to tax navigation and tax preparation services;

20

“(c) Improve the recruitment and retention of qualified tax preparers;

21

“(d) Strengthen the technology resources and training systems available

\f1

to tax preparers and volunteers; or

2

“(e) Strengthen taxpayer outreach, education and connections to commu-

3

nities by culturally specific and responsive tax navigation and preparation

4

service providers.

5

“(4) The department shall appoint a committee to advise the department

6

in the adoption of rules for the program. The advisory committee must in-

7

clude one or more individuals who:

8

“(a) Are low income.

9

“(b) Are Black.

10

“(c) Are Indigenous.

11

“(d) Are people of color.

12

“(e) Are non-English-speaking.

13

“(f) Have a disability.

14

“(g) Are 65 years of age or older.

15

“ (5) The department shall submit an annual report, in the manner

16

provided in ORS 192.245, to the committees or interim committees of

17

the Legislative Assembly related to human services on the grant pro-

18

gram established under this section.”.

19

HB 3795-1 3/31/25
Proposed Amendments to HB 3795

Page 2`,
    links: [
      ["amends", "ors-409.711", "1"],
      ["cites", "ors-192.245", "1"],
    ],
    relatingClauseEdits: [{ deleted: null, inserted: "; amending ORS 409.711", insertedSections: ["ors-409.711"] }],
  },
  {
    name: "HB 3795-A3: an edit that inserts a bare section number, 'and 418.808', and a section that amends it and cites a range",
    source: "proposed-amendments/28997.pdf (HB 3795-A3), lines 1-83. Statutes Affected Table: 418.808 A §2 HB 3795 B",
    sectionList: ["ors-418.805", "ors-418.806", "ors-418.808", "ors-418.811", "ors-418.816", "ors-418.817"],
    text: `HB 3795-A3
(LC 1688)
4/29/25 (LAS/ps)
Requested by Senator GELSER BLOUIN

PROPOSED AMENDMENTS TO
A-ENGROSSED HOUSE BILL 3795
1
2

On page 1 of the printed A-engrossed bill, line 2, before the period insert
“and 418.808”.

3

On page 2, after line 12, insert:

4

“SECTION 2. ORS 418.808 is amended to read:

5

“418.808. As used in ORS 418.806 to 418.816, ‘critical incident’ means an

6

incident that resulted in the death of a child if the Department of Human

7

Services reasonably believes the death was the result of child abuse and:

8

“(1) The child was in the custody of the department at the time of death;

9

“(2) The child, the child’s sibling or any other child living in the house-

10

hold with the child was the subject of a child protective services assessment

11

by the department within the 12 months preceding the fatality;

12

“(3) The child, the child’s sibling or any other child living in the house-

13

hold with the child had a pending child welfare or adoption case with the

14

department within the 12 months preceding the fatality; or

15

“(4) The child, the child’s sibling or any other child living in the house-

16

hold with the child was the subject of a report of suspected abuse or neglect

17

made to the department or a law enforcement agency within the 12 months

18

preceding the fatality, whether or not the report was closed at screening

19

without an investigation being commenced.”.

20`,
    links: [
      ["amends", "ors-418.808", "2"],
      ["cites", "ors-418.806", "2"],
      ["cites", "ors-418.808", "2"],
      ["cites", "ors-418.811", "2"],
      ["cites", "ors-418.816", "2"],
    ],
    relatingClauseEdits: [{ deleted: null, inserted: "and 418.808", insertedSections: ["ors-418.808"] }],
  },
  {
    name: "SB 983-1: a relating clause edit that names no statute, and an inserted section that cites none",
    source: "proposed-amendments/28716.pdf (SB 983-1), lines 1-31",
    text: `SB 983-1
(LC 784)
4/3/25 (DJ/wjc/ps)
Requested by Senator JAMA

PROPOSED AMENDMENTS TO
SENATE BILL 983
1
2

On page 1 of the printed bill, line 2, after “244.120” insert “; and declaring
an emergency”.

3

On page 2, after line 8, insert:

4

“SECTION 2. This 2025 Act being necessary for the immediate

5

preservation of the public peace, health and safety, an emergency is

6

declared to exist, and this 2025 Act takes effect on its passage.”.

7`,
    links: [],
    relatingClauseEdits: [{ deleted: null, inserted: "; and declaring an emergency", insertedSections: [] }],
  },
  {
    name: "SB 921-2: no relating clause edit, and a range in an inserted section",
    source: "proposed-amendments/26824.pdf (SB 921-2), lines 1-73",
    sectionList: ["ors-285a.700"],
    text: `SB 921-2
(LC 3562)
3/12/25 (STN/ps)
Requested by Senator SMITH DB

PROPOSED AMENDMENTS TO
SENATE BILL 921
1

Delete lines 4 through 9 of the printed bill and insert:

2

“SECTION 1. (1) Subject to the provisions of ORS 285A.666 to

3

285A.732, the Oregon Infrastructure Finance Authority may approve,

4

and enter into a loan contract based upon, a project by the Oregon

5

International Port of Coos Bay for the repair of marine ways at the

6

Charleston Shipyard.

7

“(2) Any moneys deposited in the Oregon Port Revolving Fund un-

8

der section 2 of this 2025 Act that are unexpended, unobligated and not

9

subject to any conditions on July 1, 2027, shall revert to the General

10

Fund.

11

“SECTION 2. In addition to and not in lieu of any other appropri-

12

ation, there is appropriated to the Oregon Business Development De-

13

partment, for the biennium beginning July 1, 2025, out of the General

14

Fund, the amount of $1,500,000 for deposit in the Oregon Port Revolv-

15

ing Fund, for the purpose of payment of a loan described in section 1

16

of this 2025 Act.”.

17`,
    links: [
      ["cites", "ors-285a.666", "1"],
      ["cites", "ors-285a.700", "1"],
      ["cites", "ors-285a.732", "1"],
    ],
    relatingClauseEdits: [],
  },
  {
    // No fixture Proposed Amendment deletes words of the relating clause. ADR-0001 quotes the form:
    // delete 'amending ORS 468.130' and insert 'amending ORS 468.130 and 468.140'. The lead-in is the
    // one SB 69-1 uses, and the quotes are the curly ones every fixture amendment uses.
    name: "delete the words of the relating clause and insert others",
    source: "docs/adr/0001-live-session-first-statute-links-from-text.md, paragraph 3 (not a fixture document)",
    text: "In line 2 of the printed bill, delete “amending ORS 468.130” and insert “amending ORS 468.130 and 468.140”.",
    links: [],
    relatingClauseEdits: [
      {
        deleted: "amending ORS 468.130",
        inserted: "amending ORS 468.130 and 468.140",
        insertedSections: ["ors-468.130", "ors-468.140"],
      },
    ],
  },
];

describe("a Proposed Amendment's Statute Links and relating clause edits", () => {
  test.for(rows)("$name ($source)", ({ sectionList, text, links, relatingClauseEdits }) => {
    const parsed = parseStatuteLinks({
      documentKind: "proposed-amendment",
      text,
      orsSections: orsSectionList(...(sectionList ?? [])),
    });
    expect(parsed.links.map((link): Expected => [link.kind, link.target.id, link.measureSection])).toEqual(links);
    expect(parsed.relatingClauseEdits).toEqual(relatingClauseEdits);
  });
});

// SB 69-2 was adopted by SLB on 2025-01-30 (spec #1, case (b)). Each row is the header of one section
// it inserts, and the expected link is the Statutes Affected Table's row for SB 69 A, the Version it
// became: documents/reports/artables2025R1.pdf, `pdftotext -layout`.
const sb692Rows: { tableRow: string; source: string; text: string; expected: Expected }[] = [
  {
    tableRow: "Ch. 657B Add §1 SB 69 A",
    source: "proposed-amendments/26286.pdf (SB 69-2), lines 26-31, a header wrapped over a line number",
    text: `“SECTION 1. Section 2 of this 2025 Act is added to and made a part

6

of ORS chapter 657B.`,
    expected: ["adds-to", "ors-chapter-657b", "1"],
  },
  {
    tableRow: "657B.070 A §3 SB 69 A",
    source: "proposed-amendments/26286.pdf (SB 69-2), line 58",
    text: `“SECTION 3. ORS 657B.070 is amended to read:`,
    expected: ["amends", "ors-657b.070", "3"],
  },
  {
    tableRow: "659A.159 A §4 SB 69 A",
    source: "proposed-amendments/26286.pdf (SB 69-2), lines 149-150",
    text: `“SECTION 4. ORS 659A.159, as amended by section 8, chapter 20, Oregon
Laws 2024, is amended to read:`,
    expected: ["amends", "ors-659a.159", "4"],
  },
  {
    tableRow: "659A.165 A §5 SB 69 A",
    source: "proposed-amendments/26286.pdf (SB 69-2), lines 233-234",
    text: `“SECTION 5. ORS 659A.165, as amended by section 10, chapter 20,
Oregon Laws 2024, is amended to read:`,
    expected: ["amends", "ors-659a.165", "5"],
  },
  {
    tableRow: "657B.400 A §6 SB 69 A",
    source: "proposed-amendments/26286.pdf (SB 69-2), line 353",
    text: `“SECTION 6. ORS 657B.400 is amended to read:`,
    expected: ["amends", "ors-657b.400", "6"],
  },
  {
    tableRow: "657B.060 A §7 SB 69 A",
    source: "proposed-amendments/26286.pdf (SB 69-2), line 1200",
    text: `“SECTION 7. ORS 657B.060 is amended to read:`,
    expected: ["amends", "ors-657b.060", "7"],
  },
  {
    tableRow: "653.616 A §8 SB 69 A",
    source: "proposed-amendments/26286.pdf (SB 69-2), line 1518",
    text: `“SECTION 8. ORS 653.616 is amended to read:`,
    expected: ["amends", "ors-653.616", "8"],
  },
  {
    tableRow: "653.626 A §9 SB 69 A",
    source: "proposed-amendments/26286.pdf (SB 69-2), line 1637",
    text: `“SECTION 9. ORS 653.626 is amended to read:`,
    expected: ["amends", "ors-653.626", "9"],
  },
  {
    tableRow: "659A.156 A §10 SB 69 A",
    source: "proposed-amendments/26286.pdf (SB 69-2), lines 1773-1774",
    text: `“SECTION 10. ORS 659A.156, as amended by section 16, chapter 20,
Oregon Laws 2024, is amended to read:`,
    expected: ["amends", "ors-659a.156", "10"],
  },
];

describe("SB 69-2's Statute Links agree with the Statutes Affected Table", () => {
  test.for(sb692Rows)("$tableRow ($source)", ({ text, expected }) => {
    const { links } = parseStatuteLinks({ documentKind: "proposed-amendment", text, orsSections: [] });
    expect(links.map((link): Expected => [link.kind, link.target.id, link.measureSection])).toEqual([expected]);
  });
});
