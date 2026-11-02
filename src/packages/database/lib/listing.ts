// The Listing (ticket #97; ADR-0005, ADR-0030, ADR-0037; glossary "Listing" and "No longer listed"): whether the feed
// still lists a row the index keeps, and when a complete Full pull last listed it. This file is the one place that knows
// how the answer is made, so the writer, the reader and search each ask it and none repeats the rule.
//
// The state is the two tables `feed_pull` and `feed_row` (connection.ts). The two-pull arithmetic is one TS function,
// `lastPullThatIsNoLongerListed`, and everything derives from it: `isListed` for a row the reader holds, and the number
// the queries of the writer and of search bind as a parameter (`last_listed_pull <= ?`), where they need the rule applied
// inside SQL to a million rows. No SQL of this file spells the arithmetic, so there is nothing to keep in step with it.
// Search's queries need two things of the Listing and ask this file for both: the WHERE term that leaves out a Document
// the feed no longer lists (`listedDocumentSql`, with the number it binds, `noLongerListedThrough`), and which of some
// Documents the feed no longer lists, with when each was last listed (`unlistedAmong`). Search names no column of
// `feed_row` or `feed_pull`.
// The view `feed_row_state` in connection.ts says the same in SQL and is no longer read by anything: the schema text is
// version 1 of the index (ADR-0048) and is left as it was.
//
// Which entity set and key a row is kept under is named here too (`listedRowsOf`), so that a ticket that makes the pull read
// another set adds its rows to that function and to nothing else.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type {
  AmendmentId,
  DocumentId,
  DocumentKind,
  DocumentLink,
  Listing,
  ListedSet,
  CommitteeMember,
  Committee,
  Meeting,
  AgendaItem,
  Convening,
  SessionDates,
} from "#/packages/domain/documents.ts";
import { measureIdOf, type HistoryAction, type Measure, type SessionKey } from "#/packages/domain/index.ts";
import type { LegislatorRow } from "#/packages/domain/legislators.ts";
import type { AgencyId } from "#/packages/domain/oregonai.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * How many complete Full pulls in a row must miss a row before it is No longer listed (ADR-0005). One miss is not a
 * withdrawal.
 */
const MISSES_THAT_UNLIST = 2;

/**
 * The two-pull rule, written once. A row last listed by complete pull `L`, when `latestPull` is the latest complete pull
 * of its Session, has been missed by `latestPull - L` pulls in a row; it is No longer listed when that reaches
 * `MISSES_THAT_UNLIST`. So the rows that are No longer listed are the ones last listed by this pull or an earlier one. A
 * pull that was refused has no number and is not a pull for the count (ADR-0030).
 */
function lastPullThatIsNoLongerListed(latestPull: number): number {
  return latestPull - MISSES_THAT_UNLIST;
}

/** Whether a row last listed by complete pull `lastListedPull` is still listed, when `latestPull` is the Session's latest. */
function isListed(latestPull: number, lastListedPull: number): boolean {
  return lastListedPull > lastPullThatIsNoLongerListed(latestPull);
}

const numberRow = z.object({ number: z.number() });

/** The number of the Session's latest complete Full pull, or 0 while it has none. */
function latestCompletePull(database: DatabaseSync, session: SessionKey): number {
  return numberRow.parse(
    database.prepare("SELECT COALESCE(MAX(number), 0) AS number FROM feed_pull WHERE session_key = ?").get(session),
  ).number;
}

/**
 * A Listing and where it came from, so that the Listings of several rows are told apart by which pull is later and never
 * by comparing clocks, and so that "no row" is a case of its own and not a null to be remembered.
 */
export type ListingRead =
  /** A complete Full pull has listed a row behind it, and `pull` is the number of the pull that gave `listing`'s time. */
  | { kind: "checked"; listing: Listing; pull: number }
  /**
   * No row of `feed_row` is behind it, so no complete Full pull has listed it: a row of an old file, one an Increment first
   * stored, an id the feed has never named, or a thing that rests on no row. It is listed, with no last listing, not yet
   * checked (ADR-0030).
   */
  | { kind: "no_row"; listing: { listed: true; lastListedAt: null } };

