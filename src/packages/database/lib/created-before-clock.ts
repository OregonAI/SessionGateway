// The rule that a reader sees only the rows created at or before the clock (ticket #151, ADR-0055), in one place.
//
// The server's connections never write, so they can be given a view of the index that is the index as it stood at the
// clock: temp views that carry the name of each table that holds a stamped row, over the table itself (`main.<name>`).
// A query that names `document`, `testimony` or `measure` then reads the rows created by now, and no query repeats the
// rule or can forget it. The readers (`reader.ts`, `search.ts`) open their connection through `openReadConnection`, which
// installs the views before anything is prepared; the worker's connection never does, so it still sees every row.
//
// What a row's creation time is (ADR-0055):
// - a Measure's own `created_at`;
// - a document's, from `document_created`: the CreatedDate of the feed row that links it (a Version, a posting, an
//   analysis, a Testimony, an Exhibit, a Recording Log). The feed's text has no offset and is Pacific wall-clock time; the
//   OLIS client wrote it with the Pacific offset in force that day, so a stored time names an instant, and SQLite's
//   `unixepoch` compares instants whatever the offset (a text comparison would not, across a change to or from daylight time);
// - a row with no creation time is shown: nothing says it is from after the clock, and hiding it would hide it for ever.
// Whatever hangs off a document follows the document (its passages, its speaker turns, its listings).
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "#/packages/time/clock.ts";

/** The clock's time as seconds since 1970, to the millisecond: what `unixepoch(text, 'subsec')` is compared with. */
const CLOCK_FUNCTION = "created_clock";

/** Whether a stored creation time (SQL text) is after the clock. A time SQLite cannot read gives NULL, which is not after. */
const after = (column: string): string => `unixepoch(${column}, 'subsec') > ${CLOCK_FUNCTION}()`;

/**
 * Gives a read-only connection the index as it stood at the clock. The clock is read at each statement, so a clock that
 * moves (an evaluation run asks each question at its own moment; production's moves with time) moves what is seen. Call
 * it before any statement is prepared on the connection.
 */
export function showOnlyRowsCreatedBy(database: DatabaseSync, clock: Clock): void {
  // Deterministic: constant within a statement, so the cutoff is one instant for a whole query. It is called again for
  // each execution of a prepared statement.
  database.function(CLOCK_FUNCTION, { deterministic: true }, () => clock.now().getTime() / 1000);
  const hiddenDocuments = `SELECT document_id FROM main.document_created WHERE ${after("created_at")}`;
  database.exec(`
    CREATE TEMP VIEW hidden_document AS ${hiddenDocuments};
    CREATE TEMP VIEW measure AS SELECT * FROM main.measure WHERE COALESCE(${after("created_at")}, 0) = 0;
    CREATE TEMP VIEW document AS
      SELECT * FROM main.document WHERE id NOT IN (SELECT document_id FROM hidden_document);
    -- A relation that points at a document not created yet is no relation: an analysis the feed places on a Version that
    -- does not exist yet is on no Version (domain/analysis.ts: an edge to a document that is not there is worse than none).
    CREATE TEMP VIEW document_relation AS
      SELECT rowid AS rowid, * FROM main.document_relation
      WHERE document_id NOT IN (SELECT document_id FROM hidden_document)
        AND to_id NOT IN (SELECT document_id FROM hidden_document);
    CREATE TEMP VIEW search_document AS
      SELECT * FROM main.search_document WHERE document_id NOT IN (SELECT document_id FROM hidden_document);
    CREATE TEMP VIEW meeting_document AS
      SELECT * FROM main.meeting_document WHERE document_id NOT IN (SELECT document_id FROM hidden_document);
    CREATE TEMP VIEW testimony AS
      SELECT * FROM main.testimony WHERE document_id NOT IN (SELECT document_id FROM hidden_document);
    CREATE TEMP VIEW version_listing AS
      SELECT * FROM main.version_listing WHERE document_id NOT IN (SELECT document_id FROM hidden_document);
    CREATE TEMP VIEW analysis_listing AS
      SELECT * FROM main.analysis_listing WHERE document_id NOT IN (SELECT document_id FROM hidden_document);
    CREATE TEMP VIEW speaker_turn_index AS
      SELECT * FROM main.speaker_turn_index WHERE document_id NOT IN (SELECT document_id FROM hidden_document);
    CREATE TEMP VIEW speaker_turn AS
      SELECT * FROM main.speaker_turn WHERE document_id NOT IN (SELECT document_id FROM hidden_document);
    CREATE TEMP VIEW speaker_turn_item_measure AS
      SELECT * FROM main.speaker_turn_item_measure WHERE document_id NOT IN (SELECT document_id FROM hidden_document);
  `);
}
