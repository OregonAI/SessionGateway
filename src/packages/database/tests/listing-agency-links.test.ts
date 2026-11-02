// Seam 4 (test/CLAUDE.md): an Agency Link's Listing follows its evidence Documents (ADR-0037, glossary "Listing"): the
// link is listed while any evidence Document is, and the Agency filter of search counts only listed links. Each case has a
// database of its own. Every value is MADE UP (made-up-index.ts): two Testimony rows on SB 9001 whose Organization names a
// made-up Agency, so the link between the Agency and the Measure has two evidence Documents, and a Version of the Measure
// that stays listed throughout.
import { afterEach, describe, expect, it } from "vitest";
import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import {
  agency,
  amendmentId,
  asOf,
  committee,
  measure,
  measureId,
  meetingOn,
  openMadeUpIndex,
  postingLink,
  pullOf,
  session,
  snapshot,
  storedOf,
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
/** MADE UP: an ORS section that does not exist. */
const orsSection = { type: "section", id: "ors-100.001" as OrsSectionId, resolvableOnOregonAi: true } as const;
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

describe("an Agency Link the reader hands out", () => {
  it("carries the Listing of the link, which follows its evidence Documents, and of the node it sits on", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullListing(firstLetter, secondLetter));
    index.writer.recordFullPull(session, asOf(2), pullListing(secondLetter));
    index.writer.recordFullPull(session, asOf(3), pullListing(secondLetter));

    // The first letter is No longer listed and the second is listed, so the link they make is listed; its node, the Measure, is.
    const whileOneIsListed = index.reader.findAgencyLinks(session, { agency });
    expect(whileOneIsListed.map((link) => [link.document.id, link.listing, link.node.listing])).toEqual([
      [firstLetter.link.id, { listed: true, lastListedAt: asOf(3) }, { listed: true, lastListedAt: asOf(3) }],
      [secondLetter.link.id, { listed: true, lastListedAt: asOf(3) }, { listed: true, lastListedAt: asOf(3) }],
    ]);

    // No letter is listed: the link is No longer listed (last listed by the latest pull that listed a letter), and the Measure is still listed.
    index.writer.recordFullPull(session, asOf(4), pullListing());
    index.writer.recordFullPull(session, asOf(5), pullListing());
    const whenNoneIs = index.reader.findAgencyLinks(session, { measure });
    expect(whenNoneIs.map((link) => [link.document.id, link.listing, link.node.listing])).toEqual([
      [firstLetter.link.id, { listed: false, lastListedAt: asOf(3) }, { listed: true, lastListedAt: asOf(5) }],
      [secondLetter.link.id, { listed: false, lastListedAt: asOf(3) }, { listed: true, lastListedAt: asOf(5) }],
    ]);
  });

  it("is listed when its node is No longer listed and its evidence is not: the two Listings are the node's and the link's own", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullListing(firstLetter));
    // Two pulls that list the letter and not the Measure.
    const withoutMeasure = { ...pullListing(firstLetter), measures: [] };
    index.writer.recordFullPull(session, asOf(2), withoutMeasure);
    index.writer.recordFullPull(session, asOf(3), withoutMeasure);

    const [link] = index.reader.findAgencyLinks(session, { agency });
    expect(link?.listing).toEqual({ listed: true, lastListedAt: asOf(3) });
    expect(link?.node.listing).toEqual({ listed: false, lastListedAt: asOf(1) });
  });

  it("sits on a Version whose Listing is the Version's, and on a Proposed Amendment whose Listing follows its Postings", () => {
    index = openMadeUpIndex();
    const first = postingLink(1, 10);
    const second = postingLink(2, 11);
    const meetings = [meetingOn(10), meetingOn(11)];
    const pulling = (...documentLinks: (typeof version)[]): ReturnType<typeof pullOf> =>
      pullOf({ measures: [measure], committees: [committee], meetings, documentLinks });
    index.writer.recordFullPull(session, asOf(1), pulling(version, first, second));
    for (const link of [version, first, second])
      storeMadeUpDocument(index, link, "Made-up text that names the Bureau.");
    for (const link of [version, first]) {
      index.writer.storeAgencyRead(
        {
          documentId: link.id,
          links: [{ agency, evidence: { kind: "named-in-text", terms: ["Bureau of Made-up Things"] } }],
          unresolvedUnits: [],
        },
        snapshot,
      );
    }
    // The Version and the first Posting are missed by two pulls; the second Posting is not.
    index.writer.recordFullPull(session, asOf(2), pulling(second));
    index.writer.recordFullPull(session, asOf(3), pulling(second));

    // The reader gives the links in no particular order, so they are told apart by the node they sit on.
    const nodes = index.reader
      .findAgencyLinks(session, { agency })
      .map((link) => [link.node.id, link.listing, link.node.listing] as const)
      .toSorted(([a], [b]) => a.localeCompare(b));
    expect(nodes).toEqual([
      [amendmentId, { listed: true, lastListedAt: asOf(3) }, { listed: true, lastListedAt: asOf(3) }],
      [version.id, { listed: false, lastListedAt: asOf(1) }, { listed: false, lastListedAt: asOf(1) }],
    ]);
  });
});

describe("a Statute Link's node", () => {
  it("carries the Listing of the Version it sits on", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullListing());
    const text = "Section 1. ORS 100.001 is amended.";
    storeMadeUpDocument(index, version, text);
    index.writer.storeStatuteParse(
      {
        contentHash: storedOf(version, text).contentHash,
        readAs: "version",
        textRead: true,
        amendedVersionHeader: null,
        links: [{ kind: "amends", target: orsSection, measureSection: "1" }],
        relatingClauseEdits: [],
      },
      snapshot,
    );
    const nodeListing = (): unknown =>
      index.reader.findStatuteLinked(session, { section: orsSection.id })[0]?.node.listing;

    // The pulls list the Measure but not the Version: one miss, then two.
    index.writer.recordFullPull(session, asOf(2), pullOf({ measures: [measure] }));
    expect(nodeListing()).toEqual({ listed: true, lastListedAt: asOf(1) });
    index.writer.recordFullPull(session, asOf(3), pullOf({ measures: [measure] }));
    expect(nodeListing()).toEqual({ listed: false, lastListedAt: asOf(1) });
  });
});
