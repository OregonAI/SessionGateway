// Seam 4: the Index's schema version (ADR-0048, ticket #95). The writer and the reader are opened directly on a WAL file
// in a temp directory of the test's own, no fake OLIS and no MCP client. A file at another version is arranged with
// SQL (`arranged-files.ts`, as `test/support/old-database.ts` arranges the harness's old files), and every assertion
// goes through the entry points: the version is seen as a reader that opens the file or refuses it, never as a read of
// the file's header. Steps 1 (the schema as of version 1), 2, 3, 4, 5, 6, 7, 8, 9 and 10 exist; step 2 (ticket #126) adds the speaker-turn index and drops the view nothing reads; step 3 (ticket #127) links a Passage to the turn it is (seam 1's search-speaker-turns-pull.test.ts and speaker-turn-passages.test.ts); step 4 (ticket #134) stores a Meeting's transcript passages (transcript-storage.test.ts); step 5 (ticket #153) stores the feed's CreatedDate of sponsors, history actions, votes, meetings and agenda items (created-before-clock.test.ts and the case below); step 6 (ticket #160) stores a Recording Log's link annotations (link-annotations.test.ts and the case below); step 7 (ticket #168) stores the last fetch failure of each unheld document (last-fetch-failure.test.ts and the case below); step 8 (ticket #183) stores the version of the Statute Link parser beside each reading (snapshot-read.test.ts and the case below); step 9 (ticket #184) stores the version of the Statutes Affected Table parser beside the held table (snapshot-read.test.ts and the case below); step 10 (ticket #187, ADR-0066) stores the version of the reader that made each stored reading no snapshot change reaches, beginning with the Agency Links (snapshot-read.test.ts and the case below); the next ticket that changes a table adds step 11 and its test.
import { afterEach, describe, expect, test } from "vitest";
import { openIndexReader } from "../reader.ts";
import { afterEverythingMadeUp } from "./clock.ts";
import { openSearchReader } from "../search.ts";
import { openIndexWriter } from "../writer.ts";
import {
  buildFrozenVersionOne,
  createIndexFile,
  leaveAsBeforeVersions,
  leaveAsVersionFive,
  leaveAsVersionEight,
  leaveAsVersionNine,
  leaveAsVersionSeven,
  leaveAsVersionSix,
  leaveAsVersionFour,
  leaveAsVersionThree,
  stampSchemaVersion,
  type IndexFile,
} from "./arranged-files.ts";
import {
  asOf,
  measure,
  measureKey,
  pullOf,
  session as madeUpSession,
  searchRecordOf,
  snapshot,
  sponsor,
  storedOf,
  testimonyRecord,
  versionLink,
} from "./made-up-index.ts";
import { nothingPulled, pulledAt, pulledAtText, session } from "./nothing-pulled.ts";
import type { DocumentId } from "#/packages/domain/documents.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/** Any version above 0 will do: the file is read again whenever the recorded one differs from the one asked for. */
const currentParser = 1;

/** A held Statutes Affected Table, read with the made-up snapshot. */
const heldTable = {
  sourceUrl: "https://www.oregonlegislature.gov/AutoPubs/artables2099R1.pdf",
  retrievedAt: asOf(1),
  contentHash: "0".repeat(64),
  pageCount: 1,
  text: "MADE UP: the text of the held table",
  entries: [],
  snapshotCommit: snapshot.commit,
  parserVersion: 1,
};

const files: IndexFile[] = [];
const connections: { close(): void }[] = [];

afterEach(() => {
  try {
    // A connection a test closed is no longer in the list, so a close that throws here is a real failure.
    for (const connection of connections.splice(0)) connection.close();
  } finally {
    for (const file of files.splice(0)) file.remove();
  }
});

function newFile(): IndexFile {
  const file = createIndexFile();
  files.push(file);
  return file;
}

function writerOn(path: string): ReturnType<typeof openIndexWriter> {
  const writer = openIndexWriter(path);
  connections.push(writer);
  return writer;
}

/** Closes a connection the test is done with and takes it off the list that `afterEach` closes. */
function closed(connection: { close(): void }): void {
  connection.close();
  connections.splice(connections.indexOf(connection), 1);
}

/** A file the writer created and closed: the state a deployment's first worker run leaves. */
function createdFile(): IndexFile {
  const file = newFile();
  closed(writerOn(file.path));
  return file;
}

const readers = [
  ["the index reader", (path: string) => openIndexReader(path, afterEverythingMadeUp)],
  ["the search reader", (path: string) => openSearchReader(path, afterEverythingMadeUp)],
] as const;

