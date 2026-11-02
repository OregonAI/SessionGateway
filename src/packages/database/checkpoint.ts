import { existsSync } from "node:fs";
import { openPlainConnection } from "./lib/connection.ts";

/**
 * Moves everything the file's WAL holds into the database file and empties the WAL, so a copy of the file alone, without
 * its `-wal` and `-shm`, is the whole database. The test harness takes it before it copies a template (test/CLAUDE.md,
 * "Templates"); production code has no use for it, which is why it is an entry point of its own and not a method of the
 * writer (ADR-0009, ticket #95).
 *
 * It opens a connection of its own beside the worker's and the server's, and it only checkpoints: it creates no file,
 * runs no upgrade step and checks no version, so it leaves a file at the version it found. It throws when the file does
 * not exist, and when a reader held the checkpoint back: a page left in the WAL would go missing from the copy.
 */
export function checkpointIndex(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`There is no database at "${path}" to checkpoint: the ingest worker creates the file.`);
  }
  const database = openPlainConnection(path);
  try {
    // The pragma reports a checkpoint that another connection blocked as a row, not as an error.
    const row = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (row?.["busy"] !== 0 || row["log"] !== row["checkpointed"]) {
      throw new Error(`The WAL of the database at "${path}" was not fully checkpointed: ${JSON.stringify(row)}`);
    }
  } finally {
    database.close();
  }
}
