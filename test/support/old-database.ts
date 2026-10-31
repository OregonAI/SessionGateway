// Makes a database look as one built before the listing tables did (ADR-0030, "Consequences"): the rows are there and
// no complete pull has listed any of them. The worker that upgrades such a file creates the empty tables
// (`CREATE TABLE IF NOT EXISTS`) before it pulls, so the state is the tables with nothing in them.
//
// This is the one place a test opens the database with SQL, and it only arranges: every assertion about the file goes
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
