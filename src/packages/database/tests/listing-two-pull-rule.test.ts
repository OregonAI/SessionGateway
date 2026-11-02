// Seam 4 (test/CLAUDE.md): the two-pull rule of the Listing (ADR-0005, ADR-0030) through the database's entry points. A
// case arranges state with the writer (`recordFullPull`, `recordFullPullAttempt`, `recordIncrement`, `storeDocument`) and
// reads it back through the reader and search, never with SQL. Each case has a database of its own. Every value is MADE
// UP (made-up-index.ts); the expected Listings are literals, written out from the rule in ADR-0030 and the glossary.
import { afterEach, describe, expect, it } from "vitest";
import {
  asOf,
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

describe("a row a complete Full pull listed", () => {
  it("is listed after the next complete pull misses it, is no longer listed after a second, and is listed again when a pull lists it", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf({ MeasureDocuments: [version] }));
    storeMadeUpDocument(index, version, "Section 1. A made-up thing is created.");
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(1) });

    // Pull 2 misses the row: one miss is not a withdrawal.
    index.writer.recordFullPull(session, asOf(2), pullOf());
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(1) });

    // Pull 3 misses it too: no longer listed, and pull 1's As of is its last listing.
    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: false, lastListedAt: asOf(1) });

    // Pull 4 lists it: listed again, last listed by pull 4.
    index.writer.recordFullPull(session, asOf(4), pullOf({ MeasureDocuments: [version] }));
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(4) });
  });
});

describe("a Full pull the worker refused", () => {
  // A refused pull is an attempt that stored nothing: the worker records only that it began (`recordFullPullAttempt`).
  it("counts for nothing toward the two pulls: the row it did not list is listed after one complete miss", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf({ MeasureDocuments: [version] }));
    storeMadeUpDocument(index, version, "Section 1. A made-up thing is created.");

    index.writer.recordFullPullAttempt(session, asOf(2));
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(1) });
    expect(index.reader.lastFullPull(session)).toBe(asOf(1));

    // The complete pull that follows is the first to miss the row, not the second.
    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(1) });
  });

  it("does not stand between two complete pulls that miss the row: it is no longer listed after the second", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf({ MeasureDocuments: [version] }));
    storeMadeUpDocument(index, version, "Section 1. A made-up thing is created.");
    index.writer.recordFullPull(session, asOf(2), pullOf());

    index.writer.recordFullPullAttempt(session, asOf(3));
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(1) });

    index.writer.recordFullPull(session, asOf(4), pullOf());
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: false, lastListedAt: asOf(1) });
  });
});

describe("a row an increment stored, which no complete Full pull has listed", () => {
  it("is listed with no last listing, and stays so however many complete pulls miss it", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf());
    index.writer.recordIncrement(session, asOf(2), pullOf({ MeasureDocuments: [version] }));
    storeMadeUpDocument(index, version, "Section 1. A made-up thing is created.");
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: null });

    // No complete pull ever listed it, so none has anything to miss (ADR-0030, "What ticket #17 inherits").
    index.writer.recordFullPull(session, asOf(3), pullOf());
    index.writer.recordFullPull(session, asOf(4), pullOf());
    index.writer.recordFullPull(session, asOf(5), pullOf());
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: null });
  });

  it("is given a last listing by the first complete pull that lists it", () => {
    index = openMadeUpIndex();
    index.writer.recordIncrement(session, asOf(1), pullOf({ MeasureDocuments: [version] }));
    storeMadeUpDocument(index, version, "Section 1. A made-up thing is created.");
    index.writer.recordFullPull(session, asOf(2), pullOf({ MeasureDocuments: [version] }));
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(2) });
  });

  it("counts for nothing toward the two pulls of a row a complete pull listed", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf({ MeasureDocuments: [version] }));
    storeMadeUpDocument(index, version, "Section 1. A made-up thing is created.");
    index.writer.recordFullPull(session, asOf(2), pullOf());
    // An increment sees the row again between the two misses; it writes nothing to the row's listing.
    index.writer.recordIncrement(session, asOf(3), pullOf({ MeasureDocuments: [version] }));
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: true, lastListedAt: asOf(1) });

    index.writer.recordFullPull(session, asOf(4), pullOf());
    expect(index.reader.findDocument(version.id)?.listing).toEqual({ listed: false, lastListedAt: asOf(1) });
  });
});
