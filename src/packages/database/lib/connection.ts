import { DatabaseSync } from "node:sqlite";

// The only file in the project that imports node:sqlite (src/CLAUDE.md, "Shape"): the API is
// Stability 1.2, so keeping it here keeps a swap to better-sqlite3 local.

const schema = `
  CREATE TABLE IF NOT EXISTS measure (
    session_key TEXT NOT NULL,
    prefix TEXT NOT NULL,
    number INTEGER NOT NULL,
    catchline TEXT,
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
