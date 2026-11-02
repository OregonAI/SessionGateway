import { describe, expect, test } from "vitest";
import type { MeasureKey } from "#/packages/domain/index.ts";
import type { StoredAmendment, StoredVersion } from "#/packages/domain/statute-links.ts";
import { statuteLinksOfMeasure } from "../measure.ts";
import { headerNaming, heldVersion, measureOf, proposedAmendment } from "./measure-cases.ts";

// Seam 4: which Proposed Amendments of a Measure are Superseded amendments (ticket #99; ADR-0015, GLOSSARY.md "Superseded
// amendment"). An amendment is superseded when the Index holds a Version later than the Amended Version, the one its header and
// number name, whether or not the Index holds that Version's file. One whose Amended Version cannot be named is not: it stays
// among the amendments whose Statute Links apply, as ADR-0015 says. No database: the stored Versions and amendments are the
// input, written as the documents say them.
//
// Each case is a real Measure of the 2025R1 fixture. The Versions are the ones its row of Feed/MeasureDocuments.json lists,
// the postings the rows of Feed/CommitteeProposedAmendments.json list, and the header is the line after "PROPOSED AMENDMENTS TO"
// on the first page of the posted file (documents/proposed-amendments/<ProposedAmendmentId>.pdf). A case that changes one fact
// of the real Measure says so.

const sb69 = measureOf("SB", 69);
const slb = { code: "SLB", name: "Labor and Business" };
const introducedSb69 = headerNaming("Introduced", sb69);

// SB 69-1 is posted to SLB on 2025-01-21 (26284), 01-28 (26285) and 01-30 (26287); -2 on 01-28 (26286) and 01-30 (26288,
// Adopted). The first page of each file says "PROPOSED AMENDMENTS TO / SENATE BILL 69": the Introduced Version.
const sb69Amendment1 = proposedAmendment(sb69, "-1", [
  {
    proposedAmendmentId: 26284,
    committee: slb,
    at: "2025-01-21T08:00:00-08:00",
    meaning: "Proposed",
    header: introducedSb69,
  },
  {
    proposedAmendmentId: 26285,
    committee: slb,
    at: "2025-01-28T08:00:00-08:00",
    meaning: "Proposed",
    header: introducedSb69,
  },
  {
    proposedAmendmentId: 26287,
    committee: slb,
    at: "2025-01-30T08:00:00-08:00",
    meaning: "Proposed",
    header: introducedSb69,
  },
]);
const sb69Amendment2 = proposedAmendment(sb69, "-2", [
  {
    proposedAmendmentId: 26286,
    committee: slb,
    at: "2025-01-28T08:00:00-08:00",
    meaning: "Proposed",
    header: introducedSb69,
  },
  {
    proposedAmendmentId: 26288,
    committee: slb,
    at: "2025-01-30T08:00:00-08:00",
    meaning: "Adopted",
    header: introducedSb69,
  },
]);

const hb3795 = measureOf("HB", 3795);
const hb3795Amendment1 = proposedAmendment(hb3795, "-1", [
  {
    proposedAmendmentId: 27966,
    committee: { code: "HECHS", name: "Early Childhood and Human Services" },
    at: "2025-04-03T08:00:00-07:00",
    meaning: "Adopted",
    header: headerNaming("Introduced", hb3795),
  },
]);
// The first page of -A3 says "PROPOSED AMENDMENTS TO / A-ENGROSSED HOUSE BILL 3795".
const hb3795AmendmentA3 = proposedAmendment(hb3795, "-A3", [
  {
    proposedAmendmentId: 28997,
    committee: { code: "SHS", name: "Human Services" },
    at: "2025-05-15T08:00:00-07:00",
    meaning: "Proposed",
    header: headerNaming("A-Engrossed", hb3795),
  },
  {
    proposedAmendmentId: 29108,
    committee: { code: "SHS", name: "Human Services" },
    at: "2025-05-20T08:00:00-07:00",
    meaning: "Adopted",
    header: headerNaming("A-Engrossed", hb3795),
  },
]);