describe.for(readers)("%s", ([, openReader]) => {
  test("opens a new file: the writer creates it at version 10, the one version the reader knows", () => {
    const file = createdFile();

    expect(() => {
      connections.push(openReader(file.path));
    }).not.toThrow();
  });

  test.for([11, 12])("refuses a file at version %i, naming that version and the version 10 it knows", (found) => {
    const file = createdFile();
    stampSchemaVersion(file.path, found);

    expect(() => openReader(file.path)).toThrow(new RegExp(`version ${String(found)}\\b.*version 10\\b`));
  });

  test("refuses a file with no recorded version, saying the worker has not opened it yet and to start the worker first", () => {
    const file = createdFile();
    stampSchemaVersion(file.path, 0);

    expect(() => openReader(file.path)).toThrow(
      /no recorded schema version.*worker has not opened it yet.*start the ingest worker first/is,
    );
  });

  test("refuses a file that does not exist, naming the path and saying to start the ingest worker first", () => {
    const file = newFile();

    expect(() => openReader(file.path)).toThrow(`"${file.path}"`);
    expect(() => openReader(file.path)).toThrow(/start the ingest worker first/i);
  });
});

describe("the writer", () => {
  test("gives a file with no version today's tables and stamps it 10, and the file keeps its rows", () => {
    const file = newFile();
    const first = writerOn(file.path);
    first.recordFullPull(session, pulledAt, nothingPulled);
    closed(first);
    // The file of a worker that predates the listing tables and the version: no version, and the tables are missing.
    leaveAsBeforeVersions(file.path);
    expect(
      () => openIndexReader(file.path, afterEverythingMadeUp),
      "the server refuses it until the worker has upgraded it",
    ).toThrow(/no recorded schema version/);

    const upgraded = writerOn(file.path);

    // The tables the file lacked are back, empty.
    expect(upgraded.listingCounts(session)).toEqual([]);
    expect(upgraded.committeeMembers(session)).toEqual([]);
    closed(upgraded);
    // It is at version 10 now, so the reader opens it, and the row it held is there.
    const reader = openIndexReader(file.path, afterEverythingMadeUp);
    connections.push(reader);
    expect(reader.lastFullPull(session)).toBe(pulledAtText);
  });

  test("upgrades a file at version 3 with step 4: the transcript tables are made, empty, and the file keeps its rows", () => {
    const file = newFile();
    const first = writerOn(file.path);
    first.recordFullPull(session, pulledAt, nothingPulled);
    closed(first);
    leaveAsVersionThree(file.path);
    expect(
      () => openIndexReader(file.path, afterEverythingMadeUp),
      "the server refuses it until the worker has upgraded it",
    ).toThrow(/version 3\b.*version 10\b/);

    const upgraded = writerOn(file.path);

    expect(upgraded.transcriptNotes(session)).toEqual({ stored: 0, driftFlags: [] });
    expect(upgraded.storedTranscripts(session)).toEqual([]);
    closed(upgraded);
    const reader = openIndexReader(file.path, afterEverythingMadeUp);
    connections.push(reader);
    expect(reader.lastFullPull(session)).toBe(pulledAtText);
  });

  test("upgrades a file at version 4 with step 5: a row held has no creation time and is shown, and the next full pull stores it, which hides the row before it", () => {
    const file = newFile();
    const first = writerOn(file.path);
    first.recordFullPull(madeUpSession, asOf(1), pullOf({ Measures: [measure], MeasureSponsors: [sponsor] }));
    closed(first);
    leaveAsVersionFour(file.path);
    expect(
      () => openIndexReader(file.path, afterEverythingMadeUp),
      "the server refuses it until the worker has upgraded it",
    ).toThrow(/version 4\b.*version 10\b/);

    const upgraded = writerOn(file.path);
    let now = new Date("2099-01-04T00:00:00-08:00");
    const reader = openIndexReader(file.path, { now: () => now });
    connections.push(reader);
    // Until the next full pull the row has no time, and a row with no time is shown.
    expect(reader.findSponsors(measureKey)).toHaveLength(1);

    upgraded.recordFullPull(
      madeUpSession,
      asOf(2),
      pullOf({
        Measures: [measure],
        MeasureSponsors: [{ ...sponsor, createdAt: "2099-01-05T10:00:00-08:00" as Timestamp }],
      }),
    );
    expect(reader.findSponsors(measureKey)).toHaveLength(0);
    now = new Date("2099-01-05T10:00:00-08:00");
    expect(reader.findSponsors(measureKey)).toHaveLength(1);
  });

  test("upgrades a file at version 5 with step 6: a log's link annotations are stored and read, and the rows it held stay", () => {
    const file = newFile();
    const first = writerOn(file.path);
    first.recordFullPull(madeUpSession, asOf(1), pullOf({ Measures: [measure], MeasureSponsors: [sponsor] }));
    closed(first);
    leaveAsVersionFive(file.path);
    expect(
      () => openIndexReader(file.path, afterEverythingMadeUp),
      "the server refuses it until the worker has upgraded it",
    ).toThrow(/version 5\b.*version 10\b/);

    const upgraded = writerOn(file.path);
    const logId = "recording-log-2099r1-1" as DocumentId;
    const annotation = { page: 1, url: "https://made-up.example/mediaplayer?eventID=2099010001&startStreamAt=5" };
    const reader = openIndexReader(file.path, afterEverythingMadeUp);
    connections.push(reader);
    expect(reader.linkAnnotationsOf(logId), "the table is made, empty").toEqual([]);

    upgraded.storeLinkAnnotations(logId, [annotation]);

    expect(reader.linkAnnotationsOf(logId)).toEqual([annotation]);
    expect(reader.findSponsors(measureKey)).toHaveLength(1);
  });

  test("upgrades a file at version 6 with step 7: an unheld document's last fetch failure is stored and read, and the rows it held stay", () => {
    const file = newFile();
    const testimony = testimonyRecord(1);
    const first = writerOn(file.path);
    first.recordFullPull(
      madeUpSession,
      asOf(1),
      pullOf({ Measures: [measure], MeasureSponsors: [sponsor], CommitteePublicTestimonies: [testimony] }),
    );
    closed(first);
    leaveAsVersionSix(file.path);
    expect(
      () => openIndexReader(file.path, afterEverythingMadeUp),
      "the server refuses it until the worker has upgraded it",
    ).toThrow(/version 6\b.*version 10\b/);

    const upgraded = writerOn(file.path);
    const reader = openIndexReader(file.path, afterEverythingMadeUp);
    connections.push(reader);
    expect(reader.lastFetchFailureOf(testimony.link.id), "the table is made, empty").toBeUndefined();

    // MADE UP: what the worker records when OLIS serves the file with no bytes.
    const failure = { cause: "empty_file", reason: "MADE UP: the file is empty" } as const;
    upgraded.recordFetchFailure(testimony.link.id, failure);

    expect(reader.lastFetchFailureOf(testimony.link.id)).toEqual(failure);
    expect(reader.findSponsors(measureKey)).toHaveLength(1);
  });

  test("upgrades a file at version 7 with step 8: a stored reading counts as read by an older parser, so the file is read again, and the rows stay", () => {
    const file = newFile();
    const link = versionLink();
    const text = "Section 1. ORS 100.001 is amended.";
    const first = writerOn(file.path);
    first.recordFullPull(madeUpSession, asOf(1), pullOf({ Measures: [measure], MeasureSponsors: [sponsor] }));
    first.storeDocument(madeUpSession, storedOf(link, text), searchRecordOf(link, text));
    first.storeStatuteParse(
      {
        contentHash: storedOf(link, text).contentHash,
        readAs: "version",
        textRead: true,
        amendedVersionHeader: null,
        links: [],
        relatingClauseEdits: [],
        parserVersion: currentParser,
      },
      snapshot,
    );
    expect(first.unreadStatuteFiles(madeUpSession, snapshot, currentParser), "read with the current parser").toEqual(
      [],
    );
    closed(first);
    leaveAsVersionSeven(file.path);
    expect(
      () => openIndexReader(file.path, afterEverythingMadeUp),
      "the server refuses it until the worker has upgraded it",
    ).toThrow(/version 7\b.*version 10\b/);

    const upgraded = writerOn(file.path);

    expect(
      upgraded.unreadStatuteFiles(madeUpSession, snapshot, currentParser).map((unread) => unread.documentId),
      "the reading from before the step is read again",
    ).toEqual([link.id]);
    expect(upgraded.unreadStatuteFiles(madeUpSession, snapshot, 0), "it counts as read by parser version 0").toEqual(
      [],
    );
    const reader = openIndexReader(file.path, afterEverythingMadeUp);
    connections.push(reader);
    expect(reader.findSponsors(measureKey)).toHaveLength(1);
  });

  test("upgrades a file at version 8 with step 9: a held table's reading counts as read by an older table parser, so the table is read again, and the rows stay", () => {
    const file = newFile();
    const first = writerOn(file.path);
    first.recordFullPull(madeUpSession, asOf(1), pullOf({ Measures: [measure], MeasureSponsors: [sponsor] }));
    first.storeStatutesAffectedTable(madeUpSession, { ...heldTable, parserVersion: currentParser });
    expect(first.heldStatutesAffectedTable(madeUpSession)?.parserVersion, "read with the current parser").toBe(
      currentParser,
    );
    closed(first);
    leaveAsVersionEight(file.path);
    expect(
      () => openIndexReader(file.path, afterEverythingMadeUp),
      "the server refuses it until the worker has upgraded it",
    ).toThrow(/version 8\b.*version 10\b/);

    const upgraded = writerOn(file.path);

    expect(
      upgraded.heldStatutesAffectedTable(madeUpSession)?.parserVersion,
      "the reading from before the step counts as read by parser version 0, older than any the code carries",
    ).toBe(0);
    const reader = openIndexReader(file.path, afterEverythingMadeUp);
    connections.push(reader);
    expect(reader.findSponsors(measureKey)).toHaveLength(1);
  });

  test("upgrades a file at version 9 with step 10: a document's Agency Link reading counts as read by reader version 0, so it is read again, and the rows stay", () => {
    const file = newFile();
    const link = versionLink();
    const text = "Section 1. The Made-up Bureau acts.";
    const first = writerOn(file.path);
    first.recordFullPull(madeUpSession, asOf(1), pullOf({ Measures: [measure], MeasureSponsors: [sponsor] }));
    first.storeDocument(madeUpSession, storedOf(link, text), searchRecordOf(link, text));
    first.storeAgencyRead(
      { documentId: link.id, links: [], unresolvedUnits: [], readerVersion: currentParser },
      snapshot,
    );
    expect(first.unreadAgencyDocuments(madeUpSession, snapshot, currentParser), "read with the current reader").toEqual(
      [],
    );
    closed(first);
    leaveAsVersionNine(file.path);
    expect(
      () => openIndexReader(file.path, afterEverythingMadeUp),
      "the server refuses it until the worker has upgraded it",
    ).toThrow(/version 9\b.*version 10\b/);

    const upgraded = writerOn(file.path);

    expect(
      upgraded.unreadAgencyDocuments(madeUpSession, snapshot, currentParser).map((unread) => unread.documentId),
      "the reading from before the step is read again",
    ).toEqual([link.id]);
    expect(upgraded.unreadAgencyDocuments(madeUpSession, snapshot, 0), "it counts as read by reader version 0").toEqual(
      [],
    );
    const reader = openIndexReader(file.path, afterEverythingMadeUp);
    connections.push(reader);
    expect(reader.findSponsors(measureKey)).toHaveLength(1);
  });

  test("refuses a file at a newer version than it knows, naming both, and leaves it at that version", () => {
    const file = createdFile();
    stampSchemaVersion(file.path, 11);

    expect(() => openIndexWriter(file.path)).toThrow(/version 11\b.*version 10\b/);

    // It was not downgraded or stamped over: the server still sees version 11.
    expect(() => openIndexReader(file.path, afterEverythingMadeUp)).toThrow(/version 11\b.*version 10\b/);
  });
});

