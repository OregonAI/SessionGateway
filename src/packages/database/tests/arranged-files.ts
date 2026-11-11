// Database files for the seam-4 tests of the Index's schema version (ADR-0048), and the SQL that arranges the ones an
// earlier or later release would have left. This is the package's own tests/ fixture: `database` is the one package
// that opens SQLite, and a test of it may arrange a file with SQL the way `test/support/old-database.ts` does for the
// harness. It only arranges. Every assertion goes through the entry points (test/CLAUDE.md, "Seam 4").
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tablesGivenCreatedAtByStepFive } from "../stamped-tables.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A SQLite file in a directory of its own. WAL cannot run in memory, so a database needs a file. */
export type IndexFile = {
  path: string;
  remove(): void;
};

export function createIndexFile(name = "index.db"): IndexFile {
  const directory = mkdtempDisposableSync(join(tmpdir(), "session-gateway-schema-"));
  return {
    path: join(directory.path, name),
    remove: () => {
      directory.remove();
    },
  };
}

function withSql(path: string, statements: string): void {
  const database = new DatabaseSync(path, { timeout: 5000 });
  try {
    database.exec(statements);
  } finally {
    database.close();
  }
}

/** Stamps the file as another release left it, whatever its tables hold. Close the writer first. */
export function stampSchemaVersion(path: string, version: number): void {
  withSql(path, `PRAGMA user_version = ${String(version)}`);
}

/**
 * Builds a file from the frozen text of version 1 (`version-one-schema.sql`, which is never edited) and stamps it 1, in
 * WAL mode as the worker leaves a file: the state of a file a release that knew only version 1 deployed. The seam-4
 * guard opens the current code on it. The file is created by this call, so it must not exist yet.
 */
export function buildFrozenVersionOne(path: string): void {
  const frozen = readFileSync(new URL("./version-one-schema.sql", import.meta.url), "utf8");
  withSql(path, `PRAGMA journal_mode = WAL;\n${frozen}\nPRAGMA user_version = 1`);
}

/**
 * Makes a file look as one built before the listing tables and before versions: the tables the listing and the
 * Committee Members added are gone, the rows of the others stay, and it records no version. What step 3 adds to the tables
 * that existed before it (ticket #127) is gone too, so that step 3 is a plain `ALTER TABLE` applied once, as on a deployed
 * file (ADR-0048). Close the writer first.
 */
export function leaveAsBeforeVersions(path: string): void {
  withSql(
    path,
    `DROP VIEW IF EXISTS feed_row_state; DROP TABLE feed_row; DROP TABLE feed_pull; DROP TABLE committee_member;
     DROP TABLE speaker_turn_item_measure; DROP INDEX passage_turn;
     ALTER TABLE passage DROP COLUMN turn_position;
     ALTER TABLE speaker_turn_index DROP COLUMN turns_without_passage;
     ALTER TABLE speaker_turn_index DROP COLUMN item_measures_read;
     ${dropTranscriptTables}
     ${dropCreatedTimeColumns}
     ${dropLinkAnnotationTable}
     ${dropLastFetchFailureTable}
     ${dropParserVersionColumn} ${dropTableParserVersionColumn}
     PRAGMA user_version = 0`,
  );
}

/** What step 9 (ticket #184) adds: the version of the table parser that read the held table, a column of `statutes_affected_read`. */
const dropTableParserVersionColumn = `ALTER TABLE statutes_affected_read DROP COLUMN parser_version;`;

/** What step 8 (ticket #183) adds: the version of the parser that read each file, a column of `statute_read`. */
const dropParserVersionColumn = `ALTER TABLE statute_read DROP COLUMN parser_version;`;

/** What step 7 (ticket #168) adds: the table of the last fetch failure of each document the index holds no file of. */
const dropLastFetchFailureTable = `DROP TABLE IF EXISTS last_fetch_failure;`;

/** What step 6 (ticket #160) adds: the table of a Recording Log's link annotations. */
const dropLinkAnnotationTable = `DROP TABLE IF EXISTS recording_log_link_annotation;`;