/** The one place that says a thing with no row in `feed_row` is listed and has no last listing (ADR-0030). */
const noRow: ListingRead = { kind: "no_row", listing: { listed: true, lastListedAt: null } };

/** Whether `read` was given by a later pull than `other`; a read that no pull gave is earlier than any that one did. */
function givenByLaterPull(read: ListingRead, other: ListingRead): boolean {
  return (read.kind === "checked" ? read.pull : -1) > (other.kind === "checked" ? other.pull : -1);
}

/**
 * The Listing of a thing that rests on several rows: it is listed while any of them is, with the latest listing of the
 * listed ones (a listed row that no pull has checked has none), and when none is listed, the latest of them all. A
 * Proposed Amendment rests on its Postings (ADR-0030) and an Agency Link on its evidence Documents (ADR-0037). A thing
 * that rests on no row has no row.
 */
function anyListed(reads: readonly ListingRead[]): ListingRead {
  const listed = reads.filter((read) => read.listing.listed);
  const pool = listed.length > 0 ? listed : reads;
  let latest: ListingRead | undefined;
  for (const read of pool) {
    if (latest === undefined || givenByLaterPull(read, latest)) latest = read;
  }
  return latest ?? noRow;
}

/** What one Agency's links to one node are known by: the Agency and the node the evidence sits on. */
function agencyLinkKey(agency: AgencyId, nodeId: string): string {
  return `${agency} ${nodeId}`;
}

/**
 * The Listing of each Agency Link in a set of evidence, by Agency and node: the Agency's link to a node is listed while
 * any Document its evidence was read from is (ADR-0037). The evidence must be all of an Agency's evidence for the nodes it
 * names, because a link whose other evidence is left out would be judged on part of it.
 */
export function agencyLinkListings(
  evidence: readonly { agency: AgencyId; nodeId: string; read: ListingRead }[],
): (agency: AgencyId, nodeId: string) => Listing {
  const byLink = new Map<string, ListingRead[]>();
  for (const { agency, nodeId, read } of evidence) {
    const key = agencyLinkKey(agency, nodeId);
    byLink.set(key, [...(byLink.get(key) ?? []), read]);
  }
  const listings = new Map([...byLink].map(([key, reads]) => [key, anyListed(reads).listing]));
  return (agency, nodeId) => {
    const listing = listings.get(agencyLinkKey(agency, nodeId));
    if (listing === undefined) throw new Error(`The evidence has no Agency Link of ${agency} to ${nodeId}`);
    return listing;
  };
}

const stateRow = z.object({ pull: z.number(), as_of: z.string(), latest: z.number() });
const documentIdRow = z.object({ document_id: z.string() });

/** What the reader asks of the Listing: the Listing of a row, of the rows that link a Document, and of an amendment's Postings. */
export type ListingReader = {
  /** The Listing of the row or rows of the feed that link a Document, whether or not the index holds its file. */
  ofDocument(id: DocumentId): ListingRead;
  /** The Listing of a row of the feed, by its entity set and key (a Measure, a meeting, an agenda item). */
  ofRow(session: SessionKey, entitySet: ListedSet, key: string): ListingRead;
  /** A Proposed Amendment's: listed while the feed lists any Posting, whether or not a Posting's file is stored. */
  ofAmendment(id: AmendmentId): ListingRead;
};

/**
 * Opens the reading side of the Listing on a connection. A row's Listing is read as the pull that last listed it, its
 * time, and the Session's latest pull, and the rule (`isListed`) is applied to those, so the reader's queries do not
 * join the state and do not repeat the rule.
 */