// The guard on version 1's text (ADR-0048). A deployed file was built from the text in `lib/connection.ts` and is stamped
// 1, so the worker never runs that text on it again; an edit of the text without a numbered step leaves such a file
// without what the new code needs. `version-one-schema.sql` is a frozen copy of the text as it was. The writer and both
// readers prepare their statements when they open, so a statement that needs a table or column the frozen file lacks
// throws at open, and this test goes red. A test of a step that adds a column or table builds its file from the same
// frozen text with the step not yet run (ticket #126's test of step 2 is in speaker-turn-index.test.ts).
describe("a file built from the frozen text of version 1", () => {
  test("is opened by the writer, the index reader and the search reader as it stands, and a pull's worth of reads works", () => {
    const file = newFile();
    buildFrozenVersionOne(file.path);

    const writer = writerOn(file.path);
    writer.recordFullPull(session, pulledAt, nothingPulled);
    closed(writer);
    const index = openIndexReader(file.path, afterEverythingMadeUp);
    connections.push(index);
    const search = openSearchReader(file.path, afterEverythingMadeUp);
    connections.push(search);

    expect(index.lastFullPull(session)).toBe(pulledAtText);
    expect(search.generation()).toBe(0);
    expect(search.vectorCount(session, "no-model")).toBe(0);
  });
});
