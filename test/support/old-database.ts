// Makes a database look as one built before the listing tables did (ADR-0030, "Consequences"): the rows are there and
// no complete pull has listed any of them. The worker that upgrades such a file creates the empty tables
// (`CREATE TABLE IF NOT EXISTS`) before it pulls, so the state is the tables with nothing in them.
//
// This is the one place a seam-1 test opens the database with SQL (the database package's own seam-4 tests arrange with
// SQL in `src/packages/database/tests/arranged-files.ts`), and it only arranges: every assertion about the file goes
// through the MCP tools (test/CLAUDE.md, "Seam 1"). The harness cannot run the base commit's worker instead: that
// code is not in the tree, and a committed database built by it would be a fixture of its own.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

/**
 * Makes a database look as one a worker left after ticket #126 and before ticket #127: schema version 2, where the speaker-turn
 * index is stored, no Recording Log's passages are linked to its turns and no Agenda item's Measures are read. Each stored Recording Log keeps its text and its
 * index and has one passage that holds the whole text (the cut the worker made is not what the arrangement needs: no passage
 * is a turn's, and the text is all there). It only arranges, like `forgetListing`: the next worker to open the file runs
 * step 3 and links the turns.
 */
export function leaveTurnsUnlinkedFromPassages(databasePath: string): void {
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  // Deleting from the contentless FTS5 table leaves the connection's last rowid beyond what a JavaScript number holds, which
  // `run` refuses to convert for the next statement: every statement here reads its result as BigInt.
  const run = (sql: string, ...values: (string | number | bigint)[]): bigint | number => {
    const statement = database.prepare(sql);
    statement.setReadBigInts(true);
    return statement.run(...values).lastInsertRowid;
  };
  try {
    database.exec("BEGIN IMMEDIATE");
    const logs = database.prepare("SELECT id, text FROM document WHERE kind = 'recording_log'").all() as {
      id: string;
      text: string;
    }[];
    for (const log of logs) {
      run("DELETE FROM passage_fts WHERE rowid IN (SELECT id FROM passage WHERE document_id = ?)", log.id);
      run("DELETE FROM passage WHERE document_id = ?", log.id);
    }
    database.exec("DROP INDEX IF EXISTS passage_turn");
    database.exec("DROP INDEX IF EXISTS speaker_turn_item_measure_measure");
    database.exec("DROP TABLE IF EXISTS speaker_turn_item_measure");
    database.exec("ALTER TABLE passage DROP COLUMN turn_position");
    database.exec("ALTER TABLE speaker_turn_index DROP COLUMN turns_without_passage");
    database.exec("ALTER TABLE speaker_turn_index DROP COLUMN item_measures_read");
    for (const log of logs) {
      const hash = createHash("sha256").update(log.text, "utf8").digest("hex");
      const id = run(
        "INSERT INTO passage (document_id, ordinal, start_offset, end_offset, text_hash) VALUES (?, 0, 0, ?, ?)",
        log.id,
        log.text.length,
        hash,
      );
      run("INSERT INTO passage_fts (rowid, text) VALUES (?, ?)", id, log.text);
    }
    database.exec("PRAGMA user_version = 2");
    database.exec("COMMIT");
  } finally {
    database.close();
  }
}

/**
 * Builds a file as a release that knew only schema version 1 left it: the frozen text of version 1 (the database package's
 * `tests/version-one-schema.sql`, never edited, read here as a file because a seam-1 test imports no package's tests/),
 * stamped 1, in WAL mode. The file must not exist yet. It only arranges, like `forgetListing`.
 */
export function buildVersionOneFile(databasePath: string): void {
  // Why a path into a package's tests/ folder: the boundary rule (test/CLAUDE.md, dependency-cruiser) is about imports, and this
  // imports nothing; it reads the frozen text of version 1 as a file, so that the SQL is not copied into a second place that
  // could drift from the one the package's own seam-4 tests arrange from.
  const frozen = readFileSync(
    new URL("../../src/packages/database/tests/version-one-schema.sql", import.meta.url),
    "utf8",
  );
  const database = new DatabaseSync(databasePath, { timeout: 5000 });
  try {
    database.exec(`PRAGMA journal_mode = WAL;\n${frozen}\nPRAGMA user_version = 1`);
  } finally {
    database.close();
  }
}
