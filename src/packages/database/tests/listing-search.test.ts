// Seam 4 (test/CLAUDE.md): what the Listing does to search (ADR-0005, ADR-0030) through the writer's, the reader's and
// search's entry points: a Document a complete Full pull makes No longer listed leaves search (the keyword side and the
// vectors the meaning side holds in memory), a Document listed again comes back, and in both cases the search generation
// moves, so a server that holds the vectors reads them again even when two pulls share an As of. Each case has a database
// of its own. Every value is MADE UP (made-up-index.ts).
import { afterEach, describe, expect, it } from "vitest";
import type { DocumentId } from "#/packages/domain/documents.ts";
import {
  asOf,
  modelId,
  openMadeUpIndex,
  pullOf,
  session,
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
    expect(index.reader.findDocument(version.id)?.document.text).toBe("A zebracrossing is a made-up thing.");

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