export function openListingReader(database: DatabaseSync): ListingReader {
  const columns = `r.last_listed_pull AS pull, p.as_of,
         (SELECT MAX(number) FROM feed_pull WHERE session_key = r.session_key) AS latest
       FROM feed_row r JOIN feed_pull p ON p.session_key = r.session_key AND p.number = r.last_listed_pull`;
  const selectOfDocument = database.prepare(`SELECT ${columns} WHERE r.document_id = ?`);
  const selectOfRow = database.prepare(
    `SELECT ${columns} WHERE r.session_key = ? AND r.entity_set = ? AND r.row_key = ?`,
  );
  // The Postings the feed lists for an amendment (meeting_document, written for every link before any file is
  // fetched) and the ones the store holds, whether or not a Posting's file is stored.
  const selectPostings = database.prepare(
    `SELECT document_id FROM meeting_document WHERE node_id = ?1 AND kind = 'proposed_amendment'
     UNION
     SELECT id FROM document WHERE node_id = ?1 AND node_id <> id`,
  );
  const readOf = (rows: readonly unknown[]): ListingRead =>
    anyListed(
      rows.map((row): ListingRead => {
        const stored = stateRow.parse(row);
        const lastListedAt = stored.as_of as Timestamp;
        return isListed(stored.latest, stored.pull)
          ? { kind: "checked", listing: { listed: true, lastListedAt }, pull: stored.pull }
          : { kind: "checked", listing: { listed: false, lastListedAt }, pull: stored.pull };
      }),
    );
  const ofDocument = (id: DocumentId): ListingRead => readOf(selectOfDocument.all(id));
  return {
    ofDocument,
    ofRow(session, entitySet, key) {
      return readOf(selectOfRow.all(session, entitySet, key));
    },
    ofAmendment(id) {
      return anyListed(
        selectPostings.all(id).map((row) => ofDocument(documentIdRow.parse(row).document_id as DocumentId)),
      );
    },
  };
}

/** One row of the feed the index keeps: the entity set it came from, its key there, and the document it links, if any. */
export type ListedRow = { entitySet: ListedSet; key: string; documentId: DocumentId | null };

/**
 * The entity set of the feed row that links a document of this kind. An agenda is linked by a column of a
 * CommitteeMeetings row, not by a row of its own, so it is named for the column: the meeting stays listed when
 * OLIS stops linking its agenda, and the agenda does not.
 */
export function entitySetOfDocument(kind: DocumentKind): ListedSet {
  switch (kind) {
    case "version":
    case "printed_amendment":
      return "MeasureDocuments";
    case "analysis":
      return "MeasureAnalysisDocuments";
    case "proposed_amendment":
      return "CommitteeProposedAmendments";
    case "exhibit":
    case "recording_log":
      return "CommitteeMeetingDocuments";
    case "testimony":
      return "CommitteePublicTestimonies";
    case "agenda":
      return "CommitteeMeetings.AgendaUrl";
    case "floor_letter":
      return "FloorLetters";
    default:
      return kind satisfies never;
  }
}

/** What a full pull read, as far as listing it needs: one field for each kind of row the index keeps. */
export type ListedSources = {
  measures: readonly Measure[];
  legislatorRows: readonly LegislatorRow[];
  sponsors: readonly { id: number }[];
  history: readonly HistoryAction[];
  floorVotes: readonly { id: number }[];
  committeeVotes: readonly { id: number }[];
  committees: readonly Committee[];
  meetings: readonly Meeting[];
  agendaItems: readonly AgendaItem[];
  documentLinks: readonly DocumentLink[];
  committeeMembers: readonly CommitteeMember[];
  convenings: readonly Convening[];
  sessionDates: SessionDates | undefined;
};

