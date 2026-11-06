// The rule that a reader sees only the rows created at or before the clock (ticket #151, ADR-0056), in one place.
//
// The server's connections never write, so they can be given a view of the index that is the index as it stood at the
// clock: temp views that carry the name of each table that holds a stamped row, over the table itself (`main.<name>`).
// A query that names `document`, `testimony` or `measure` then reads the rows created by now, and no query repeats the
// rule or can forget it. The readers (`reader.ts`, `search.ts`) open their connection through `openReadConnection`, which
// installs the views before anything is prepared; the worker's connection never does, so it still sees every row.
//
// What a row's creation time is (ADR-0056):
// - a Measure's own `created_at`, and the same column on a sponsor, a history action, a floor or committee vote, a meeting,
//   an agenda item and a committee member (ticket #153: the CreatedDate of the feed row; a Floor Letter has none in the feed);
// - a document's, from `document_created`: the CreatedDate of the feed row that links it (a Version, a posting, an
//   analysis, a Testimony, an Exhibit, a Recording Log, an agenda: its meeting row's). The feed's text has no offset and is Pacific wall-clock time; the
//   OLIS client wrote it with the Pacific offset in force that day, so a stored time names an instant, and SQLite's
//   `unixepoch` compares instants whatever the offset (a text comparison would not, across a change to or from daylight time);
// - a row with no creation time is shown: nothing says it is from after the clock, and hiding it would hide it for ever.
// Whatever hangs off a document follows the document (its passages, its speaker turns, its listings).
//
// How it stays fast (the first version filtered with `NOT IN (SELECT ... FROM document_created WHERE unixepoch(..) > ..)`,
// which SQLite rebuilt for each statement by reading every row of `document_created`: search went from 25 to 120 ms):
// - `temp.document_epoch` holds each stamped document's creation as epoch seconds, indexed, and is read again only when
//   another connection has committed (`PRAGMA data_version`), so `unixepoch` runs once for each row for each change;
// - `temp.hidden_document` holds the ids created after the clock, taken from that index, and is refreshed only when the
//   clock's value differs from the value it was taken at. Every view probes it by primary key.
// A statement run through the connection refreshes first (`prepare` is wrapped), so no reader has to remember to.
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Clock } from "#/packages/time/clock.ts";

/** The clock's time as seconds since 1970, to the millisecond: what `unixepoch(text, 'subsec')` is compared with. */
const CLOCK_FUNCTION = "created_clock";

/** The members of a statement that read or write rows: each is a point where the view's temp tables are made current. */
const RUNS = ["run", "get", "all", "iterate"] as const;

export type ClockView = {
  /** The ids of the documents created after the clock, as of now: what the views hide. A set is made again only when the clock or the index has moved. */
  hiddenDocuments(): ReadonlySet<string>;
};

/**
 * Gives a read-only connection the index as it stood at the clock. The clock is read before each statement runs, so a
 * clock that moves (an evaluation run asks each question at its own moment; production's moves with time) moves what is
 * seen. Call it before any statement is prepared on the connection.
 */