/** What step 5 (ticket #153) adds: the feed's CreatedDate of each sponsor, history action, vote, meeting and agenda item. */
const dropCreatedTimeColumns = tablesGivenCreatedAtByStepFive
  .map((table) => `ALTER TABLE ${table} DROP COLUMN created_at;`)
  .join(" ");

/** What step 4 (ticket #134) adds: the tables of a Meeting's transcript and its passages, and the keyword side of them. */
const dropTranscriptTables = `DROP TABLE transcript_passage_fts; DROP TABLE transcript_passage; DROP TABLE transcript;`;

/**
 * Makes a file look as a release left it after step 3 and before step 4 (ticket #134): the transcript tables are gone and it
 * is stamped 3. The next worker to open it runs step 4. Close the writer first.
 */
export function leaveAsVersionThree(path: string): void {
  withSql(
    path,
    `${dropTranscriptTables} ${dropCreatedTimeColumns} ${dropLinkAnnotationTable} ${dropLastFetchFailureTable} ${dropParserVersionColumn} ${dropTableParserVersionColumn} PRAGMA user_version = 3`,
  );
}

/**
 * Makes a file look as a release left it after step 4 and before step 5 (ticket #153): the rows have no creation-time column and
 * it is stamped 4. The next worker to open it runs step 5, which makes the columns, empty. Close the writer first.
 */
export function leaveAsVersionFour(path: string): void {
  withSql(
    path,
    `${dropCreatedTimeColumns} ${dropLinkAnnotationTable} ${dropLastFetchFailureTable} ${dropParserVersionColumn} ${dropTableParserVersionColumn} PRAGMA user_version = 4`,
  );
}

/**
 * Makes a file look as a release left it after step 5 and before step 6 (ticket #160): the table of link annotations is gone and
 * it is stamped 5. The next worker to open it runs step 6, which makes the table, empty. Close the writer first.
 */
export function leaveAsVersionFive(path: string): void {
  withSql(
    path,
    `${dropLinkAnnotationTable} ${dropLastFetchFailureTable} ${dropParserVersionColumn} ${dropTableParserVersionColumn} PRAGMA user_version = 5`,
  );
}

/**
 * Makes a file look as a release left it after step 6 and before step 7 (ticket #168): the table of last fetch failures is gone
 * and it is stamped 6. The next worker to open it runs step 7, which makes the table, empty. Close the writer first.
 */
export function leaveAsVersionSix(path: string): void {
  withSql(
    path,
    `${dropLastFetchFailureTable} ${dropParserVersionColumn} ${dropTableParserVersionColumn} PRAGMA user_version = 6`,
  );
}

/**
 * Makes a file look as a release left it after step 7 and before step 8 (ticket #183): `statute_read` has no parser-version
 * column and the file is stamped 7. The next worker to open it runs step 8, which adds the column, 0 on every row it holds.
 * Close the writer first.
 */
export function leaveAsVersionSeven(path: string): void {
  withSql(path, `${dropParserVersionColumn} ${dropTableParserVersionColumn} PRAGMA user_version = 7`);
}

/**
 * Makes a file look as a release left it after step 8 and before step 9 (ticket #184): `statutes_affected_read` has no
 * parser-version column and the file is stamped 8. The next worker to open it runs step 9, which adds the column, 0 on the
 * row it holds. Close the writer first.
 */
export function leaveAsVersionEight(path: string): void {
  withSql(path, `${dropTableParserVersionColumn} PRAGMA user_version = 8`);
}

/** Arranges a stored speaker-turn index whose `turn_count` is not the number of its turn rows, so a test can tell which one is read. */
export function setStoredTurnCount(path: string, documentId: string, count: number): void {
  const database = new DatabaseSync(path, { timeout: 5000 });
  try {
    database.prepare("UPDATE speaker_turn_index SET turn_count = ? WHERE document_id = ?").run(count, documentId);
  } finally {
    database.close();
  }
}

/** Arranges a stored speaker-turn index that says it is indexed and has no event ID: a file no worker wrote. */
export function forgetStoredEventId(path: string, documentId: string): void {
  const database = new DatabaseSync(path, { timeout: 5000 });
  try {
    database.prepare("UPDATE speaker_turn_index SET event_id = NULL WHERE document_id = ?").run(documentId);
  } finally {
    database.close();
  }
}