/** The Amended Version's id (undefined when the Index does not hold it) and the id of the Version that replaces the amendment. */
function replacements(
  measure: MeasureKey,
  versions: readonly StoredVersion[],
  amendments: readonly StoredAmendment[],
): [amendment: string, amended: string | undefined, later: string][] {
  const found = statuteLinksOfMeasure({ measure, versions, amendments });
  return found.supersededAmendments.map((superseded) => [
    superseded.amendment.id,
    superseded.amendedVersion.held?.id,
    superseded.laterVersion.id,
  ]);
}

describe("a Proposed Amendment whose Amended Version has a later Version held", () => {
  test("SB 69-1 and -2 amend Introduced, and A-Engrossed is held: both are Superseded amendments, replaced by A-Engrossed", () => {
    const versions = [heldVersion(sb69, "Introduced"), heldVersion(sb69, "A-Engrossed"), heldVersion(sb69, "Enrolled")];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [sb69Amendment1, sb69Amendment2] });

    expect(result.currentAmendments).toEqual([]);
    expect(replacements(sb69, versions, [sb69Amendment1, sb69Amendment2])).toEqual([
      ["amendment-2025r1-sb69-1", "version-2025r1-sb69-introduced", "version-2025r1-sb69-a-engrossed"],
      ["amendment-2025r1-sb69-2", "version-2025r1-sb69-introduced", "version-2025r1-sb69-a-engrossed"],
    ]);
    expect(result.supersededAmendments.map((superseded) => superseded.amendedVersion.description)).toEqual([
      "Introduced",
      "Introduced",
    ]);
  });

  test("HB 3795-1 amends Introduced and -A3 amends A-Engrossed: each is replaced by the next Version held after the one it amends", () => {
    const versions = [
      heldVersion(hb3795, "Introduced"),
      heldVersion(hb3795, "A-Engrossed"),
      heldVersion(hb3795, "B-Engrossed"),
      heldVersion(hb3795, "Enrolled"),
    ];

    expect(replacements(hb3795, versions, [hb3795Amendment1, hb3795AmendmentA3])).toEqual([
      ["amendment-2025r1-hb3795-1", "version-2025r1-hb3795-introduced", "version-2025r1-hb3795-a-engrossed"],
      ["amendment-2025r1-hb3795-a3", "version-2025r1-hb3795-a-engrossed", "version-2025r1-hb3795-b-engrossed"],
    ]);
  });

  // ADR-0015: "a Version whose download failed still sits in the order, so an amendment to A-Engrossed is replaced when
  // B-Engrossed is held". HB 3795's real A-Engrossed file is held; this case takes it away, the way a failed download does.
  test("HB 3795-A3 amends A-Engrossed, whose file did not come, and B-Engrossed is held: it is still superseded, and the Amended Version is not held", () => {
    const versions = [heldVersion(hb3795, "Introduced"), heldVersion(hb3795, "B-Engrossed")];

    const result = statuteLinksOfMeasure({
      measure: hb3795,
      versions,
      amendments: [hb3795Amendment1, hb3795AmendmentA3],
    });

    expect(result.supersededAmendments.map((superseded) => superseded.amendedVersion)).toEqual([
      { description: "Introduced", held: versions[0] },
      { description: "A-Engrossed", held: undefined },
    ]);
    expect(replacements(hb3795, versions, [hb3795Amendment1, hb3795AmendmentA3])).toEqual([
      ["amendment-2025r1-hb3795-1", "version-2025r1-hb3795-introduced", "version-2025r1-hb3795-b-engrossed"],
      ["amendment-2025r1-hb3795-a3", undefined, "version-2025r1-hb3795-b-engrossed"],
    ]);
  });

  // The feed as it stood on 2025-02-01 (get-measure-statute-links-pull.test.ts): SB 69 had its Introduced Version, -1 and -2,
  // and nothing more. The state follows what the Index holds, so a pull that brings the next Version in changes the answer.
  test("SB 69-1 and -2 while only Introduced is held: no Version is later than the one they amend, so neither is superseded", () => {
    const versions = [heldVersion(sb69, "Introduced")];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [sb69Amendment1, sb69Amendment2] });

    expect(result.supersededAmendments).toEqual([]);
    expect(result.currentAmendments.map((placed) => [placed.amendment.id, placed.version?.id])).toEqual([
      ["amendment-2025r1-sb69-1", "version-2025r1-sb69-introduced"],
      ["amendment-2025r1-sb69-2", "version-2025r1-sb69-introduced"],
    ]);
  });

  // ADR-0015: a description that sits nowhere in the order of printing is neither later than any Version nor replaces any
  // amendment. The feed lists "Minority Report A-Engrossed" Versions for 8 Measures of the Session (ADR-0013); SB 69 has none,
  // so this case adds one to SB 69's Introduced Version, as get-measure-statute-links-pull.test.ts does.
  test("SB 69-1 and -2 while the only Version after Introduced is a Minority Report A-Engrossed: it sits in no place in the order, so neither is superseded", () => {
    const versions = [heldVersion(sb69, "Introduced"), heldVersion(sb69, "Minority Report A-Engrossed")];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [sb69Amendment1, sb69Amendment2] });

    expect(result.supersededAmendments).toEqual([]);
    expect(result.currentAmendments.map((placed) => placed.amendment.id)).toEqual([
      "amendment-2025r1-sb69-1",
      "amendment-2025r1-sb69-2",
    ]);
  });
});

