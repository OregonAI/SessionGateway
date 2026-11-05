// Seam 4: the Index's schema version (ADR-0048, ticket #95). The writer and the reader are opened directly on a WAL file
// in a temp directory of the test's own, no fake OLIS and no MCP client. A file at another version is arranged with
// SQL (`arranged-files.ts`, as `test/support/old-database.ts` arranges the harness's old files), and every assertion
// goes through the entry points: the version is seen as a reader that opens the file or refuses it, never as a read of
// the file's header. Steps 1 (the schema as of version 1), 2 and 3 exist; step 2 (ticket #126) adds the speaker-turn index and drops the view nothing reads; step 3 (ticket #127) links a Passage to the turn it is (seam 1's search-speaker-turns-pull.test.ts and speaker-turn-passages.test.ts); the next ticket that changes a table adds step 4 and its test.
import { afterEach, describe, expect, test } from "vitest";
import { openIndexReader } from "../reader.ts";
import { openSearchReader } from "../search.ts";
import { openIndexWriter } from "../writer.ts";
import {
  buildFrozenVersionOne,
  createIndexFile,
  leaveAsBeforeVersions,
  stampSchemaVersion,
  type IndexFile,
} from "./arranged-files.ts";
import { nothingPulled, pulledAt, pulledAtText, session } from "./nothing-pulled.ts";

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
  ["the index reader", openIndexReader],
  ["the search reader", openSearchReader],
] as const;

describe.for(readers)("%s", ([, openReader]) => {
  test("opens a new file: the writer creates it at version 3, the one version the reader knows", () => {
    const file = createdFile();

    expect(() => {
      connections.push(openReader(file.path));
    }).not.toThrow();
  });

  test.for([4, 7])("refuses a file at version %i, naming that version and the version 3 it knows", (found) => {
    const file = createdFile();
    stampSchemaVersion(file.path, found);

    expect(() => openReader(file.path)).toThrow(new RegExp(`version ${String(found)}\\b.*version 3\\b`));
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
  test("gives a file with no version today's tables and stamps it 3, and the file keeps its rows", () => {
    const file = newFile();
    const first = writerOn(file.path);
    first.recordFullPull(session, pulledAt, nothingPulled);
    closed(first);
    // The file of a worker that predates the listing tables and the version: no version, and the tables are missing.
    leaveAsBeforeVersions(file.path);
    expect(() => openIndexReader(file.path), "the server refuses it until the worker has upgraded it").toThrow(
      /no recorded schema version/,
    );

    const upgraded = writerOn(file.path);

    // The tables the file lacked are back, empty.
    expect(upgraded.listingCounts(session)).toEqual([]);
    expect(upgraded.committeeMembers(session)).toEqual([]);
    closed(upgraded);
    // It is at version 3 now, so the reader opens it, and the row it held is there.
    const reader = openIndexReader(file.path);
    connections.push(reader);
    expect(reader.lastFullPull(session)).toBe(pulledAtText);
  });

  test("refuses a file at a newer version than it knows, naming both, and leaves it at that version", () => {
    const file = createdFile();
    stampSchemaVersion(file.path, 4);

    expect(() => openIndexWriter(file.path)).toThrow(/version 4\b.*version 3\b/);

    // It was not downgraded or stamped over: the server still sees version 4.
    expect(() => openIndexReader(file.path)).toThrow(/version 4\b.*version 3\b/);
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
    const index = openIndexReader(file.path);
    connections.push(index);
    const search = openSearchReader(file.path);
    connections.push(search);

    expect(index.lastFullPull(session)).toBe(pulledAtText);
    expect(search.generation()).toBe(0);
    expect(search.vectorCount(session, "no-model")).toBe(0);
  });
});
