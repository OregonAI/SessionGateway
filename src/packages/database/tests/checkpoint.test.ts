// Seam 4: the checkpoint the harness takes before it copies a template database (ticket #95, test/CLAUDE.md,
// "Templates"). The writer is open and has stored a pull, as the first system's worker is when the harness copies it;
// the copy leaves out the `-wal` and `-shm` files, so it is the whole database only if the checkpoint moved everything
// into the file. The copy is read back through the reader. The checkpoint is an entry point for the harness alone: it
// refuses a file that does not exist, and it runs no upgrade step, so it leaves a file at the version it found.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { checkpointIndex } from "../checkpoint.ts";
import { openIndexReader } from "../reader.ts";
import { openIndexWriter } from "../writer.ts";
import { createIndexFile, leaveAsBeforeVersions, type IndexFile } from "./arranged-files.ts";
import { nothingPulled, pulledAt, pulledAtText, session } from "./nothing-pulled.ts";

const files: IndexFile[] = [];
const connections: { close(): void }[] = [];

afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  for (const file of files.splice(0)) file.remove();
});

test("checkpointIndex puts everything the open writer stored into the database file, so a copy of the file alone holds it", () => {
  const file = createIndexFile();
  files.push(file);
  const writer = openIndexWriter(file.path);
  connections.push(writer);
  writer.recordFullPull(session, pulledAt, nothingPulled);

  checkpointIndex(file.path);

  const copy = join(dirname(file.path), "copy.db");
  copyFileSync(file.path, copy);
  const reader = openIndexReader(copy);
  connections.push(reader);
  expect(reader.lastFullPull(session)).toBe(pulledAtText);
});

test("checkpointIndex refuses a file that does not exist, naming the path, and does not create one", () => {
  const file = createIndexFile();
  files.push(file);

  expect(() => {
    checkpointIndex(file.path);
  }).toThrow(`"${file.path}"`);

  expect(existsSync(file.path)).toBe(false);
});

test("checkpointIndex runs no upgrade step: a file with no recorded version is still refused by the reader afterwards", () => {
  const file = createIndexFile();
  files.push(file);
  const writer = openIndexWriter(file.path);
  writer.recordFullPull(session, pulledAt, nothingPulled);
  writer.close();
  leaveAsBeforeVersions(file.path);

  checkpointIndex(file.path);

  expect(() => openIndexReader(file.path)).toThrow(/no recorded schema version/);
});
