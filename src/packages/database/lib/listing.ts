// The Listing (ticket #97; ADR-0005, ADR-0030, ADR-0037; glossary "Listing" and "No longer listed"): whether the feed
// still lists a row the index keeps, and when a complete Full pull last listed it. This file is the one place that knows
// how the answer is made, so the writer, the reader and search each ask it and none repeats the rule.
//
// The state is the two tables `feed_pull` and `feed_row` (connection.ts). The two-pull arithmetic is one TS function,
// `lastPullThatIsNoLongerListed`, and everything derives from it: `isListed` for a row the reader holds, and the number
// the queries of the writer and of search bind as a parameter (`last_listed_pull <= ?`), where they need the rule applied
// inside SQL to a million rows. No SQL of this file spells the arithmetic, so there is nothing to keep in step with it.
// The view `feed_row_state` in connection.ts says the same in SQL and is no longer read by anything: the schema text is
// version 1 of the index (ADR-0048) and is left as it was.
//
// Which entity set and key a row is kept under is named here too (`listedRowsOf`), so that a ticket that makes the pull read
// another set adds its rows to that function and to nothing else.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type {
  DocumentId,
  DocumentKind,
  DocumentLink,
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
export function lastPullThatIsNoLongerListed(latestPull: number): number {
  return latestPull - MISSES_THAT_UNLIST;
}

/** Whether a row last listed by complete pull `lastListedPull` is still listed, when `latestPull` is the Session's latest. */
export function isListed(latestPull: number, lastListedPull: number): boolean {
  return lastListedPull > lastPullThatIsNoLongerListed(latestPull);
}

const numberRow = z.object({ number: z.number() });

/** The number of the Session's latest complete Full pull, or 0 while it has none. */
export function latestCompletePull(database: DatabaseSync, session: SessionKey): number {
  return numberRow.parse(
    database.prepare("SELECT COALESCE(MAX(number), 0) AS number FROM feed_pull WHERE session_key = ?").get(session),
  ).number;
}

/**
 * The SQL term for whether the feed lists a row, over a LEFT JOIN of `feed_row_state` aliased `fr`. The join finds no
 * row for one that no complete full pull has listed (the index was built before the listing was kept, or an
 * increment stored it): such a row is read as listed, not yet checked (ADR-0030).
 */
export const listedOrUnchecked = "COALESCE(fr.listed, 1)";

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

const idRow = z.object({ id: z.string() });
const countsRow = z.object({ entity_set: z.string(), listed: z.number(), no_longer_listed: z.number() });

/** The Documents of the Session whose rows the feed no longer lists, as of the Session's latest complete pull. */
function unlistedDocumentsOf(database: DatabaseSync, session: SessionKey): Set<string> {
  const rows = database
    .prepare(
      "SELECT DISTINCT document_id AS id FROM feed_row WHERE session_key = ? AND document_id IS NOT NULL AND last_listed_pull <= ?",
    )
    .all(session, lastPullThatIsNoLongerListed(latestCompletePull(database, session)));
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
    .all(session, lastPullThatIsNoLongerListed(latestCompletePull(database, session)))
    .map((row) => {
      const stored = countsRow.parse(row);
      return { entitySet: stored.entity_set, listed: stored.listed, noLongerListed: stored.no_longer_listed };
    });
}
