// Seam 4 (test/CLAUDE.md): an Agency Link's Listing follows its evidence Documents (ADR-0037, glossary "Listing"): the
// link is listed while any evidence Document is, and the Agency filter of search counts only listed links. Each case has a
// database of its own. Every value is MADE UP (made-up-index.ts): two Testimony rows on SB 9001 whose Organization names a
// made-up Agency, so the link between the Agency and the Measure has two evidence Documents, and a Version of the Measure
// that stays listed throughout.
import { afterEach, describe, expect, it } from "vitest";
import {
  agency,
  asOf,
  committee,
  measure,
  measureId,
  meetingOn,
  openMadeUpIndex,
  pullOf,
  session,
  storeMadeUpDocument,
  testimonyRecord,
  versionLink,
  type MadeUpIndex,
} from "./made-up-index.ts";

let index: MadeUpIndex;
afterEach(() => {
  index.close();
});

const version = versionLink();
const firstLetter = testimonyRecord(1);
const secondLetter = testimonyRecord(2);

/** A complete pull that lists the Measure, its Version and these Testimony rows. */
function pullListing(...letters: (typeof firstLetter)[]): ReturnType<typeof pullOf> {
  return pullOf({
    measures: [measure],
    committees: [committee],
    meetings: [meetingOn(10)],
    documentLinks: [version, ...letters.map((letter) => letter.link)],
    testimony: letters,
  });
}

/** The Measures the Agency filter of search keeps for the made-up Agency, and the ids of the Documents that filter lets search find by `word`. */
function throughTheAgencyFilter(): { measures: string[]; found: string[] } {
  const measures = index.reader.measuresWithAgencyLink(session, agency);
  const found = index.search.keyword(
    '"zebracrossing"',
    { session, withTestimony: false, agencyMeasures: new Set(measures) },
    10,
  );
  return { measures, found: found.map((match) => match.documentId) };
}

describe("an Agency Link", () => {
  it("is listed while any of its evidence Documents is, and the Agency filter counts it only then", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullListing(firstLetter, secondLetter));
    storeMadeUpDocument(index, version, "A zebracrossing is a made-up thing.");
    expect(throughTheAgencyFilter()).toEqual({ measures: [measureId], found: [version.id] });

    // The feed stops listing the first letter; the second still ties the Agency to the Measure.
    index.writer.recordFullPull(session, asOf(2), pullListing(secondLetter));
    index.writer.recordFullPull(session, asOf(3), pullListing(secondLetter));
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(3) });
    expect(throughTheAgencyFilter()).toEqual({ measures: [measureId], found: [version.id] });

    // Neither letter is listed: the link is No longer listed, so the filter drops the Measure, though its Version is listed.
    index.writer.recordFullPull(session, asOf(4), pullListing());
    index.writer.recordFullPull(session, asOf(5), pullListing());
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(5) });
    expect(throughTheAgencyFilter()).toEqual({ measures: [], found: [] });

    // One letter listed again lists the link again.
    index.writer.recordFullPull(session, asOf(6), pullListing(firstLetter));
    expect(throughTheAgencyFilter()).toEqual({ measures: [measureId], found: [version.id] });
  });

  it("is found for a Measure while the link is listed, with each evidence Document's own Listing", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullListing(firstLetter, secondLetter));
    index.writer.recordFullPull(session, asOf(2), pullListing(secondLetter));
    index.writer.recordFullPull(session, asOf(3), pullListing(secondLetter));

    const links = index.reader.findAgencyLinks(session, { measure: measure });
    expect(links.map((link) => [link.document.id, link.document.listing])).toEqual([
      [firstLetter.link.id, { listed: false, lastListedAt: asOf(1) }],
      [secondLetter.link.id, { listed: true, lastListedAt: asOf(3) }],
    ]);
  });
});
