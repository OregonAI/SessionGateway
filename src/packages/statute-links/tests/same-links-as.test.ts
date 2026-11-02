import { describe, expect, test } from "vitest";
import { statuteLinksOfMeasure } from "../measure.ts";
import { heldVersion, link, measureOf, sb69Links, tableOfMeasure, tripleOf } from "./measure-cases.ts";

// Seam 4: which Versions have the same links as the Version before them (ticket #99; ADR-0036, which supersedes ADR-0027's
// `same_as`). A Version whose reading, the text read and the Statute Links, is exactly that of the Version before it in print
// order has the same links as that Version. Only the reading is compared: the Version's own Statutes Affected Table block and
// its flag that two complete pulls in a row have not listed it (ADR-0030) are its own, whatever the Version before it has, so
// the result keeps them beside "same links as". A Version that was not read is never the same as another: it has said nothing.
//
// SB 69's A-Engrossed and Enrolled Versions read the same, to the last measure section (292 links: 8 amends, 1 adds-to and 283
// cites; get-measure-statute-links.test.ts), and so do HB 3795's B-Engrossed and Enrolled Versions. The links of a Version are
// what `pdftotext` of the Version says, quoted by the seam-1 files named above.

const sb69 = measureOf("SB", 69);
const hb3795 = measureOf("HB", 3795);

// HB 3795 (pdftotext): Introduced cites ORS 192.245 in SECTION 1; A-Engrossed amends ORS 409.711 in SECTION 1 and cites 192.245
// in its subsection (5); B-Engrossed and Enrolled add SECTION 2, which amends ORS 418.808 and cites the range 418.806 to 418.816
// (the snapshot holds 418.806, 418.808, 418.811, 418.813 and 418.816 between those ends).
const hb3795Introduced = [link("cites", "ors-192.245", "1")];
const hb3795AEngrossed = [link("amends", "ors-409.711", "1"), link("cites", "ors-192.245", "1")];
const hb3795BEngrossed = [
  link("amends", "ors-409.711", "1"),
  link("cites", "ors-192.245", "1"),
  link("amends", "ors-418.808", "2"),
  link("cites", "ors-418.806", "2"),
  link("cites", "ors-418.808", "2"),
  link("cites", "ors-418.811", "2"),
  link("cites", "ors-418.813", "2"),
  link("cites", "ors-418.816", "2"),
];

/** For each Version in the order the result lists them: its description, and the description of the Version it has the same links as. */
function sameLinksOf(result: ReturnType<typeof statuteLinksOfMeasure>): [label: string, sameAs: string | undefined][] {
  return result.versions.map((entry) => [entry.version.label, entry.sameLinksAs?.label]);
}

