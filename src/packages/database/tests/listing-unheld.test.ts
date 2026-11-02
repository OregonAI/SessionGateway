// Seam 4 (test/CLAUDE.md): an id the feed has a row for and the index holds no file of is handed out with its Listing too
// (ticket #97), by the same entry point as a Document it holds (`findDocument`), so that `get_document` can tell a row the
// feed no longer lists from a Testimony it still has to fetch without asking three methods. A held Document says `held:
// true`; one the index lacks says `held: false`, whether the row is Testimony, and its Listing. An id no row names is
// undefined. Each case has a database of its own. Every value is MADE UP (made-up-index.ts).
import { afterEach, describe, expect, it } from "vitest";
import {
  amendmentId,
  asOf,
  committee,
  exhibitLink,
  meetingOn,
  openMadeUpIndex,
  postingLink,
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

const exhibit = exhibitLink();
const testimony = testimonyRecord(1);
const posting = postingLink(1, 10);
const context = { committees: [committee], meetings: [meetingOn(10)] };

describe("an id the feed has a row for and the index holds no file of", () => {
  it("is handed out with its Listing: listed after one miss, No longer listed after two", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf({ ...context, documentLinks: [exhibit] }));
    expect(index.reader.findDocument(exhibit.id)).toEqual({
      held: false,
      testimony: false,
      listing: { listed: true, lastListedAt: asOf(1) },
    });

    index.writer.recordFullPull(session, asOf(2), pullOf());
    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(index.reader.findDocument(exhibit.id)).toEqual({
      held: false,
      testimony: false,
      listing: { listed: false, lastListedAt: asOf(1) },
    });
  });

  it("says when the row is Testimony, whose file the next pull fetches while the feed lists it", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(
      session,
      asOf(1),
      pullOf({ ...context, documentLinks: [testimony.link], testimony: [testimony] }),
    );
    expect(index.reader.findDocument(testimony.link.id)).toEqual({
      held: false,
      testimony: true,
      listing: { listed: true, lastListedAt: asOf(1) },
    });

    index.writer.recordFullPull(session, asOf(2), pullOf());
    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(index.reader.findDocument(testimony.link.id)).toEqual({
      held: false,
      testimony: true,
      listing: { listed: false, lastListedAt: asOf(1) },
    });
  });

  it("says that Testimony an Increment stored is listed with no last listing", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf());
    index.writer.recordIncrement(
      session,
      asOf(2),
      pullOf({ ...context, documentLinks: [testimony.link], testimony: [testimony] }),
    );
    expect(index.reader.findDocument(testimony.link.id)).toEqual({
      held: false,
      testimony: true,
      listing: { listed: true, lastListedAt: null },
    });
  });

  it("is a Proposed Amendment's Listing, when the amendment's Postings are listed and none of their files is held", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf({ ...context, documentLinks: [posting] }));
    index.writer.recordFullPull(session, asOf(2), pullOf());
    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(index.reader.findDocument(amendmentId)).toEqual({
      held: false,
      testimony: false,
      listing: { listed: false, lastListedAt: asOf(1) },
    });
  });
});

describe("an id no row of the feed names", () => {
  it("is undefined", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf());
    expect(index.reader.findDocument(versionLink().id)).toBeUndefined();
    expect(index.reader.findDocument(amendmentId)).toBeUndefined();
  });
});

describe("a Document the index holds", () => {
  it("says it is held, with its text and its Listing", () => {
    index = openMadeUpIndex();
    const version = versionLink();
    index.writer.recordFullPull(session, asOf(1), pullOf({ documentLinks: [version] }));
    storeMadeUpDocument(index, version, "A made-up Version.");
    const found = index.reader.findDocument(version.id);
    expect(found).toMatchObject({ held: true, listing: { listed: true, lastListedAt: asOf(1) } });
    expect(found?.held === true ? found.document.text : undefined).toBe("A made-up Version.");
  });
});
