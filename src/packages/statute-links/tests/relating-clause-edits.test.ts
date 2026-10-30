import { describe, expect, test } from "vitest";
import { parseStatuteLinks } from "../index.ts";

// Seam 2: a Proposed Amendment's edits to the relating clause (#6 F1). The relating clause is the
// text that says what a Measure does to the statutes ("Relating to ...; amending ORS ..."). It
// starts on line 2 of page 1 and can run over several lines, and an amendment edits it in several
// shapes: insert after or before words, delete words, delete words and insert others, delete a line
// or the rest of one and insert, and several of these in one sentence. Each row quotes a Proposed
// Amendment from the research cache (.cache/olis-2025R1/, not committed: the Acceptable Use Agreement
// grants no redistribution license) as `pdftotext <file> -` prints it, from its first line to the
// end of its first instructions. The expected edits are what the amendment says, as literals.
//
// The amendment does not say how many lines the clause has; the printed Version does. The parser reads
// edits on page 1 from line 2 to two lines before the first line the amendment deletes in "Delete lines
// N through M" right after them (the line before is "Be It Enacted"), and to line 3 when it deletes none.

type RelatingClauseEdit = {
  deleted: string | null;
  deletedLines: string[];
  inserted: string | null;
  insertedSections: string[];
};

type Row = { name: string; source: string; text: string; edits: RelatingClauseEdit[] };