describe("a Version whose reading repeats the one before it", () => {
  test("SB 69's Enrolled Version has the same links as its A-Engrossed Version, which differs from Introduced", () => {
    const versions = [
      heldVersion(sb69, "Introduced", { links: [link("cites", "ors-192.245", "1")] }),
      heldVersion(sb69, "A-Engrossed", { links: sb69Links }),
      heldVersion(sb69, "Enrolled", { links: sb69Links }),
    ];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [], table: undefined });

    expect(sameLinksOf(result)).toEqual([
      ["Introduced", undefined],
      ["A-Engrossed", undefined],
      ["Enrolled", "A-Engrossed"],
    ]);
    expect(result.versions[2]?.sameLinksAs?.id).toBe("version-2025r1-sb69-a-engrossed");
  });

  test("HB 3795's Enrolled Version has the same links as its B-Engrossed Version, and each earlier Version differs from the one before it", () => {
    const versions = [
      heldVersion(hb3795, "Introduced", { links: hb3795Introduced }),
      heldVersion(hb3795, "A-Engrossed", { links: hb3795AEngrossed }),
      heldVersion(hb3795, "B-Engrossed", { links: hb3795BEngrossed }),
      heldVersion(hb3795, "Enrolled", { links: hb3795BEngrossed }),
    ];

    const result = statuteLinksOfMeasure({ measure: hb3795, versions, amendments: [], table: undefined });

    expect(sameLinksOf(result)).toEqual([
      ["Introduced", undefined],
      ["A-Engrossed", undefined],
      ["B-Engrossed", undefined],
      ["Enrolled", "B-Engrossed"],
    ]);
  });

  test("lists the Versions in the order they were printed in, whatever order the Index gave them", () => {
    const versions = [
      heldVersion(sb69, "Enrolled", { links: sb69Links }),
      heldVersion(sb69, "Introduced", { links: [link("cites", "ors-192.245", "1")] }),
      heldVersion(sb69, "A-Engrossed", { links: sb69Links }),
    ];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [], table: undefined });

    expect(sameLinksOf(result)).toEqual([
      ["Introduced", undefined],
      ["A-Engrossed", undefined],
      ["Enrolled", "A-Engrossed"],
    ]);
  });

  // The reading is the links by kind, each target once with the measure sections it is linked in (ADR-0015), so two Versions
  // that list the same links in another order within a measure section read the same. MADE UP from SB 69: the Enrolled Version's
  // §3 names the amendment before the citation.
  test("SB 69's Enrolled Version, when its SECTION 3 lists the amendment before the citation: the links by kind are the same, so it still has the same links", () => {
    const reordered = [
      link("adds-to", "ors-chapter-657b", "1"),
      link("cites", "ors-657b.060", "2"),
      link("amends", "ors-657b.070", "3"),
      link("cites", "ors-657b.060", "3"),
      ...sb69Links.slice(4),
    ];
    const versions = [
      heldVersion(sb69, "A-Engrossed", { links: sb69Links }),
      heldVersion(sb69, "Enrolled", { links: reordered }),
    ];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [], table: undefined });

    expect(sameLinksOf(result)).toEqual([
      ["A-Engrossed", undefined],
      ["Enrolled", "A-Engrossed"],
    ]);
  });

  test("a Version that differs by one measure section of one link is not the same: SB 69's Enrolled Version with ORS 653.616 amended in SECTION 9", () => {
    const moved = sb69Links.map((each) =>
      each.target.id === "ors-653.616" ? link("amends", "ors-653.616", "9") : each,
    );
    const versions = [
      heldVersion(sb69, "A-Engrossed", { links: sb69Links }),
      heldVersion(sb69, "Enrolled", { links: moved }),
    ];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [], table: undefined });

    expect(sameLinksOf(result)).toEqual([
      ["A-Engrossed", undefined],
      ["Enrolled", undefined],
    ]);
  });
});

describe("a Version that has the same links as the one before it keeps its own table block and flag", () => {
  // MADE UP, as get-measure-same-links-as-table-pull.test.ts makes it up: a B-Engrossed Version of SB 69 (the feed has none) with
  // the A-Engrossed Version's text, and a table whose one row names it, "653.616 A §8 SB 69 B". The B-Engrossed Version has the
  // A-Engrossed Version's links beside a table block of its own, which the A-Engrossed Version does not have, and the Enrolled
  // Version has the B-Engrossed Version's links and no block. A level names one Version, and none names an Enrolled one (ADR-0033).
  test("SB 69's B-Engrossed Version has the same links as A-Engrossed and a block of its own, and Enrolled has the same links as B-Engrossed and none", () => {
    const versions = [
      heldVersion(sb69, "Introduced", { links: [link("cites", "ors-192.245", "1")] }),
      heldVersion(sb69, "A-Engrossed", { links: sb69Links }),
      heldVersion(sb69, "B-Engrossed", { links: sb69Links }),
      heldVersion(sb69, "Enrolled", { links: sb69Links }),
    ];

    const result = statuteLinksOfMeasure({
      measure: sb69,
      versions,
      amendments: [],
      table: tableOfMeasure(sb69, ["653.616 A §8 SB 69 B"], ["Introduced", "A-Engrossed", "B-Engrossed", "Enrolled"]),
    });

    expect(sameLinksOf(result)).toEqual([
      ["Introduced", undefined],
      ["A-Engrossed", undefined],
      ["B-Engrossed", "A-Engrossed"],
      ["Enrolled", "B-Engrossed"],
    ]);
    const bEngrossed = result.versions[2];
    expect(
      bEngrossed?.table?.kind === "compared" ? bEngrossed.table.confirmed.map(tripleOf) : bEngrossed?.table,
    ).toEqual([["amends", "ors-653.616", "8"]]);
    expect(result.versions[1]?.table).toBeUndefined();
    expect(result.versions[3]?.table).toBeUndefined();
  });

  // ADR-0030: a Version is no longer listed once two complete pulls in a row have not listed it, and it is still served. MADE UP:
  // SB 69's Enrolled Version missed by two pulls.
  test("SB 69's Enrolled Version, no longer listed: it has the same links as A-Engrossed and its own flag says it is not listed", () => {
    const versions = [
      heldVersion(sb69, "A-Engrossed", { links: sb69Links }),
      heldVersion(sb69, "Enrolled", { links: sb69Links, listed: false }),
    ];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [], table: undefined });

    expect(sameLinksOf(result)).toEqual([
      ["A-Engrossed", undefined],
      ["Enrolled", "A-Engrossed"],
    ]);
    expect(result.versions.map((entry) => entry.version.listed)).toEqual([true, false]);
  });
});

