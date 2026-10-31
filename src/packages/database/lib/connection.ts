import { DatabaseSync } from "node:sqlite";

// The only file in the project that imports node:sqlite (src/CLAUDE.md, "Shape"): the API is
// Stability 1.2, so keeping it here keeps a swap to better-sqlite3 local.

const schema = `
  CREATE TABLE IF NOT EXISTS measure (
    session_key TEXT NOT NULL,
    prefix TEXT NOT NULL,
    number INTEGER NOT NULL,
    catchline TEXT,
    location TEXT NOT NULL,
    committee_code TEXT,
    digest TEXT,
    created_at TEXT NOT NULL,
    modified_at TEXT,
    PRIMARY KEY (session_key, prefix, number)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS index_state (
    session_key TEXT NOT NULL PRIMARY KEY,
    full_pull_as_of TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS legislator (
    session_key TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (session_key, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS legislator_code (
    session_key TEXT NOT NULL,
    code TEXT NOT NULL,
    legislator_id TEXT NOT NULL,
    PRIMARY KEY (session_key, code)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS history_action (
    session_key TEXT NOT NULL,
    history_id INTEGER NOT NULL,
    prefix TEXT NOT NULL,
    number INTEGER NOT NULL,
    chamber TEXT NOT NULL CHECK (chamber IN ('house', 'senate')),
    action_date TEXT NOT NULL,
    action_text TEXT NOT NULL,
    PRIMARY KEY (session_key, history_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS history_action_of_measure ON history_action (session_key, prefix, number);
  CREATE TABLE IF NOT EXISTS floor_vote (
    session_key TEXT NOT NULL,
    vote_id INTEGER NOT NULL,
    history_id INTEGER NOT NULL,
    prefix TEXT NOT NULL,
    number INTEGER NOT NULL,
    chamber TEXT NOT NULL CHECK (chamber IN ('house', 'senate')),
    action_date TEXT NOT NULL,
    action_text TEXT NOT NULL,
    legislator_code TEXT NOT NULL,
    legislator_id TEXT,
    vote TEXT NOT NULL,
    PRIMARY KEY (session_key, vote_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS floor_vote_of_measure ON floor_vote (session_key, prefix, number);
  CREATE TABLE IF NOT EXISTS committee_vote (
    session_key TEXT NOT NULL,
    vote_id INTEGER NOT NULL,
    report_id INTEGER NOT NULL,
    prefix TEXT NOT NULL,
    number INTEGER NOT NULL,
    committee_code TEXT NOT NULL,
    meeting_date TEXT NOT NULL,
    legislator_code TEXT NOT NULL,
    legislator_id TEXT,
    vote TEXT NOT NULL,
    PRIMARY KEY (session_key, vote_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS committee_vote_of_measure ON committee_vote (session_key, prefix, number);
  CREATE TABLE IF NOT EXISTS sponsor (
    session_key TEXT NOT NULL,
    sponsor_id INTEGER NOT NULL,
    prefix TEXT NOT NULL,
    number INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('member', 'committee', 'presession')),
    level TEXT NOT NULL,
    print_order INTEGER NOT NULL,
    legislator_code TEXT,
    legislator_id TEXT,
    committee_code TEXT,
    presession_message TEXT,
    PRIMARY KEY (session_key, sponsor_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS snapshot_state (
    session_key TEXT NOT NULL PRIMARY KEY,
    source TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    commit_date TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS committee (
    session_key TEXT NOT NULL,
    code TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (session_key, code)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS meeting (
    id TEXT NOT NULL PRIMARY KEY,
    session_key TEXT NOT NULL,
    committee_code TEXT NOT NULL,
    committee_id TEXT NOT NULL,
    at TEXT NOT NULL,
    status TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS agenda_item (
    id INTEGER NOT NULL PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    session_key TEXT NOT NULL,
    measure_prefix TEXT,
    measure_number INTEGER,
    meeting_type TEXT,
    action TEXT,
    print_order TEXT,
    comments TEXT,
    board_name TEXT,
    executive_appointee TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS agenda_item_meeting ON agenda_item (meeting_id);
  -- What the feed lists for a meeting (its agenda, Exhibits, Recording Logs and the postings of Proposed
  -- Amendments), written for every link before any file is fetched. A row here has a row in "document" only
  -- once its file is in: a fetch can fail, or not have been reached yet (ADR-0011, "Order of a pull").
  CREATE TABLE IF NOT EXISTS meeting_document (
    document_id TEXT NOT NULL PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    session_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    node_id TEXT NOT NULL,
    label TEXT NOT NULL,
    source_url TEXT NOT NULL,
    title TEXT,
    measure_id TEXT,
    meaning TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS meeting_document_meeting ON meeting_document (meeting_id);
  CREATE TABLE IF NOT EXISTS document (
    id TEXT NOT NULL PRIMARY KEY,
    node_id TEXT NOT NULL,
    session_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    source_url TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    has_text_layer INTEGER NOT NULL,
    posted_at TEXT,
    analysis_version_label TEXT,
    analysis_is_minority INTEGER,
    text TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS document_node ON document (node_id);
  CREATE TABLE IF NOT EXISTS document_relation (
    document_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    to_id TEXT NOT NULL,
    meaning TEXT,
    provenance TEXT NOT NULL,
    PRIMARY KEY (document_id, relation, to_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS document_relation_to ON document_relation (to_id, relation);
  -- What the feed says of each Testimony row, written for every row before any file is fetched, so the
  -- server can list who testified whether or not the file is in. A row here has a row in "document" only
  -- once its file is.
  CREATE TABLE IF NOT EXISTS testimony (
    document_id TEXT NOT NULL PRIMARY KEY,
    session_key TEXT NOT NULL,
    comm_test_id INTEGER NOT NULL,
    measure_id TEXT,
    source_url TEXT NOT NULL,
    document_description TEXT NOT NULL,
    position_id INTEGER NOT NULL,
    submitter TEXT NOT NULL,
    behalf_of TEXT,
    organization TEXT,
    committee_id TEXT NOT NULL,
    committee_code TEXT NOT NULL,
    meeting_at TEXT NOT NULL,
    agency_id TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS testimony_measure ON testimony (measure_id);
  CREATE TABLE IF NOT EXISTS analysis_listing (
    document_id TEXT NOT NULL PRIMARY KEY,
    session_key TEXT NOT NULL,
    measure_id TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS analysis_listing_measure ON analysis_listing (measure_id);
`;

/** The default timeout of 0 fails at once on a busy database, so both sides wait up to 5 seconds. */
const BUSY_TIMEOUT_MS = 5000;

/**
 * The worker's connection: WAL, so the server reads while the worker writes. SQLite answers a request
 * for WAL without an error and keeps the journal mode it had when it cannot switch (an in-memory
 * database, or a file on a filesystem without shared-memory support), so the answer is checked.
 */
export function openWriteConnection(path: string): DatabaseSync {
  const database = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  const answer = database.prepare("PRAGMA journal_mode = WAL").get();
  const mode = answer?.["journal_mode"];
  if (mode !== "wal") {
    database.close();
    throw new Error(
      `Could not put the database at "${path}" in WAL mode: SQLite kept the "${String(mode)}" journal mode. WAL needs a file on a filesystem with shared-memory support.`,
    );
  }
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec(schema);
  return database;
}

/** The server's connection: it never writes. */
export function openReadConnection(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
}
