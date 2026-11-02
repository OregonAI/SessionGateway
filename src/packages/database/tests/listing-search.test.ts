// Seam 4 (test/CLAUDE.md): what the Listing does to search (ADR-0005, ADR-0030) through the writer's, the reader's and
// search's entry points: a Document a complete Full pull makes No longer listed leaves search (the keyword side and the
// vectors the meaning side holds in memory), a Document listed again comes back, and in both cases the search generation
// moves, so a server that holds the vectors reads them again even when two pulls share an As of. Each case has a database
// of its own. The same cases hold search to the rule that a Document no complete Full pull has listed is listed (ADR-0030,
// ADR-0049): it stays in both sides however many pulls miss it, and the notes of an item the index holds and the feed no
// longer lists (`unlistedPostings`, `unlistedCiting`) never count it. Every value is MADE UP (made-up-index.ts).
import { afterEach, describe, expect, it } from "vitest";
import type { Citation } from "#/packages/domain/citations.ts";
import type { DocumentId, DocumentLink } from "#/packages/domain/documents.ts";
import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import {
  amendmentId,
  analysisLink,
  asOf,
  modelId,
  openMadeUpIndex,
  postingLink,
  pullOf,
  searchRecordOf,
  session,
  storedOf,
  storeMadeUpDocument,
  versionLink,
  type MadeUpIndex,
} from "./made-up-index.ts";

let index: MadeUpIndex;
afterEach(() => {
  index.close();
});

const version = versionLink();
const word = '"zebracrossing"';

/** MADE UP: the ORS section that some made-up documents name, as the notes of a citation are asked for it. */
const cited = "ors-468.130";

/** Stores a made-up document of this link that names `cited` once. */
function storeCiting(link: DocumentLink, text: string): void {
  const citation: Citation = {
    kind: "ors",
    id: cited as OrsSectionId,
    text: "ORS 468.130",
    index: text.indexOf("ORS"),
  };
  index.writer.storeDocument(session, storedOf(link, text), { ...searchRecordOf(link, text), citations: [citation] });
}

/** Stores a made-up document of this link, with a text of its own. */
function store(link: DocumentLink, text: string): void {
  index.writer.storeDocument(session, storedOf(link, text), searchRecordOf(link, text));
}

/** The ids of the documents search finds by the made-up word, and the ids whose vectors the meaning side would load. */
function whatSearchHolds(): { keyword: DocumentId[]; vectors: DocumentId[] } {
  const found = index.search.keyword(word, { session, withTestimony: false }, 10);
  return {
    keyword: found.map((match) => match.documentId),
    vectors: [...index.search.vectors(session, modelId)].map((row) => row.documentId),
  };
}

describe("a Document a complete Full pull makes No longer listed", () => {
  it("leaves search, comes back when a pull lists it again, and the search generation moves both times", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf({ documentLinks: [version] }));
    storeMadeUpDocument(index, version, "A zebracrossing is a made-up thing.");
    expect(whatSearchHolds()).toEqual({ keyword: [version.id], vectors: [version.id] });
    const listed = index.search.generation();

    // One miss leaves the Document in search, and the generation where it was.
    index.writer.recordFullPull(session, asOf(2), pullOf());
    expect(whatSearchHolds()).toEqual({ keyword: [version.id], vectors: [version.id] });
    expect(index.search.generation()).toBe(listed);

    // The second miss takes it out of both sides, and the generation moves.
    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(whatSearchHolds()).toEqual({ keyword: [], vectors: [] });
    expect(index.search.generation()).toBe(listed + 1);
    const served = index.reader.findDocument(version.id);
    expect(served?.held === true ? served.document.text : undefined).toBe("A zebracrossing is a made-up thing.");

    // A pull that lists it brings it back to both, and the generation moves again.
    index.writer.recordFullPull(session, asOf(4), pullOf({ documentLinks: [version] }));
    expect(whatSearchHolds()).toEqual({ keyword: [version.id], vectors: [version.id] });
    expect(index.search.generation()).toBe(listed + 2);
  });

  it("moves the generation when two pulls share an As of", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf({ documentLinks: [version] }));
    storeMadeUpDocument(index, version, "A zebracrossing is a made-up thing.");
    index.writer.recordFullPull(session, asOf(2), pullOf());
    const before = index.search.generation();

    index.writer.recordFullPull(session, asOf(2), pullOf());
    expect(index.search.generation()).toBe(before + 1);
    expect(whatSearchHolds()).toEqual({ keyword: [], vectors: [] });
  });

  it("leaves the generation where it was when a pull changes nothing search holds", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf({ documentLinks: [version] }));
    storeMadeUpDocument(index, version, "A zebracrossing is a made-up thing.");
    const before = index.search.generation();

    // Pulls that list the Document, and pulls that miss it once, leave search as it was.
    index.writer.recordFullPull(session, asOf(2), pullOf({ documentLinks: [version] }));
    index.writer.recordFullPull(session, asOf(3), pullOf({ documentLinks: [version] }));
    expect(index.search.generation()).toBe(before);
  });
});