const rows: Row[] = [
  {
    name: 'SB 916-6: "delete lines 3 and 4 and insert", an edit past line 2 that deletes lines it does not quote',
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_48.pdf (SB 916-6, not in the committed fixture), lines 1-22",
    text: `SB 916-6
(LC 2910)
3/3/25 (ASD/ps)
Requested by Senator BONHAM

PROPOSED AMENDMENTS TO
SENATE BILL 916
1

On page 1 of the printed bill, delete lines 3 and 4 and insert “creating

2

new provisions; and amending ORS 657.010, 657.153, 657.176, 657.200, 657.202,

3

657.310, 657.317 and 657.400.”.

4

Delete lines 6 through 28 and delete pages 2 through 6 and insert:`,
    edits: [
      {
        deleted: null,
        deletedLines: ["lines 3 and 4"],
        inserted:
          "creating new provisions; and amending ORS 657.010, 657.153, 657.176, 657.200, 657.202, 657.310, 657.317 and 657.400.",
        insertedSections: [
          "ors-657.010",
          "ors-657.153",
          "ors-657.176",
          "ors-657.200",
          "ors-657.202",
          "ors-657.310",
          "ors-657.317",
          "ors-657.400",
        ],
      },
    ],
  },
  {
    name: 'HB 3444-1: an edit on line 2 and another on line 3, "In line 3, after ... insert ..."',
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_26.pdf (HB 3444-1, not in the committed fixture), lines 1-18",
    text: `HB 3444-1
(LC 3756)
2/18/25 (HRS/ps)
Requested by Representative WRIGHT

PROPOSED AMENDMENTS TO
HOUSE BILL 3444
1

On page 1 of the printed bill, line 2, after “327.185,” insert “327.195,”.

2

In line 3, after “327.362,” insert “327.825,”.

3

Delete lines 5 through 25 and delete page 2.`,
    edits: [
      { deleted: null, deletedLines: [], inserted: "327.195,", insertedSections: ["ors-327.195"] },
      { deleted: null, deletedLines: [], inserted: "327.825,", insertedSections: ["ors-327.825"] },
    ],
  },
  {
    name: 'HB 2007-1: a delete-only edit, "delete ..." with nothing inserted',
    source:
      "research cache documents-sample-1/CommitteeProposedAmendments_8.pdf (HB 2007-1, not in the committed fixture), lines 1-15",
    text: `HB 2007-1
(LC 4750)
3/19/25 (HRS/ps)
Requested by Representative FAHEY

PROPOSED AMENDMENTS TO
HOUSE BILL 2007
1

On page 1 of the printed bill, line 2, delete “ORS 327.829 and”.

2

Delete lines 5 through 30 and delete pages 2 through 5 and insert:
`,
    edits: [{ deleted: "ORS 327.829 and", deletedLines: [], inserted: null, insertedSections: [] }],
  },
  {
    name: 'HB 3544-B8: a delete-only edit of one word, "line 2, delete “and”"',
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_49.pdf (HB 3544-B8, not in the committed fixture), lines 1-12",
    text: `HB 3544-B8
(LC 3657)
6/26/25 (DJ/AG/ps)
Requested by JOINT COMMITTEE ON WAYS AND MEANS

PROPOSED AMENDMENTS TO
B-ENGROSSED HOUSE BILL 3544
(INCLUDING AMENDMENTS TO RESOLVE CONFLICTS)
1

On page 1 of the printed B-engrossed bill, line 2, delete “and”.
`,
    edits: [{ deleted: "and", deletedLines: [], inserted: null, insertedSections: [] }],
  },
  {
    name: 'HB 2649-2: "delete ... and insert ..." of quoted words',
    source:
      "research cache documents-sample-1/CommitteeProposedAmendments_7.pdf (HB 2649-2, not in the committed fixture), lines 1-17",
    text: `HB 2649-2
(LC 3493)
4/1/25 (DJ/wjc/ps)
Requested by Representative EVANS

PROPOSED AMENDMENTS TO
HOUSE BILL 2649
1
2

On page 1 of the printed bill, line 2, delete “amending ORS 352.102” and
insert “and declaring an emergency”.

3

Delete lines 4 through 30 and delete page 2 and insert:
`,
    edits: [
      {
        deleted: "amending ORS 352.102",
        deletedLines: [],
        inserted: "and declaring an emergency",
        insertedSections: [],
      },
    ],
  },
  {
    name: 'SB 739-5: "after “ORS” delete the rest of the line and delete line 3 and insert ..."',
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_33.pdf (SB 739-5, not in the committed fixture), lines 1-22",
    text: `SB 739-5
(LC 3444)
4/7/25 (RH/ps)
Requested by Senator GELSER BLOUIN

PROPOSED AMENDMENTS TO
SENATE BILL 739
1

On page 1 of the printed bill, line 2, after “ORS” delete the rest of the

2

line and delete line 3 and insert “443.415, 443.416, 443.420, 443.425, 443.436,

3

443.441, 443.443, 443.444, 443.735, 443.755, 443.875 and 443.886.”.

4

Delete lines 5 through 25 and delete pages 2 through 7 and insert:`,
    edits: [
      {
        deleted: null,
        deletedLines: ["the rest of the line", "line 3"],
        inserted:
          "443.415, 443.416, 443.420, 443.425, 443.436, 443.441, 443.443, 443.444, 443.735, 443.755, 443.875 and 443.886.",
        insertedSections: [
          "ors-443.415",
          "ors-443.416",
          "ors-443.420",
          "ors-443.425",
          "ors-443.436",
          "ors-443.441",
          "ors-443.443",
          "ors-443.444",
          "ors-443.735",
          "ors-443.755",
          "ors-443.875",
          "ors-443.886",
        ],
      },
    ],
  },
  {
    name: 'SB 83-7: "delete the rest of the line and lines 3 through 6 and insert ...", a relating clause of six lines',
    source:
      "research cache documents-sample-1/CommitteeProposedAmendments_22.pdf (SB 83-7, not in the committed fixture), lines 1-34",
    text: `SB 83-7
(LC 3373)
4/1/25 (AG/wjc/ps)
Requested by Senator SMITH DB

PROPOSED AMENDMENTS TO
SENATE BILL 83
1

On page 1 of the printed bill, line 2, after “ORS” delete the rest of the

2

line and lines 3 through 6 and insert “105.464, 197.716, 215.291, 215.495,

3

476.392, 476.398, 476.687, 476.690, 476.696, 477.015, 477.503, 477.748, and 526.272;

4

repealing ORS 455.612, 455.614, 476.390, 476.394, 477.027, 477.161 and 477.490

5

and sections 12a, 12b, 12d and 29, chapter 592, Oregon Laws 2021; and de-

6

claring an emergency.”.

7

Delete lines 8 through 25 and delete pages 2 through 5 and insert:`,
    edits: [
      {
        deleted: null,
        deletedLines: ["the rest of the line", "lines 3 through 6"],
        inserted:
          "105.464, 197.716, 215.291, 215.495, 476.392, 476.398, 476.687, 476.690, 476.696, 477.015, 477.503, 477.748, and 526.272; repealing ORS 455.612, 455.614, 476.390, 476.394, 477.027, 477.161 and 477.490 and sections 12a, 12b, 12d and 29, chapter 592, Oregon Laws 2021; and declaring an emergency.",
        insertedSections: [
          "ors-105.464",
          "ors-197.716",
          "ors-215.291",
          "ors-215.495",
          "ors-476.392",
          "ors-476.398",
          "ors-476.687",
          "ors-476.690",
          "ors-476.696",
          "ors-477.015",
          "ors-477.503",
          "ors-477.748",
          "ors-526.272",
          "ors-455.612",
          "ors-455.614",
          "ors-476.390",
          "ors-476.394",
          "ors-477.027",
          "ors-477.161",
          "ors-477.490",
        ],
      },
    ],
  },
  {
    name: "HB 2138-1: edits on lines 3, 4 and 5, an insert, a delete-only and an insert",
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_9.pdf (HB 2138-1, not in the committed fixture), lines 1-22",
    text: `HB 2138-1
(LC 333)
2/5/25 (RLM/ps)
Requested by Representative MARSH

PROPOSED AMENDMENTS TO
HOUSE BILL 2138
1

On page 1 of the printed bill, line 3, after “94.776,” insert “184.453,”.

2

In line 4, delete “197A.200,”.

3

In line 5, after “227.173,” insert “227.175,”.

4

Delete lines 13 through 22 and delete pages 2 and 3.`,
    edits: [
      { deleted: null, deletedLines: [], inserted: "184.453,", insertedSections: ["ors-184.453"] },
      { deleted: "197A.200,", deletedLines: [], inserted: null, insertedSections: [] },
      { deleted: null, deletedLines: [], inserted: "227.175,", insertedSections: ["ors-227.175"] },
    ],
  },
  {
    name: 'HB 3582-4: "delete ... and before the period insert ...", two edits; the edits to lines 6 and 13 of the body are not the relating clause',
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_10.pdf (HB 3582-4, not in the committed fixture), lines 1-28",
    text: `HB 3582-4
(LC 4007)
5/19/25 (MNJ/ps)
Requested by Representative HARTMAN

PROPOSED AMENDMENTS TO
HOUSE BILL 3582
1
2

On page 1 of the printed bill, line 2, delete “and” and before the period
insert “; and declaring an emergency”.

3

In line 6, delete “knowingly”.

4

In line 13, delete “knowingly”.

5

On page 2, line 9, delete “knowingly”.

6

Delete lines 21 and 22 and insert:`,
    edits: [
      { deleted: "and", deletedLines: [], inserted: null, insertedSections: [] },
      { deleted: null, deletedLines: [], inserted: "; and declaring an emergency", insertedSections: [] },
    ],
  },
  {
    name: 'SB 541-1: a pair on line 2 and a delete-only edit on line 3; "Delete lines 15 and 16 and insert ..." edits the body',
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_39.pdf (SB 541-1, not in the committed fixture), lines 1-28",
    text: `SB 541-1
(LC 791)
1/17/25 (SCT/ps)
Requested by Senator SOLLMAN

PROPOSED AMENDMENTS TO
SENATE BILL 541
1
2

On page 1 of the printed bill, line 2, delete “, 329.045 and” and insert “and
329.045”.

3

In line 3, delete “329.485”.

4

Delete lines 15 and 16 and insert “courses, including integrating compu-

5

tational thinking and artificial intelligence into existing classes and curric-

6

ula; and”.`,
    edits: [
      { deleted: ", 329.045 and", deletedLines: [], inserted: "and 329.045", insertedSections: ["ors-329.045"] },
      { deleted: "329.485", deletedLines: [], inserted: null, insertedSections: [] },
    ],
  },
  {
    name: 'SB 831-2: "after ... insert a comma", then a pair on line 3',
    source:
      "research cache documents-sample-1/CommitteeProposedAmendments_9.pdf (SB 831-2, not in the committed fixture), lines 1-18",
    text: `SB 831-2
(LC 392)
3/21/25 (TSB/ps)
Requested by SENATE COMMITTEE ON LABOR AND BUSINESS

PROPOSED AMENDMENTS TO
SENATE BILL 831
1

On page 1 of the printed bill, line 2, after “732.569” insert a comma.

2

In line 3, delete “and 732.574” and insert “732.574 and 732.586”.

3

Delete lines 5 through 19 and delete pages 2 through 8 and insert:`,
    edits: [
      { deleted: null, deletedLines: [], inserted: ",", insertedSections: [] },
      {
        deleted: "and 732.574",
        deletedLines: [],
        inserted: "732.574 and 732.586",
        insertedSections: ["ors-732.574", "ors-732.586"],
      },
    ],
  },
  {
    name: 'SB 430-1: "after the semicolon insert ..."',
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_3.pdf (SB 430-1, not in the committed fixture), lines 1-16",
    text: `SB 430-1
(LC 2786)
2/24/25 (TSB/ps)
Requested by Senator PROZANSKI

PROPOSED AMENDMENTS TO
SENATE BILL 430
1
2

On page 1 of the printed bill, line 2, after the semicolon insert “creating
new provisions; amending ORS 646.608;”.

3

Delete lines 5 through 28 and delete page 2 and insert:`,
    edits: [
      {
        deleted: null,
        deletedLines: [],
        inserted: "creating new provisions; amending ORS 646.608;",
        insertedSections: ["ors-646.608"],
      },
    ],
  },
  {
    name: 'HB 2614-A10: "delete line 3 and insert ..." on an A-engrossed bill',
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_35.pdf (HB 2614-A10, not in the committed fixture), lines 1-22",
    text: `HB 2614-A10
(LC 2876)
5/14/25 (JLM/ps)
Requested by SENATE COMMITTEE ON JUDICIARY

PROPOSED AMENDMENTS TO
A-ENGROSSED HOUSE BILL 2614
1

On page 1 of the printed A-engrossed bill, delete line 3 and insert “,

2

151.216 and 151.219 and sections 92 and 102, chapter 281, Oregon Laws 2023;

3

and declaring an emergency.”.

4

Delete lines 5 through 18 and delete pages 2 through 16 and insert:`,
    edits: [
      {
        deleted: null,
        deletedLines: ["line 3"],
        inserted:
          ", 151.216 and 151.219 and sections 92 and 102, chapter 281, Oregon Laws 2023; and declaring an emergency.",
        insertedSections: ["ors-151.216", "ors-151.219"],
      },
    ],
  },
  {
    name: "HB 2686-2: an edit to line 4 with no deletion of the body after it is not read as a relating clause edit",
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_19.pdf (HB 2686-2, not in the committed fixture), lines 1-23",
    text: `HB 2686-2
(LC 2813)
4/7/25 (DJ/wjc/ps)
Requested by Representative RUIZ

PROPOSED AMENDMENTS TO
HOUSE BILL 2686
1

In line 4 of the printed bill, delete “an” and insert “any private post-

2

secondary institution that meets the criteria set forth in ORS 348.597 (2)(a)

3

or”.

4
5

In line 11, delete the blank and insert “$2,000,000”.`,
    edits: [],
  },
  {
    name: "HB 2152-1: an edit to line 5 with no deletion of the body after it is not read as a relating clause edit",
    source:
      "research cache documents-sample-1/CommitteeProposedAmendments_12.pdf (HB 2152-1, not in the committed fixture), lines 1-27",
    text: `HB 2152-1
(LC 2822)
3/4/25 (STN/ps)
Requested by Representative LEWIS

PROPOSED AMENDMENTS TO
HOUSE BILL 2152
1

On page 1 of the printed bill, line 5, after “Quality” delete the rest of the

2

line and insert “, the Department of Land Conservation and Development,

3

the Oregon Department of Emergency Management, the State Fire Marshal

4

and the State Resilience Officer, shall”.

5
6

In line 28, delete “energy” and insert “emergency management”.`,
    edits: [],
  },
  {
    name: 'SB 912-1: "delete the rest of the line and delete lines 5 through 12 and insert:" replaces body text and is not a relating clause edit',
    source:
      "research cache documents-sample-2/CommitteeProposedAmendments_20.pdf (SB 912-1, not in the committed fixture), lines 1-24",
    text: `SB 912-1
(LC 3617)
3/5/25 (LAS/ps)
Requested by Senator GELSER BLOUIN

PROPOSED AMENDMENTS TO
SENATE BILL 912
1
2
3
4
5
6
7
8

On page 1, of the printed bill, line 4, after “(1)” delete the rest of the line
and delete lines 5 through 12 and insert:
“(a) A child’s parent or guardian has a duty to protect the child from
abuse by another person, including the duty to:
“(A) Take reasonable action to remedy or prevent the abuse of the child
by another person; and
“(B) Take reasonable action to end the abuse of the child by another
person.`,
    edits: [],
  },
];

describe("a Proposed Amendment's edits to the relating clause", () => {
  test.for(rows)("$name ($source)", ({ text, edits }) => {
    const parsed = parseStatuteLinks({ documentKind: "proposed-amendment", text, orsSections: [] });
    expect(parsed.relatingClauseEdits).toEqual(edits);
  });
});
