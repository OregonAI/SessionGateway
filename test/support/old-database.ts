// Makes a database look as one built before the listing tables did (ADR-0030, "Consequences"): the rows are there and
// no complete pull has listed any of them. The worker that upgrades such a file creates the empty tables
// (`CREATE TABLE IF NOT EXISTS`) before it pulls, so the state is the tables with nothing in them.
//
// This is the one place a seam-1 test opens the database with SQL (the database package's own seam-4 tests arrange with
// SQL in `src/packages/database/tests/arranged-files.ts`), and it only arranges: every assertion about the file goes
// through the MCP tools (test/CLAUDE.md, "Seam 1"). The harness cannot run the base commit's worker instead: that
// code is not in the tree, and a committed database built by it would be a fixture of its own.
import { DatabaseSync } from "node:sqlite";

/** Removes everything the two-pull rule keeps, so that every row the file holds has never been listed by a pull. */
export function forgetListing(databasePath: string): void {
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  try {
    database.exec("DELETE FROM feed_row; DELETE FROM feed_pull");
  } finally {
    database.close();
  }
}

/**
 * Makes a database look as one that the code before ticket #51 pulled once with another commit of the snapshot: the
 * Agency Links are stamped as read with `commit`, while the Statute Links keep the expansion of the older section list
 * and no file has a Statute Link stamp (that table did not exist). It only arranges, like `forgetListing`.
 */
export function readAgencyLinksWithOnlyTheStamp(databasePath: string, commit: string): void {
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  try {
    database.exec(`DELETE FROM statute_read; UPDATE agency_read SET snapshot_commit = '${commit}'`);
  } finally {
    database.close();
  }
}

/**
 * Makes a database look as one a worker before ticket #126 left: the Recording Logs are stored as text and nothing reads
 * their links, so no log has a speaker-turn index. It only arranges, like `forgetListing`.
 */
export function forgetSpeakerTurns(databasePath: string): void {
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  try {
    database.exec("DELETE FROM speaker_turn; DELETE FROM speaker_turn_index");
  } finally {
    database.close();
  }
}
