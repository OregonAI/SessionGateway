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
`;

/** The default timeout of 0 fails at once on a busy database, so both sides wait up to 5 seconds. */
const BUSY_TIMEOUT_MS = 5000;

/** The worker's connection: WAL, so the server reads while the worker writes. */
export function openWriteConnection(path: string): DatabaseSync {
  const database = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec(schema);
  return database;
}

/** The server's connection: it never writes. */
export function openReadConnection(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
}
