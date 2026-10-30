import { describe, expect, test } from "vitest";
import { readAmendedVersionHeader } from "../index.ts";

// Seam 2: the Version a Proposed Amendment says it amends (ticket #13, ADR-0015). Legislative Counsel
// prints it on the first page, after "PROPOSED AMENDMENTS TO": the Measure alone for an amendment to the
// Introduced Version ("SENATE BILL 69"), and the Version's letter before it for an amendment to an
// engrossed one ("A-ENGROSSED HOUSE BILL 3795"). Each row quotes the head of a Proposed Amendment as
// `pdftotext <file>.pdf -` prints it (test/fixtures/olis-2025R1/documents/proposed-amendments/<ProposedAmendmentId>.pdf),
// except the row that says it is from the gitignored cache. The expected value is the Version in the words the
// feed describes Versions in (MeasureDocuments `VersionDescription`: "Introduced", "A-Engrossed"), with the Measure the
// header names as its prefix and number (ticket #13 finding F3: a file posted under the wrong Measure is not the
// amendment's own, so the Measure is read as well as the Version).

type Row = {
  name: string;
  /** The document and the lines of its `pdftotext` output the passage is. */
  source: string;
  text: string;
  /** The Version and the Measure the header names, or undefined when it names none. */
  header: { version: string; measure: { prefix: string; number: number } } | undefined;
};

const rows: Row[] = [
  {
    name: "SB 69-2: the Measure alone is an amendment to the Introduced Version",
    source: "proposed-amendments/26286.pdf (SB 69-2), lines 1-12",
    text: `SB 69-2
(LC 1368)
1/23/25 (JAS/ps)
Requested by SENATE COMMITTEE ON LABOR AND BUSINESS

PROPOSED AMENDMENTS TO
SENATE BILL 69
1

In line 2 of the printed bill, before the period insert “; creating new pro-

2

visions; amending ORS 653.616, 653.626, 657B.060, 657B.070, 657B.400,`,
    header: { version: "Introduced", measure: { prefix: "SB", number: 69 } },
  },
  {
    name: "HB 3795-A3: the Version's letter before the Measure is an amendment to that engrossed Version",
    source: "proposed-amendments/28997.pdf (HB 3795-A3), lines 1-12",
    text: `HB 3795-A3
(LC 1688)
4/29/25 (LAS/ps)
Requested by Senator GELSER BLOUIN

PROPOSED AMENDMENTS TO
A-ENGROSSED HOUSE BILL 3795
1
2

On page 1 of the printed A-engrossed bill, line 2, before the period insert
“and 418.808”.`,
    header: { version: "A-Engrossed", measure: { prefix: "HB", number: 3795 } },
  },
  {
    name: "HB 3795-1: a House bill with no letter is the Introduced Version",
    source: "proposed-amendments/27966.pdf (HB 3795-1), lines 1-12",
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
409.711”.`,
    header: { version: "Introduced", measure: { prefix: "HB", number: 3795 } },
  },
  {
    name: "SB 921-2: another Senate bill's header is read the same way",
    source: "proposed-amendments/26923.pdf (SB 921-2), lines 1-8",
    text: `SB 921-2
(LC 3562)
3/12/25 (STN/ps)
Requested by Senator SMITH DB

PROPOSED AMENDMENTS TO
SENATE BILL 921
1`,
    header: { version: "Introduced", measure: { prefix: "SB", number: 921 } },
  },
  {
    name: "SB 243-B22: a B-engrossed header (from the gitignored cache, .cache/olis-2025R1/documents-sample-2/CommitteeProposedAmendments_32, not the fixture) names B-Engrossed",
    source: "CommitteeProposedAmendments_32 (SB 243-B22), lines 1-8",
    text: `SB 243-B22
(LC 3066)
6/16/25 (JLM/ps)
Requested by Representative DRAZAN

PROPOSED AMENDMENTS TO
B-ENGROSSED SENATE BILL 243
1`,
    header: { version: "B-Engrossed", measure: { prefix: "SB", number: 243 } },
  },
  {
    name: "A Version's own text has no 'PROPOSED AMENDMENTS TO' header, so it names no Version",
    source: "measure-documents/SB69/Introduced.pdf (SB 69 Introduced), lines 1-5",
    text: `83rd OREGON LEGISLATIVE ASSEMBLY--2025 Regular Session

Senate Bill 69
Printed pursuant to Senate Interim Rule 213.28 by order of the President of the Senate in conformance with presession filing rules, indicating neither advocacy nor opposition on the part of the President (at the request
of Senate Interim Committee on Labor and Business)`,
    header: undefined,
  },
  {
    name: "The page footer 'Proposed Amendments to SB 69' is not the header: it names no Version",
    source: "proposed-amendments/26286.pdf (SB 69-2), the page footer that reads Page 2",
    text: `SB 69-2 1/23/25
Proposed Amendments to SB 69
Page 2`,
    header: undefined,
  },
  {
    name: "A header cut off before the Measure names no Version",
    source: "proposed-amendments/26286.pdf (SB 69-2), lines 1-6, with the Measure line left out",
    text: `SB 69-2
(LC 1368)
1/23/25 (JAS/ps)
Requested by SENATE COMMITTEE ON LABOR AND BUSINESS

PROPOSED AMENDMENTS TO`,
    header: undefined,
  },
];

describe("the Version a Proposed Amendment's header names", () => {
  test.for(rows)("$name ($source)", ({ text, header }) => {
    expect(readAmendedVersionHeader(text)).toEqual(header);
  });

  test("a text with no header at all names no Version", () => {
    expect(readAmendedVersionHeader("")).toBeUndefined();
  });
});
