// Seam 4 (test/CLAUDE.md): the Index's As of, "the moment the latest complete Full pull, or a later Increment, began"
// (GLOSSARY.md, ADR-0039), through the database's entry points. The worker's Increment reads it from the writer to know
// how far back to read, and the server's envelope reads it from the reader to stamp every result, so the two must give
// one answer from one rule (ticket #100). Each case arranges state with the writer (`recordFullPull`, `recordIncrement`,
// `recordFullPullAttempt`) and asserts what both sides answer, never with SQL. Each case has a database of its own. Every
// value is MADE UP (made-up-index.ts); the expected times are literals written out from the glossary's sentence.
import { afterEach, describe, expect, it } from "vitest";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { asOf, openMadeUpIndex, pullOf, session, type MadeUpIndex } from "./made-up-index.ts";

let index: MadeUpIndex;
afterEach(() => {
  index.close();
});

/** What the worker's writer and the server's reader each say the As of is, for the made-up Session. */
function asOfBoth(of: SessionKey = session): { writer: Timestamp | undefined; reader: Timestamp | undefined } {
  return { writer: index.writer.asOf(of), reader: index.reader.asOf(of) };
}

describe("the Index's As of", () => {
  it("is none until a Full pull has completed, for the writer and the reader alike", () => {
    index = openMadeUpIndex();
    expect(asOfBoth()).toEqual({ writer: undefined, reader: undefined });
  });

  it("is the start of the Full pull while no Increment has run", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf());
    expect(asOfBoth()).toEqual({ writer: "2099-01-01T02:10:00-08:00", reader: "2099-01-01T02:10:00-08:00" });
  });

  it("is the start of an Increment that began after the Full pull", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf());
    index.writer.recordIncrement(session, asOf(2), pullOf());
    expect(asOfBoth()).toEqual({ writer: "2099-01-02T02:10:00-08:00", reader: "2099-01-02T02:10:00-08:00" });

    // A second Increment moves it again.
    index.writer.recordIncrement(session, asOf(3), pullOf());
    expect(asOfBoth()).toEqual({ writer: "2099-01-03T02:10:00-08:00", reader: "2099-01-03T02:10:00-08:00" });
  });

  it("goes back to the Full pull when a Full pull completes after the last Increment", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf());
    index.writer.recordIncrement(session, asOf(2), pullOf());
    index.writer.recordFullPull(session, asOf(3), pullOf());
    expect(asOfBoth()).toEqual({ writer: "2099-01-03T02:10:00-08:00", reader: "2099-01-03T02:10:00-08:00" });
  });

  it("orders the two by the moments they name and not by their text, on the night the clocks go back", () => {
    index = openMadeUpIndex();
    // MADE UP: the Full pull began at 01:45 PDT (08:45 UTC) and the Increment at 01:15 PST (09:15 UTC), half an hour
    // later though its text sorts first.
    index.writer.recordFullPull(session, "2099-11-01T01:45:00-07:00" as Timestamp, pullOf());
    index.writer.recordIncrement(session, "2099-11-01T01:15:00-08:00" as Timestamp, pullOf());
    expect(asOfBoth()).toEqual({ writer: "2099-11-01T01:15:00-08:00", reader: "2099-11-01T01:15:00-08:00" });
  });

  it("is not moved by a Full pull the worker began and refused", () => {
    index = openMadeUpIndex();
    index.writer.recordFullPull(session, asOf(1), pullOf());
    index.writer.recordFullPullAttempt(session, asOf(2));
    expect(asOfBoth()).toEqual({ writer: "2099-01-01T02:10:00-08:00", reader: "2099-01-01T02:10:00-08:00" });
  });

  it("is a Session's own: another Session's pulls do not answer for it", () => {
    index = openMadeUpIndex();
    const other = "2099S1" as SessionKey;
    index.writer.recordFullPull(other, asOf(4), pullOf());
    expect(asOfBoth()).toEqual({ writer: undefined, reader: undefined });
    expect(asOfBoth(other)).toEqual({ writer: "2099-01-04T02:10:00-08:00", reader: "2099-01-04T02:10:00-08:00" });
  });
});
