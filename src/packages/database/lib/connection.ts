import { DatabaseSync } from "node:sqlite";
import { statuteLinkKinds, tableActions } from "#/packages/domain/statute-links.ts";
import { storedEvidenceKinds } from "./agency-evidence.ts";

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
  -- When the last increment started (ticket #17, ADR-0039). An increment is not a complete full pull: it never
  -- touches index_state's full_pull_as_of or the listing tables.
  CREATE TABLE IF NOT EXISTS increment_state (
    session_key TEXT NOT NULL PRIMARY KEY,
    as_of TEXT NOT NULL
  ) STRICT;
  -- When the last full pull was begun, complete or not (ticket #17, ADR-0039): a pull OLIS gave short stores nothing,
  -- but it was a full pull the Acceptable Use Agreement counts for the day, so a restarted worker does not make another.
  CREATE TABLE IF NOT EXISTS full_pull_attempt (
    session_key TEXT NOT NULL PRIMARY KEY,
    as_of TEXT NOT NULL
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
  -- The parent of each Agency that has one, from the snapshot the last pull built with (ADR-0029): the body the registry
  -- places a sub-unit under. Replaced as a whole with the snapshot's version. The server shows it; it never reads the snapshot.
  CREATE TABLE IF NOT EXISTS agency_parent (
    agency_id TEXT NOT NULL PRIMARY KEY,
    parent_id TEXT NOT NULL
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
  -- What reading one file for Statute Links came to, by the file's content hash and what it was read as, so that
  -- two postings of one amendment that share a file share one reading (ADR-0015). Written by the ingest worker
  -- from the stored text, after the files are stored.
  CREATE TABLE IF NOT EXISTS statute_parse (
    content_hash TEXT NOT NULL,
    parsed_as TEXT NOT NULL CHECK (parsed_as IN ('version', 'proposed_amendment')),
    text_read INTEGER NOT NULL,
    amended_version_header TEXT,
    header_measure_prefix TEXT,
    header_measure_number INTEGER,
    relating_clause_edits TEXT NOT NULL,
    PRIMARY KEY (content_hash, parsed_as)
  ) STRICT;
  -- With which commit of the OregonAI snapshot a file was read for Statute Links (ADR-0035): a range is expanded against
  -- the snapshot's ORS section list, so the worker reads every file again from the stored text when the commit changes.
  -- A database that has no row here (made before this table) reads every file once more.
  CREATE TABLE IF NOT EXISTS statute_read (
    content_hash TEXT NOT NULL,
    parsed_as TEXT NOT NULL CHECK (parsed_as IN ('version', 'proposed_amendment')),
    snapshot_commit TEXT NOT NULL,
    PRIMARY KEY (content_hash, parsed_as)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS statute_link (
    content_hash TEXT NOT NULL,
    parsed_as TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (${statuteLinkKinds.map((kind) => `'${kind}'`).join(", ")})),
    target_type TEXT NOT NULL CHECK (target_type IN ('section', 'chapter')),
    target_id TEXT NOT NULL,
    measure_section TEXT,
    PRIMARY KEY (content_hash, parsed_as, ordinal)
  ) STRICT;
  -- Legislative Counsel's Statutes Affected Table (ticket #22, ADR-0033, ADR-0034): the copy the worker last read, kept like
  -- a document (where it came from, when, its content hash and its text), and its ORS entries. The worker fetches the
  -- table in each full pull and replaces both tables only when the bytes it fetched differ from these.
  CREATE TABLE IF NOT EXISTS statutes_affected_table (
    session_key TEXT NOT NULL PRIMARY KEY,
    source_url TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    text TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS statutes_affected_entry (
    session_key TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    prefix TEXT NOT NULL,
    number INTEGER NOT NULL,
    level TEXT,
    action TEXT NOT NULL CHECK (action IN (${tableActions.map((action) => `'${action}'`).join(", ")})),
    target_type TEXT NOT NULL CHECK (target_type IN ('section', 'chapter')),
    target_id TEXT NOT NULL,
    measure_section TEXT NOT NULL,
    emergency INTEGER NOT NULL,
    lone_e INTEGER NOT NULL,
    PRIMARY KEY (session_key, ordinal)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS statutes_affected_entry_measure ON statutes_affected_entry (session_key, prefix, number);
  -- The bytes the worker last refused as no table (not a PDF, no text layer, or no ORS row in it), by their hash, so that a
  -- server that keeps giving the same file is not asked to be extracted again at every pull (ADR-0034).
  CREATE TABLE IF NOT EXISTS statutes_affected_refusal (
    session_key TEXT NOT NULL PRIMARY KEY,
    content_hash TEXT NOT NULL,
    reason TEXT NOT NULL
  ) STRICT;
  -- When OLIS created the feed's row for each document it links (the row's CreatedDate): the document's created time
  -- (ADR-0028). Written for every link before any file is fetched, as the listing of analysis documents is, and
  -- refreshed at every pull, so a document whose file did not come still has its time.
  CREATE TABLE IF NOT EXISTS document_created (
    document_id TEXT NOT NULL PRIMARY KEY,
    created_at TEXT NOT NULL
  ) STRICT;
  -- Agency Links (ADR-0027), read by the ingest worker from the text it stored, after the Statute Links are. A
  -- document is read once for each snapshot: agency_read says with which commit of the OregonAI snapshot it was, whether
  -- or not it gave a link, so a pull does not read a Version again for having none, and reads every document again when
  -- the snapshot changes. The link names the document its evidence was read from; the node it sits on
  -- (a Version, a Proposed Amendment, the Measure) is found from that document when the server answers, as ADR-0013
  -- places an analysis document. Testimony's links are the testimony table's own agency_id.
  CREATE TABLE IF NOT EXISTS agency_read (
    document_id TEXT NOT NULL PRIMARY KEY,
    snapshot_commit TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS agency_link (
    document_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    agency_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (${storedEvidenceKinds.map((kind) => `'${kind}'`).join(", ")})),
    evidence TEXT NOT NULL,
    PRIMARY KEY (document_id, ordinal)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS agency_link_agency ON agency_link (agency_id);
  -- The units a Fiscal Impact Statement lists that are not Agencies, as the statement writes them.
  CREATE TABLE IF NOT EXISTS unresolved_unit (
    document_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    unit TEXT NOT NULL,
    PRIMARY KEY (document_id, ordinal)
  ) STRICT;
  -- find_measures asks which files have a Statute Link to an ORS section or chapter, and which Testimony an Agency's
  -- Organization matched: it goes from the link to the documents that have the file, and from the Agency to its rows.
  CREATE INDEX IF NOT EXISTS statute_link_target ON statute_link (target_id);
  CREATE INDEX IF NOT EXISTS document_content ON document (content_hash, kind);
  CREATE INDEX IF NOT EXISTS testimony_agency ON testimony (agency_id);
  -- Every Proposed Amendment a tool meets is looked up by the node id of its postings (its number, and the meeting of its
  -- earliest posting); without this a lookup scans every row of meeting_document, 16,115 in the full 2025R1 cache of which
  -- 3,134 are postings of Proposed Amendments (docs/research/olis-odata.md).
  CREATE INDEX IF NOT EXISTS meeting_document_node ON meeting_document (node_id);
  -- The analysis documents the feed has listed for each Measure (ADR-0013). Rows are kept, never replaced: the
  -- count of the ones the store does not hold reads the listing state (feed_row_state) of each (ADR-0030).
  CREATE TABLE IF NOT EXISTS analysis_listing (
    document_id TEXT NOT NULL PRIMARY KEY,
    session_key TEXT NOT NULL,
    measure_id TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS analysis_listing_measure ON analysis_listing (measure_id);
  -- The CommitteeMembers rows (ADR-0030). The set's declared key is not unique, so a row is told apart by all of
  -- its properties: row_key is the whole row. No tool reads the table yet.
  CREATE TABLE IF NOT EXISTS committee_member (
    session_key TEXT NOT NULL,
    row_key TEXT NOT NULL,
    committee_code TEXT NOT NULL,
    legislator_code TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    modified_at TEXT,
    PRIMARY KEY (session_key, row_key)
  ) STRICT;
  -- The two-pull rule (ADR-0005, ADR-0030). feed_pull has a row for each complete full pull of a Session,
  -- numbered from 1; a pull that was refused for being short of its counts has none. feed_row has a row for
  -- every row the index keeps from the feed, by its entity set and its key, with the number of the latest
  -- complete pull that listed it. A row is listed while fewer than two complete pulls have missed it (see the
  -- view), so a pull that lists a row is the only thing that writes to it and an absent row needs no write.
  -- document_id is the document the row links, for the sets that link one. Only a complete full pull writes
  -- last_listed_pull. A row with no row here (an old file's, or one an increment first saw) reads as listed, not
  -- yet checked by a complete pull, and an increment never changes a row that exists here (ADR-0030).
  CREATE TABLE IF NOT EXISTS feed_pull (
    session_key TEXT NOT NULL,
    number INTEGER NOT NULL,
    as_of TEXT NOT NULL,
    PRIMARY KEY (session_key, number)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS feed_row (
    session_key TEXT NOT NULL,
    entity_set TEXT NOT NULL,
    row_key TEXT NOT NULL,
    document_id TEXT,
    last_listed_pull INTEGER NOT NULL,
    PRIMARY KEY (session_key, entity_set, row_key)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS feed_row_document ON feed_row (document_id) WHERE document_id IS NOT NULL;
  CREATE VIEW IF NOT EXISTS feed_row_state AS
    SELECT r.session_key, r.entity_set, r.row_key, r.document_id, r.last_listed_pull, p.as_of AS last_listed_at,
           r.last_listed_pull > latest.number - 2 AS listed
    FROM feed_row r
      JOIN feed_pull p ON p.session_key = r.session_key AND p.number = r.last_listed_pull
      JOIN (SELECT session_key, MAX(number) AS number FROM feed_pull GROUP BY session_key) latest
        ON latest.session_key = r.session_key;
  -- The Versions the feed lists for each Measure (a Printed Amendment is not one), as the last full pull read them and whether
  -- or not their files were fetched: a Version whose file did not come has no row in "document". The Statutes Affected Table's
  -- entries that end in an E alone are read by what is listed here (ADR-0033): an E-Engrossed Version that exists, held or
  -- not, is a reason the E may be its level.
  CREATE TABLE IF NOT EXISTS version_listing (
    document_id TEXT NOT NULL PRIMARY KEY,
    session_key TEXT NOT NULL,
    measure_id TEXT NOT NULL,
    label TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS version_listing_measure ON version_listing (measure_id);
  -- Search (ADR-0025). What search files each stored document under, written in the same transaction as
  -- the document. node_id is the id a hit carries: the document's, or a posting's Proposed Amendment.
  CREATE TABLE IF NOT EXISTS search_document (
    document_id TEXT NOT NULL PRIMARY KEY,
    session_key TEXT NOT NULL,
    node_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    measure_id TEXT,
    committee_id TEXT,
    dated_at TEXT,
    keyword_only INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS search_document_measure ON search_document (measure_id, kind, dated_at);
  CREATE INDEX IF NOT EXISTS search_document_node ON search_document (node_id);
  -- A document's text cut into passages: where each is in document.text, in UTF-16 code units, and the
  -- sha256 of its text, which its vector is kept under. The passage's text is in passage_fts and in document.
  CREATE TABLE IF NOT EXISTS passage (
    id INTEGER PRIMARY KEY,
    document_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text_hash TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS passage_document ON passage (document_id, ordinal);
  CREATE INDEX IF NOT EXISTS passage_hash ON passage (text_hash);
  -- The citations a document's text makes: each distinct Measure, Proposed Amendment or ORS section it names, by
  -- id, with where the first mention starts in document.text (UTF-16 code units). Read once at ingest over the
  -- whole text, so a citation that a passage boundary splits still belongs to the document.
  CREATE TABLE IF NOT EXISTS document_citation (
    citation_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    first_offset INTEGER NOT NULL,
    PRIMARY KEY (citation_id, document_id)
  ) STRICT, WITHOUT ROWID;
  -- The vector side: the int8 vector of a passage's text (384 bytes), under the sha256 of the text and the id of
  -- the model that made it, so that identical text is embedded once and a change of model reuses nothing.
  CREATE TABLE IF NOT EXISTS passage_vector (
    text_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    vector BLOB NOT NULL,
    PRIMARY KEY (text_hash, model_id)
  ) STRICT, WITHOUT ROWID;
  -- A number the worker raises in the same transaction as every change to what the server loads into memory for
  -- the meaning side (a stored document's vectors, a stored document's filing). The server reads it before each
  -- search and loads the vectors again when it has moved, so a document stored in the middle of a pull, after
  -- the pull's as-of time was recorded, is not hidden from the meaning side until the next pull.
  CREATE TABLE IF NOT EXISTS search_generation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation INTEGER NOT NULL
  ) STRICT;
  INSERT OR IGNORE INTO search_generation (id, generation) VALUES (1, 0);
  -- The keyword side: one row for each passage, with the passage's id as its rowid. Contentless, so the text
  -- is not kept a second time; a hit's snippet is cut from document.text.
  CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts USING fts5(
    text, content = '', contentless_delete = 1, tokenize = 'porter unicode61 remove_diacritics 2'
  );
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
