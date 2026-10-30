import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";
import { orsSectionList } from "./section-ids.ts";

// Seam 2: matter a measure marks to be omitted. Every measure prints "NOTE: Matter in boldfaced type in
// an amended section is new; matter [italic and bracketed] is existing law to be omitted." `pdftotext`
// keeps the brackets and drops the type, so the parser tells omitted matter from the rest by the
// brackets: a mention inside them is no link, and the new citation beside them is read (#6 F3, F4).
// No committed fixture document has the pattern, so each row quotes the research cache
// (.cache/olis-2025R1/, not committed: the Acceptable Use Agreement grants no redistribution license),
// as `pdftotext <file> -` prints it. Expected links are [kind, target id, measure section].

type Expected = [kind: string, targetId: string, measureSection: string | null];

type Row = {
  name: string;
  documentKind: "version" | "proposed-amendment";
  /** The document and the lines of its `pdftotext` output the passage is. */
  source: string;
  sectionList?: string[];
  text: string;
  expected: Expected[];
};

const rows: Row[] = [
  {
    name: "ORS [old] new: the new citation after the omitted ones is read. Statutes Affected Table: 247.292 A §6 HB 3723 E",
    documentKind: "version",
    source:
      "research cache documents-sample-1/MeasureDocuments_20.pdf (HB 3723, not in the committed fixture), lines 720-741",
    text: `SECTION 6. ORS 247.292, as amended by section 5, chapter 492, Oregon Laws 2023, is amended

23
24
25
26
27
28

to read:
247.292. (1) A county clerk shall update the registration of an elector in the county upon receiving written evidence from:
(a) The elector indicating a residence or mailing address that is different from the residence or
mailing address for the elector as contained in the records of the county clerk;
(b) The United States Postal Service indicating a residence address that is different from the

29

residence address for the elector as contained in the records of the county clerk; or

30

(c) The Secretary of State as provided in ORS [247.017, 247.018 or] 247.295.`,
    expected: [
      ["amends", "ors-247.292", "6"],
      ["cites", "ors-247.295", "6"],
    ],
  },
  {
    name: "ORS [a range and a section,] a list: the omitted range is no link, the new list and its ranges are",
    documentKind: "version",
    source:
      "research cache documents-sample-2/MeasureDocuments_31.pdf (HB 3348, not in the committed fixture), lines 6731-6739",
    // The list holds the omitted range's sections too, so a range read by mistake would show.
    sectionList: [
      "ors-25.501",
      "ors-25.530",
      "ors-25.556",
      "ors-108.010",
      "ors-108.300",
      "ors-108.550",
      "ors-416.310",
      "ors-416.340",
      "ors-416.510",
      "ors-416.990",
      "ors-419b.400",
    ],
    text: `(2) “Child support award” means a money award or agency order that requires the payment of

5

child support and that is entered under ORS [25.501 to 25.556,] 108.010 to 108.550, 416.310 to 416.340,

6

416.510 to 416.990 or 419B.400 or ORS chapter 25, 107, 109 or 110.`,
    expected: [
      ["cites", "ors-108.010", null],
      ["cites", "ors-108.300", null],
      ["cites", "ors-108.550", null],
      ["cites", "ors-416.310", null],
      ["cites", "ors-416.340", null],
      ["cites", "ors-416.510", null],
      ["cites", "ors-416.990", null],
      ["cites", "ors-419b.400", null],
      ["cites", "ors-chapter-25", null],
      ["cites", "ors-chapter-107", null],
      ["cites", "ors-chapter-109", null],
      ["cites", "ors-chapter-110", null],
    ],
  },
  {
    name: "[ORS a range or] ORS chapter list: a mention wholly inside omitted matter is no link",
    documentKind: "version",
    source:
      "research cache documents-sample-2/MeasureDocuments_31.pdf (HB 3348, not in the committed fixture), lines 7261-7265",
    sectionList: ["ors-25.501", "ors-25.530", "ors-25.556"],
    text: `be exempt from execution or other process arising out of a support obligation or an order or notice

14

entered or issued under [ORS 25.501 to 25.556 or] ORS chapter 25, 107, 108, 109, 110, 419B or 419C.`,
    expected: [
      ["cites", "ors-chapter-25", null],
      ["cites", "ors-chapter-107", null],
      ["cites", "ors-chapter-108", null],
      ["cites", "ors-chapter-109", null],
      ["cites", "ors-chapter-110", null],
      ["cites", "ors-chapter-419b", null],
      ["cites", "ors-chapter-419c", null],
    ],
  },
  {
    name: "HB 3444-1 section 4: a mention in [bracketed] matter the amendment omits is no link, the others are",
    documentKind: "proposed-amendment",
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_26.pdf (HB 3444-1, not in the committed fixture), lines 505-590",
    text: `“SECTION 4. ORS 327.195 is amended to read:

11

“327.195. (1)(a) Except as provided by paragraph (d) of this subsection, the

12

amount of a grant awarded from the Student Investment Account = the

13

grant recipient’s ADMw ×

14

grants in each biennium ÷ the total ADMw of all grant recipients).

15
16

(the total amount available for distribution as

“(b) For purposes of this subsection and except as provided by paragraph
(c) of this subsection, ADMw equals:

17

“(A) For school districts, the ADMw as calculated under ORS 327.013,

18

except that the additional amount allowed for students who are in poverty

19

families, as determined under ORS 327.013 (1)(c)(A)(v)(I), shall be 0.5.

20

“(B) For an educational program under the Youth Corrections Education

21

Program or the Juvenile Detention Education Program, as provided in ORS

22

327.026.

23

“(c) When calculating ADMw for a school district, the Department of

24

Education shall remove from the calculation any amounts that are attribut-

25

able to:

26

“[(A) A virtual public charter school, as defined in ORS 338.005;]

27

“[(B)] (A) A public charter school that provided notice of the public

28

charter school’s intent to apply for a grant as an eligible applicant; and

29

“[(C)] (B) A public charter school sponsored by, or located within, the

30

school district that did not participate in the grant application or grant

HB 3444-1 2/18/25
Proposed Amendments to HB 3444

Page 5`,
    expected: [
      ["amends", "ors-327.195", "4"],
      ["cites", "ors-327.013", "4"],
      ["cites", "ors-327.026", "4"],
    ],
  },
];

describe("matter a measure marks to be omitted", () => {
  test.for(rows)("$name ($source)", ({ documentKind, sectionList, text, expected }) => {
    const { links } = parseStatuteLinks({ documentKind, text, orsSections: orsSectionList(...(sectionList ?? [])) });
    expect(links.map((link): Expected => [link.kind, link.target.id, link.measureSection])).toEqual(expected);
  });
});
