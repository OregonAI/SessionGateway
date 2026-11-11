// Seam 4 (test/CLAUDE.md): the last fetch failure the worker records for a document the index holds no file of, and the
// reader hands out (ticket #168, ADR-0048's seventh step, ADR-0063). A WAL database in a temp directory of each case's own; a
// case arranges state through the writer's entry points and asserts what the reader's entry points return. Every value is
// MADE UP (made-up-index.ts): the Testimony, the Version, the reasons and the byte counts. What an agent is told of it is
// seam 1's (test/tools/get-document-fetch-cause-pull.test.ts).
//
// What the cases pin: a document has at most one record, the one of the worker's latest attempt, which replaces any before
// it, and storing the document's file clears it.
import { afterEach, describe, expect, test } from "vitest";
import type { LastFetchFailure } from "#/packages/domain/documents.ts";
import {
  asOf,
  committee,
  measure,
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

const testimony = testimonyRecord(1);
const version = versionLink("B-Engrossed");

function pulled(): void {
  index = openMadeUpIndex();
  index.writer.recordFullPull(
    session,
    asOf(1),
    pullOf({
      Measures: [measure],
      Committees: [committee],
      MeasureDocuments: [version],
      CommitteePublicTestimonies: [testimony],
    }),
  );
}

const empty: LastFetchFailure = { cause: "empty_file", reason: "MADE UP: the file has no bytes" };
const unreadable: LastFetchFailure = { cause: "unreadable_file", reason: "MADE UP: not a PDF the extractor can read" };
const cutOff: LastFetchFailure = {
  cause: "request_failed",
  reason: "MADE UP: the file stopped coming",
  bytesReceived: 512,
};
const unanswered: LastFetchFailure = { cause: "request_failed", reason: "MADE UP: OLIS answered 404" };

describe("the last fetch failure of a document the index holds no file of", () => {
  test("is none while the worker has recorded none", () => {
    pulled();

    expect(index.reader.lastFetchFailureOf(testimony.link.id)).toBeUndefined();
    expect(index.reader.lastFetchFailureOf(version.id)).toBeUndefined();
  });

  test.for([
    ["an empty file", empty],
    ["an unreadable file", unreadable],
    ["a request cut off after some bytes", cutOff],
    ["a request with no bytes of the file", unanswered],
  ] as const)("is read back as recorded: %s", ([, failure]) => {
    pulled();

    index.writer.recordFetchFailure(testimony.link.id, failure);

    // Strict, so a request with no bytes of the file reads back with no bytesReceived at all.
    expect(index.reader.lastFetchFailureOf(testimony.link.id)).toStrictEqual(failure);
    expect(index.reader.lastFetchFailureOf(version.id), "it is the one document's").toBeUndefined();
  });

  test("is the latest attempt's: each record replaces the one before it", () => {
    pulled();

    index.writer.recordFetchFailure(version.id, cutOff);
    index.writer.recordFetchFailure(version.id, empty);
    expect(index.reader.lastFetchFailureOf(version.id)).toStrictEqual(empty);

    index.writer.recordFetchFailure(version.id, unanswered);
    expect(index.reader.lastFetchFailureOf(version.id)).toStrictEqual(unanswered);
  });

  test("is cleared when the document's file is stored", () => {
    pulled();
    index.writer.recordFetchFailure(version.id, unreadable);

    storeMadeUpDocument(index, version, "MADE UP text of SB 9001's B-Engrossed Version");

    expect(index.reader.lastFetchFailureOf(version.id)).toBeUndefined();
    expect(index.reader.findDocument(version.id)).toMatchObject({ held: true });
  });
});