describe("a Document no complete Full pull has listed", () => {
  it("stays in search however many complete pulls miss it: it has no row for them to miss", () => {
    index = openMadeUpIndex();
    // An Increment stores the Document, and three complete Full pulls follow that never list it.
    index.writer.recordIncrement(session, asOf(1), pullOf({ documentLinks: [version] }));
    storeMadeUpDocument(index, version, "A zebracrossing is a made-up thing.");
    index.writer.recordFullPull(session, asOf(2), pullOf());
    index.writer.recordFullPull(session, asOf(3), pullOf());
    index.writer.recordFullPull(session, asOf(4), pullOf());

    expect(whatSearchHolds()).toEqual({ keyword: [version.id], vectors: [version.id] });
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: null });
  });

  it("is in no note of an item the index holds and the feed no longer lists", () => {
    index = openMadeUpIndex();
    const posting = postingLink(1, 10);
    index.writer.recordIncrement(session, asOf(1), pullOf({ documentLinks: [posting, version] }));
    store(posting, "Amends a made-up thing.");
    storeCiting(version, "A made-up thing is under ORS 468.130.");
    index.writer.recordFullPull(session, asOf(2), pullOf());
    index.writer.recordFullPull(session, asOf(3), pullOf());
    index.writer.recordFullPull(session, asOf(4), pullOf());

    expect(index.search.unlistedPostings(amendmentId, session)).toBeUndefined();
    expect(index.search.unlistedCiting(cited, session)).toBeUndefined();
  });
});

describe("what the index holds of an item the feed no longer lists", () => {
  it("counts the postings of a Proposed Amendment that are No longer listed, and names the one listed last", () => {
    index = openMadeUpIndex();
    const first = postingLink(1, 10);
    const second = postingLink(2, 11);
    const third = postingLink(3, 12);
    index.writer.recordFullPull(session, asOf(1), pullOf({ documentLinks: [first, second, third] }));
    for (const posting of [first, second, third]) {
      store(posting, `Amends ${posting.id}.`);
    }
    index.writer.recordFullPull(session, asOf(2), pullOf({ documentLinks: [second, third] }));
    expect(index.search.unlistedPostings(amendmentId, session)).toBeUndefined();

    // Pull 3 lists only the third: the first (last listed by pull 1) is No longer listed, the second (pull 2) is not yet.
    index.writer.recordFullPull(session, asOf(3), pullOf({ documentLinks: [third] }));
    expect(index.search.unlistedPostings(amendmentId, session)).toEqual({
      count: 1,
      latest: { documentId: first.id, nodeId: amendmentId, lastListedAt: asOf(1) },
    });

    // Pull 4 lists none: the second joins it, and the one listed last is the second (pull 2, against pull 1).
    index.writer.recordFullPull(session, asOf(4), pullOf({ documentLinks: [third] }));
    index.writer.recordFullPull(session, asOf(5), pullOf());
    expect(index.search.unlistedPostings(amendmentId, session)).toEqual({
      count: 2,
      latest: { documentId: second.id, nodeId: amendmentId, lastListedAt: asOf(2) },
    });
  });

  it("counts the Documents that name a citation and are No longer listed, and names the one listed last", () => {
    index = openMadeUpIndex();
    const analysis = analysisLink();
    index.writer.recordFullPull(session, asOf(1), pullOf({ documentLinks: [version, analysis] }));
    storeCiting(version, "A made-up thing is under ORS 468.130.");
    storeCiting(analysis, "The made-up thing falls under ORS 468.130.");
    index.writer.recordFullPull(session, asOf(2), pullOf({ documentLinks: [analysis] }));
    expect(index.search.unlistedCiting(cited, session)).toBeUndefined();

    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(index.search.unlistedCiting(cited, session)).toEqual({
      count: 1,
      latest: { documentId: version.id, nodeId: version.id, lastListedAt: asOf(1) },
    });

    index.writer.recordFullPull(session, asOf(4), pullOf());
    expect(index.search.unlistedCiting(cited, session)).toEqual({
      count: 2,
      latest: { documentId: analysis.id, nodeId: analysis.id, lastListedAt: asOf(2) },
    });
    expect(index.search.unlistedCiting("ors-1.001", session)).toBeUndefined();
  });
});