/** Every row the pull listed, once for each key. */
export function listedRowsOf(pulled: ListedSources): ListedRow[] {
  const rows: ListedRow[] = [];
  const add = (entitySet: ListedSet, key: string, documentId: DocumentId | null = null): void => {
    rows.push({ entitySet, key, documentId });
  };
  for (const measure of pulled.measures) add("Measures", measureIdOf(measure));
  for (const row of pulled.legislatorRows) add("Legislators", row.code);
  for (const sponsor of pulled.sponsors) add("MeasureSponsors", String(sponsor.id));
  for (const action of pulled.history) add("MeasureHistoryActions", String(action.id));
  for (const entry of pulled.floorVotes) add("MeasureVotes", String(entry.id));
  for (const entry of pulled.committeeVotes) add("CommitteeVotes", String(entry.id));
  for (const committee of pulled.committees) add("Committees", committee.id);
  for (const meeting of pulled.meetings) add("CommitteeMeetings", meeting.id);
  for (const item of pulled.agendaItems) add("CommitteeAgendaItems", String(item.itemId));
  for (const link of pulled.documentLinks) add(entitySetOfDocument(link.kind), link.id, link.id);
  for (const member of pulled.committeeMembers) add("CommitteeMembers", member.key);
  for (const convening of pulled.convenings) add("ConveneTimes", conveningKeyOf(convening));
  if (pulled.sessionDates !== undefined) add("LegislativeSessions", pulled.sessionDates.session);
  return rows;
}

/** A ConveneTimes row's key in the feed: its Session, date and Chamber (the metadata's key, olis-odata.md section 2). */
export function conveningKeyOf(convening: Convening): string {
  return `${convening.at} ${convening.chamber}`;
}

/**
 * The last pull whose rows are No longer listed in a Session, as of now: the one number the queries of search bind as the
 * parameter of `listedDocumentSql`.
 */
export function noLongerListedThrough(database: DatabaseSync, session: SessionKey): number {
  return lastPullThatIsNoLongerListed(latestCompletePull(database, session));
}

/**
 * The WHERE term that leaves out a Document the feed no longer lists (ADR-0005, ADR-0030), over a table aliased `alias`
 * that has the Document's `document_id` and `session_key`. Search puts it in every query and in the load of the vectors,
 * so that a Document two complete pulls in a row have not listed is in no result and in no scan, and `get_document` still
 * serves it. It stays SQL because a keyword query is cut by `LIMIT` and the vectors are loaded over every passage of the
 * Session: leaving the Documents out afterwards would cut the wrong rows. `parameter` is the SQL text of one placeholder
 * (`?`, `?3`) that takes `noLongerListedThrough`, so the rule's arithmetic is never spelled in the text. A Document with
 * no row in `feed_row` is one no complete pull has listed: it reads as listed, not yet checked, and is kept (ADR-0030).
 * `alias` and `parameter` are SQL text the caller writes, never data.
 */
export function listedDocumentSql(alias: string, parameter: string): string {
  return `NOT EXISTS (SELECT 1 FROM feed_row fr WHERE fr.document_id = ${alias}.document_id AND fr.session_key = ${alias}.session_key AND fr.last_listed_pull <= ${parameter})`;
}

/** A Document the feed no longer lists, and when a complete pull last listed it. */
export type UnlistedDocument = { documentId: DocumentId; lastListedAt: Timestamp };

const unlistedRow = z.object({ document_id: z.string(), as_of: z.string() });

/**
 * Which of these Documents of a Session the feed no longer lists, the one a complete pull listed last first (then the
 * greater id), each once, with the As of of the pull that last listed it. A Document with no row in `feed_row` is not one
 * of them: no complete pull has listed it, so it has nothing to be No longer listed from (ADR-0030). For the notes of an
 * item the index holds and the feed no longer lists, where search finds the candidates and the Listing says which count.
 */
