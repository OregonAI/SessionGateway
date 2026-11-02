// Seam 4: the Index's schema version (ADR-0048, ticket #95). The writer and the reader are opened directly on a WAL file
// in a temp directory of the test's own, no fake OLIS and no MCP client. A file at another version is arranged with
// SQL (`arranged-files.ts`, as `test/support/old-database.ts` arranges the harness's old files), and every assertion
// goes through the entry points: the version is seen as a reader that opens the file or refuses it, never as a read of
// the file's header. Only step 1 exists (today's schema); the first ticket that changes a table adds step 2 and its test.
import { afterEach, describe, expect, test } from "vitest";
import { parseSessionKey } from "#/packages/domain/index.ts";
import { readTimestamp } from "#/packages/time/pacific.ts";
import { openIndexReader } from "../reader.ts";
import { openSearchReader } from "../search.ts";
import { openIndexWriter, type FullPullRecord } from "../writer.ts";
import { createIndexFile, leaveAsBeforeVersions, stampSchemaVersion, type IndexFile } from "./arranged-files.ts";

const session = parseSessionKey("2025R1");
if (session === undefined) throw new Error("2025R1 is a Session key");
const pulledAt = readTimestamp("2025-03-01T10:00:00-08:00");
if (pulledAt === undefined) throw new Error("a Pacific time with an offset is a Timestamp");

const nothingPulled: FullPullRecord = {
  measures: [],
  history: [],
  legislatorRows: [],
  legislators: [],
  legislatorCodes: [],
  sponsors: [],
  floorVotes: [],
  committeeVotes: [],
  committees: [],
  meetings: [],
  agendaItems: [],
  documentLinks: [],
  testimony: [],
  committeeMembers: [],
  convenings: [],
  sessionDates: undefined,
};

const files: IndexFile[] = [];
const connections: { close(): void }[] = [];

afterEach(() => {
  for (const connection of connections.splice(0)) {
    try {
      connection.close();
    } catch {
      // Closed by the test.
    }
  }
  for (const file of files.splice(0)) file.remove();
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

/** A file the writer created and closed: the state a deployment's first worker run leaves. */
function createdFile(): IndexFile {
  const file = newFile();
  writerOn(file.path).close();
  return file;
}

const readers = [
  ["the index reader", openIndexReader],
  ["the search reader", openSearchReader],
] as const;

describe.for(readers)("%s", ([, openReader]) => {
  test("opens a new file: the writer creates it at version 1, the one version the reader knows", () => {
    const file = createdFile();

    expect(() => {
      connections.push(openReader(file.path));
    }).not.toThrow();
  });

  test.for([0, 2, 7])("refuses a file at version %i, naming that version and the version 1 it knows", (found) => {
    const file = createdFile();
    stampSchemaVersion(file.path, found);

    expect(() => openReader(file.path)).toThrow(new RegExp(`version ${String(found)}\\b.*version 1\\b`));
  });
});

describe("the writer", () => {
  test("gives a file with no version today's tables and stamps it 1, and the file keeps its rows", () => {
    const file = newFile();
    const first = writerOn(file.path);
    first.recordFullPull(session, pulledAt, nothingPulled);
    first.close();
    // The file of a worker that predates the listing tables and the version: no version, and the tables are missing.
    leaveAsBeforeVersions(file.path);
    expect(() => openIndexReader(file.path), "the server refuses it until the worker has upgraded it").toThrow(
      /version 0\b.*version 1\b/,
    );

    const upgraded = writerOn(file.path);

    // The tables the file lacked are back, empty.
    expect(upgraded.listingCounts(session)).toEqual([]);
    expect(upgraded.committeeMembers(session)).toEqual([]);
    upgraded.close();
    // It is at version 1 now, so the reader opens it, and the row it held is there.
    const reader = openIndexReader(file.path);
    connections.push(reader);
    expect(reader.lastFullPull(session)).toBe("2025-03-01T10:00:00-08:00");
  });

  test("refuses a file at a newer version than it knows, naming both, and leaves it at that version", () => {
    const file = createdFile();
    stampSchemaVersion(file.path, 2);

    expect(() => openIndexWriter(file.path)).toThrow(/version 2\b.*version 1\b/);

    // It was not downgraded or stamped over: the server still sees version 2.
    expect(() => openIndexReader(file.path)).toThrow(/version 2\b.*version 1\b/);
  });
});