describe("a Version that was not read", () => {
  // MADE UP, as get-measure-statute-links-pull.test.ts makes it up: a B-Engrossed Version of SB 69 served with the fixture's scan
  // (Exhibit 288141, a PDF with no text layer), so the Index holds the Version and has read nothing of it. The Enrolled Version
  // reads the same as A-Engrossed, but the Version before it, the scan, said nothing for it to be the same as.
  test("is never the same as another, and nothing is the same as it: SB 69's Enrolled Version after a scan has its own links", () => {
    const versions = [
      heldVersion(sb69, "A-Engrossed", { links: sb69Links }),
      heldVersion(sb69, "B-Engrossed", { read: false }),
      heldVersion(sb69, "Enrolled", { links: sb69Links }),
    ];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [], table: undefined });

    expect(sameLinksOf(result)).toEqual([
      ["A-Engrossed", undefined],
      ["B-Engrossed", undefined],
      ["Enrolled", undefined],
    ]);
  });

  test("two scans in a row are not the same as each other: their empty lists do not mean they have the same links", () => {
    const versions = [
      heldVersion(sb69, "A-Engrossed", { read: false }),
      heldVersion(sb69, "Enrolled", { read: false }),
    ];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [], table: undefined });

    expect(sameLinksOf(result)).toEqual([
      ["A-Engrossed", undefined],
      ["Enrolled", undefined],
    ]);
  });
});

describe("a Version with no place in the order of printing", () => {
  // MADE UP, as get-measure-statute-links-pull.test.ts makes it up: a "Minority Report A-Engrossed" Version of SB 69 served with
  // SB 69's A-Engrossed file (the feed lists such Versions for 8 Measures of the Session, ADR-0013). It comes after Enrolled, so
  // it is compared with Enrolled, whose reading is the same.
  test("comes last, and has the same links as the Version before it: SB 69's Minority Report A-Engrossed after Enrolled", () => {
    const versions = [
      heldVersion(sb69, "Minority Report A-Engrossed", { links: sb69Links }),
      heldVersion(sb69, "Introduced", { links: [link("cites", "ors-192.245", "1")] }),
      heldVersion(sb69, "A-Engrossed", { links: sb69Links }),
      heldVersion(sb69, "Enrolled", { links: sb69Links }),
    ];

    const result = statuteLinksOfMeasure({ measure: sb69, versions, amendments: [], table: undefined });

    expect(sameLinksOf(result)).toEqual([
      ["Introduced", undefined],
      ["A-Engrossed", undefined],
      ["Enrolled", "A-Engrossed"],
      ["Minority Report A-Engrossed", "Enrolled"],
    ]);
  });
});