export function showOnlyRowsCreatedBy(database: DatabaseSync, clock: Clock): ClockView {
  const prepareStatement = database.prepare.bind(database);
  const readDataVersion = prepareStatement("PRAGMA data_version");
  database.exec(`
    CREATE TEMP TABLE document_epoch (document_id TEXT NOT NULL PRIMARY KEY, epoch REAL NOT NULL) WITHOUT ROWID;
    CREATE INDEX temp.document_epoch_at ON document_epoch (epoch);
    CREATE TEMP TABLE hidden_document (document_id TEXT NOT NULL PRIMARY KEY) WITHOUT ROWID;
  `);
  // A row whose time SQLite cannot read has no epoch and is not hidden.
  const rebuildEpochs = prepareStatement(
    `INSERT INTO temp.document_epoch (document_id, epoch)
     SELECT document_id, unixepoch(created_at, 'subsec') FROM main.document_created
     WHERE unixepoch(created_at, 'subsec') IS NOT NULL`,
  );
  const clearEpochs = prepareStatement("DELETE FROM temp.document_epoch");
  const clearHidden = prepareStatement("DELETE FROM temp.hidden_document");
  const fillHidden = prepareStatement(
    "INSERT INTO temp.hidden_document (document_id) SELECT document_id FROM temp.document_epoch WHERE epoch > ?",
  );
  const readHidden = prepareStatement("SELECT document_id FROM temp.hidden_document");

  let seenDataVersion: unknown;
  /** The clock's seconds when the hidden ids were taken: what `created_clock()` answers until the next refresh. */
  let clockSeconds = Number.NaN;
  let hiddenSet: Set<string> | undefined;

  const refresh = (): void => {
    const dataVersion = (readDataVersion.get() as { data_version: unknown }).data_version;
    const seconds = clock.now().getTime() / 1000;
    const indexMoved = dataVersion !== seenDataVersion;
    if (!indexMoved && seconds === clockSeconds) return;
    if (indexMoved) {
      clearEpochs.run();
      rebuildEpochs.run();
      seenDataVersion = dataVersion;
    }
    clearHidden.run();
    fillHidden.run(seconds);
    clockSeconds = seconds;
    hiddenSet = undefined;
  };

  // Deterministic is safe here: the function takes no argument and answers the value the last refresh took, which only
  // changes between statements (a statement's run refreshes before it starts), so it is one instant for a whole statement
  // and for every execution of a prepared one. SQLite may evaluate it once and reuse the result, which is what we want.
  database.function(CLOCK_FUNCTION, { deterministic: true }, () => clockSeconds);
  // Every statement prepared on this connection refreshes the temp tables before it runs.
  database.prepare = (sql: string): StatementSync => {
    const statement = prepareStatement(sql);
    // Own properties over the statement's prototype methods: a Proxy would cost a trap on every property read.
    for (const member of RUNS) {
      const run = statement[member].bind(statement) as (...args: never[]) => unknown;
      Object.defineProperty(statement, member, {
        value: (...args: never[]) => {
          refresh();
          return run(...args);
        },
      });
    }
    return statement;
  };

  // The rule for the Measure's own row: a time after the clock hides it.
  const afterClock = (column: string): string => `unixepoch(${column}, 'subsec') > ${CLOCK_FUNCTION}()`;
  const visible = "document_id NOT IN (SELECT document_id FROM temp.hidden_document)";
  // The sets whose rows are stamped with their own CreatedDate (ticket #153): the Measure's sponsors, history actions and
  // votes, the meetings and their agenda items, and the committees' members. A reader asks for them by Measure, meeting or
  // committee (an index probe) and reads a few hundred rows at most, so the rule is the Measure's: the row's own time against
  // the clock, no temp table to keep. A row with no time (null, or a text SQLite cannot read) is shown.
  const stampedByTheRow = [
    "sponsor",
    "history_action",
    "floor_vote",
    "committee_vote",
    "meeting",
    "agenda_item",
    "committee_member",
  ]
    .map(
      (table) =>
        `CREATE TEMP VIEW ${table} AS SELECT * FROM main.${table} WHERE COALESCE(${afterClock("created_at")}, 0) = 0;`,
    )
    .join("\n    ");
  database.exec(`
    CREATE TEMP VIEW measure AS SELECT * FROM main.measure WHERE COALESCE(${afterClock("created_at")}, 0) = 0;
    ${stampedByTheRow}
    CREATE TEMP VIEW document AS
      SELECT * FROM main.document WHERE id NOT IN (SELECT document_id FROM temp.hidden_document);
    -- A relation that points at a document not created yet is no relation: an analysis the feed places on a Version that
    -- does not exist yet is on no Version (domain/analysis.ts: an edge to a document that is not there is worse than none).
    CREATE TEMP VIEW document_relation AS
      SELECT rowid AS rowid, * FROM main.document_relation
      WHERE ${visible} AND to_id NOT IN (SELECT document_id FROM temp.hidden_document);
    CREATE TEMP VIEW search_document AS SELECT * FROM main.search_document WHERE ${visible};
    CREATE TEMP VIEW meeting_document AS SELECT * FROM main.meeting_document WHERE ${visible};
    CREATE TEMP VIEW testimony AS SELECT * FROM main.testimony WHERE ${visible};
    CREATE TEMP VIEW version_listing AS SELECT * FROM main.version_listing WHERE ${visible};
    -- The Versions that exist but not yet at the clock: what get_measure's Statutes Affected Table entries are held back by.
    CREATE TEMP VIEW hidden_version_listing AS
      SELECT * FROM main.version_listing WHERE document_id IN (SELECT document_id FROM temp.hidden_document);
    CREATE TEMP VIEW analysis_listing AS SELECT * FROM main.analysis_listing WHERE ${visible};
    CREATE TEMP VIEW speaker_turn_index AS SELECT * FROM main.speaker_turn_index WHERE ${visible};
    CREATE TEMP VIEW speaker_turn AS SELECT * FROM main.speaker_turn WHERE ${visible};
    CREATE TEMP VIEW speaker_turn_item_measure AS SELECT * FROM main.speaker_turn_item_measure WHERE ${visible};
    -- A machine transcript follows its Recording Log (ticket #134's tables, ADR-0056): a passage is of a log (document_id) and
    -- of one of its turns, so the log's creation is the passage's. The passage's keyword entry (transcript_passage_fts, a
    -- contentless table no view can stand over) is reached through its passage, which is how every reader finds it.
    CREATE TEMP VIEW transcript_passage AS SELECT * FROM main.transcript_passage WHERE ${visible};
    -- A transcript row has no log id of its own: it is of the Meeting and the event ID that the log's speaker-turn index names
    -- (the log is the one the transcript was attached to), so it is left out while that log is hidden.
    CREATE TEMP VIEW transcript AS
      SELECT * FROM main.transcript t
      WHERE NOT EXISTS (
        SELECT 1 FROM main.meeting_document md
          JOIN main.speaker_turn_index i ON i.document_id = md.document_id
        WHERE md.meeting_id = t.meeting_id AND i.event_id = t.event_id
          AND md.document_id IN (SELECT document_id FROM temp.hidden_document)
      );
  `);

  return {
    hiddenDocuments() {
      refresh();
      if (hiddenSet === undefined) {
        hiddenSet = new Set(readHidden.all().map((row) => (row as { document_id: string }).document_id));
      }
      return hiddenSet;
    },
  };
}