export function unlistedAmong(
  database: DatabaseSync,
  session: SessionKey,
  documentIds: readonly DocumentId[],
): UnlistedDocument[] {
  const rows = database
    .prepare(
      // CROSS JOIN fixes the order: from the Documents asked about, to their rows by `feed_row_document`, to the pull. Left to
      // itself SQLite may scan the Session's rows of `feed_row` first.
      `SELECT fr.document_id, p.as_of
       FROM json_each(?3) j
         CROSS JOIN feed_row fr ON fr.document_id = j.value
         CROSS JOIN feed_pull p ON p.session_key = fr.session_key AND p.number = fr.last_listed_pull
       WHERE fr.session_key = ?1 AND fr.last_listed_pull <= ?2
       ORDER BY fr.last_listed_pull DESC, fr.document_id DESC`,
    )
    .all(session, noLongerListedThrough(database, session), JSON.stringify(documentIds));
  const seen = new Set<string>();
  const unlisted: UnlistedDocument[] = [];
  for (const row of rows) {
    const stored = unlistedRow.parse(row);
    if (seen.has(stored.document_id)) continue;
    seen.add(stored.document_id);
    unlisted.push({ documentId: stored.document_id as DocumentId, lastListedAt: stored.as_of as Timestamp });
  }
  return unlisted;
}

const idRow = z.object({ id: z.string() });
const countsRow = z.object({ entity_set: z.string(), listed: z.number(), no_longer_listed: z.number() });

/** The Documents of the Session whose rows the feed no longer lists, as of the Session's latest complete pull. */
function unlistedDocumentsOf(database: DatabaseSync, session: SessionKey): Set<string> {
  const rows = database
    .prepare(
      "SELECT DISTINCT document_id AS id FROM feed_row WHERE session_key = ? AND document_id IS NOT NULL AND last_listed_pull <= ?",
    )
    .all(session, noLongerListedThrough(database, session));
  return new Set(rows.map((row) => idRow.parse(row).id));
}

/**
 * Records a complete Full pull, inside the caller's transaction: the next number for the Session, then every row the
 * pull listed under it. A row the pull missed needs no write (the pulls that have missed it are counted from the numbers),
 * so a row that is missing is not a row that is written. An Increment and a refused pull never come here (ADR-0030).
 *
 * Says whether the pull changed which Documents search holds: a Document it makes No longer listed, or lists again. The
 * writer raises the search generation when it did, in the same transaction, so a server that has the vectors in memory
 * reads them again even when two pulls share an As of. The Documents are asked of the rule before and after the pull, so
 * the answer follows the rule and does not repeat it.
 */
export function recordCompletePull(
  database: DatabaseSync,
  session: SessionKey,
  asOf: Timestamp,
  rows: readonly ListedRow[],
): { searchChanged: boolean } {
  const unlistedBefore = unlistedDocumentsOf(database, session);
  const number = latestCompletePull(database, session) + 1;
  database.prepare("INSERT INTO feed_pull (session_key, number, as_of) VALUES (?, ?, ?)").run(session, number, asOf);
  const listRow = database.prepare(
    `INSERT INTO feed_row (session_key, entity_set, row_key, document_id, last_listed_pull) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (session_key, entity_set, row_key) DO UPDATE SET
         document_id = excluded.document_id, last_listed_pull = excluded.last_listed_pull`,
  );
  for (const row of rows) listRow.run(session, row.entitySet, row.key, row.documentId, number);
  const unlistedAfter = unlistedDocumentsOf(database, session);
  const searchChanged =
    unlistedBefore.size !== unlistedAfter.size || [...unlistedAfter].some((id) => !unlistedBefore.has(id));
  return { searchChanged };
}

/**
 * For each entity set the index keeps rows of, how many are listed and how many are No longer listed. For the build
 * report (ADR-0030).
 */
export function countListedRows(
  database: DatabaseSync,
  session: SessionKey,
): { entitySet: string; listed: number; noLongerListed: number }[] {
  return database
    .prepare(
      `SELECT entity_set, SUM(last_listed_pull > ?2) AS listed, SUM(last_listed_pull <= ?2) AS no_longer_listed
       FROM feed_row WHERE session_key = ?1 GROUP BY entity_set ORDER BY entity_set`,
    )
    .all(session, noLongerListedThrough(database, session))
    .map((row) => {
      const stored = countsRow.parse(row);
      return { entitySet: stored.entity_set, listed: stored.listed, noLongerListed: stored.no_longer_listed };
    });
}