describe("a Proposed Amendment whose Version cannot be named", () => {
  const versions = [heldVersion(sb69, "Introduced"), heldVersion(sb69, "A-Engrossed"), heldVersion(sb69, "Enrolled")];

  // The Build report lists the files the pull did not fetch. This case is SB 69-2 with its posting 26286 not fetched, so the
  // Index holds no file of it and no header to read the Version from.
  test("SB 69-2 with no file held: nothing names its Version, so it is not superseded though A-Engrossed is held", () => {
    const unfetched = proposedAmendment(sb69, "-2", [
      {
        proposedAmendmentId: 26286,
        committee: slb,
        at: "2025-01-28T08:00:00-08:00",
        meaning: "Proposed",
        header: undefined,
      },
    ]);

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [unfetched] });

    expect(result.supersededAmendments).toEqual([]);
    expect(
      result.currentAmendments.map((placed) => [placed.amendment.id, placed.placement.kind, placed.version]),
    ).toEqual([["amendment-2025r1-sb69-2", "unknown", undefined]]);
  });

  // MADE UP from SB 69-2: its file says "SENATE BILL 69" (Introduced) and the number is spelled "-A2", which names the
  // A-Engrossed Version. ADR-0015: a header and a number that disagree name nothing.
  test("SB 69-2 whose number names A-Engrossed and whose header names Introduced: they disagree, so it is not superseded", () => {
    const disagreeing = proposedAmendment(sb69, "-A2", [
      {
        proposedAmendmentId: 26286,
        committee: slb,
        at: "2025-01-28T08:00:00-08:00",
        meaning: "Proposed",
        header: introducedSb69,
      },
    ]);

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [disagreeing] });

    expect(result.supersededAmendments).toEqual([]);
    expect(result.currentAmendments.map((placed) => placed.placement.kind)).toEqual(["unknown"]);
  });

  test("one amendment that names its Version and one that does not: only the first is superseded, and the order given is kept", () => {
    const unfetched = proposedAmendment(sb69, "-2", [
      {
        proposedAmendmentId: 26286,
        committee: slb,
        at: "2025-01-28T08:00:00-08:00",
        meaning: "Proposed",
        header: undefined,
      },
    ]);

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [unfetched, sb69Amendment1] });

    expect(result.supersededAmendments.map((superseded) => superseded.amendment.id)).toEqual([
      "amendment-2025r1-sb69-1",
    ]);
    expect(result.currentAmendments.map((placed) => placed.amendment.id)).toEqual(["amendment-2025r1-sb69-2"]);
  });
});
