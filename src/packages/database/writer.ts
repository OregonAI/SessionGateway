// The ingest worker's side of the database. The server has no way to reach this file's functions:
// it imports reader.ts only.
import { z } from "zod";
import {
  meetingDocumentKinds,
  type AgendaItem,
  type AmendmentHeader,
  type Committee,
  type CommitteeMember,
  type Convening,
  type DocumentId,
  type DocumentKind,
  type DocumentLink,
  type Meeting,
  type SessionDates,
  type SessionSpan,
  type StoredDocument,
  type TestimonyDetails,
} from "#/packages/domain/documents.ts";
import type { HistoryAction, Measure, MeasureId, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { Legislator, LegislatorId, LegislatorRow, SponsorLevel } from "#/packages/domain/legislators.ts";
import type { AgencyId, SnapshotVersion } from "#/packages/domain/oregonai.ts";
import type { AgencyLink } from "#/packages/domain/agency-links.ts";
import type { Citation } from "#/packages/domain/citations.ts";
import type { Passage, SearchEntry } from "#/packages/domain/search.ts";
import type {
  RelatingClauseEdit,
  StatuteLink,
  StatuteLinkSource,
  StatutesAffectedEntry,
} from "#/packages/domain/statute-links.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { evidenceToJson } from "./lib/agency-evidence.ts";
import { openWriteConnection } from "./lib/connection.ts";
import {
  readFullPullAsOf,
  readFullPullAttempt,
  readIncrementAsOf,
  readMeetingDays,
  readConveneDays,
  readSessionDates,
} from "./lib/run-state.ts";
import { listedRowsOf } from "./lib/listing.ts";
import { statuteLinkOfRow, statuteLinkRow } from "./lib/statute-link-rows.ts";

type SponsorRecordFields = {
  id: number;
  measure: MeasureKey;
  level: SponsorLevel;
  printOrder: number;
};

/**
 * One MeasureSponsors row of the feed. A Member row carries the Legislator its code resolved to, if
 * any; a Committee row names a committee and a Presession row carries a message, and neither names a
 * Legislator.
 */
export type SponsorRecord =
  | (SponsorRecordFields & { kind: "member"; legislatorCode: string; legislatorId: LegislatorId | null })
  | (SponsorRecordFields & { kind: "committee"; committeeCode: string })
  | (SponsorRecordFields & { kind: "presession"; message: string });

/** A Legislator Code and the id of the Legislator it names. */
export type LegislatorCodeRecord = { code: string; legislatorId: LegislatorId };

/** What the worker stores of a floor vote entry: the entry and the Legislator its code resolved to, if any. */
export type FloorVoteRecord = FloorVoteEntry & { legislatorId: LegislatorId | null };

/** What the worker stores of a committee vote entry: the entry and the Legislator its code resolved to, if any. */
export type CommitteeVoteRecord = CommitteeVoteEntry & { legislatorId: LegislatorId | null };

/**
 * One CommitteePublicTestimonies row of the feed, with the Agency its `Organization` names, if any. The
 * link is the Testimony's document link, which carries what the feed says of it (`testimony`), and the
 * Measure, committee and meeting it points at.
 */
export type TestimonyRecord = {
  link: DocumentLink & { testimony: TestimonyDetails };
  agencyId: AgencyId | null;
};

/**
 * Everything a full pull read, ready to store: one field for each kind of row. A ticket that makes the
 * pull read another kind of row adds a field here, not a parameter to `recordFullPull`.
 */
export type FullPullRecord = {
  measures: readonly Measure[];
  history: readonly HistoryAction[];
  /** The feed's Legislators rows, one for each Legislator Code, as the pull read them: the rows the index keeps and lists. */
  legislatorRows: readonly LegislatorRow[];
  /** The Legislators the resolver can name. */
  legislators: readonly Legislator[];
  /** Every Legislator Code the resolver can resolve, with the id of the Legislator it names (the live lookup resolves codes OLIS sends later). */
  legislatorCodes: readonly LegislatorCodeRecord[];
  /** The MeasureSponsors rows, with the Legislator each Member row's code resolved to. */
  sponsors: readonly SponsorRecord[];
  floorVotes: readonly FloorVoteRecord[];
  committeeVotes: readonly CommitteeVoteRecord[];
  committees: readonly Committee[];
  /** The committee meetings. A meeting's status is the feed's latest. */
  meetings: readonly Meeting[];
  /** The agenda items of every meeting. An item's action is the feed's latest. */
  agendaItems: readonly AgendaItem[];
  /**
   * Every document the feed links, the meetings' agendas included, whether or not its file is fetched
   * yet. What each meeting lists (its agenda, Exhibits, Recording Logs and the postings of Proposed
   * Amendments) and which analysis documents each Measure has are stored from these before any file is
   * fetched, so a file that fails to come is still listed (ADR-0011, "Order of a pull").
   */
  documentLinks: readonly DocumentLink[];
  /**
   * The Testimony rows of the feed, each with the Agency its `Organization` names. They are listed here, and
   * not only as document links, so the server can say who testified before every file is fetched.
   */
  testimony: readonly TestimonyRecord[];
  /** The CommitteeMembers rows, every one: the set's declared key is not unique (`CommitteeMember.key` is the whole row). */
  committeeMembers: readonly CommitteeMember[];
  /** The ConveneTimes rows: the days with a floor convening. A full pull reads them whole; an increment does not read them (ADR-0042). */
  convenings: readonly Convening[];
  /** The Session's LegislativeSessions row, or undefined when the feed has none or the run did not read it. */
  sessionDates: SessionDates | undefined;
};

/** A file the store holds that has not been read for Statute Links yet: one document stands for every document with the same file. */
export type UnreadStatuteFile = {
  /** A stored document with the file. */
  documentId: DocumentId;
  /** What the file is read as: a Version, or a posting of a Proposed Amendment. */
  readAs: StatuteLinkSource;
  contentHash: string;
};

/** What reading one file for Statute Links came to, ready to store. */
export type StatuteParseRecord = {
  contentHash: string;
  readAs: StatuteLinkSource;
  textRead: boolean;
  amendedVersionHeader: AmendmentHeader | null;
  links: readonly StatuteLink[];
  relatingClauseEdits: readonly RelatingClauseEdit[];
};

/** The Statutes Affected Table as the worker read it, ready to store: the copy, kept like a document, and its entries. */
export type StatutesAffectedTableRecord = {
  sourceUrl: string;
  /** When the bytes were retrieved. */
  retrievedAt: Timestamp;
  /** The sha256 of the bytes, which the next pull compares with the bytes it fetches. */
  contentHash: string;
  pageCount: number;
  /** The extracted text, as the pdf-text package gives it. */
  text: string;
  entries: readonly StatutesAffectedEntry[];
};

/** What an Agency Link is read from: a Fiscal Impact Statement's text, or a Version's or a posting's. */
export type AgencyReadAs = "fiscal_impact_statement" | "version" | "proposed_amendment";

/** A stored document whose Agency Links have not been read yet (ADR-0027). */
export type UnreadAgencyDocument = { documentId: DocumentId; readAs: AgencyReadAs };

/** What reading one stored document for Agency Links came to, ready to store. */
export type AgencyReadRecord = {
  documentId: DocumentId;
  /** Links of the kinds the store keeps itself: not Testimony's, which the Testimony row carries. */
  links: readonly AgencyLink[];
  /** The units a Fiscal Impact Statement lists that are not Agencies, as it writes them. */
  unresolvedUnits: readonly string[];
};

/** The columns of the sponsor table that only some kinds of row fill; the others stay NULL. */
function kindColumnsOf(sponsor: SponsorRecord): {
  legislatorCode: string | null;
  legislatorId: string | null;
  committeeCode: string | null;
  message: string | null;
} {
  const none = { legislatorCode: null, legislatorId: null, committeeCode: null, message: null };
  switch (sponsor.kind) {
    case "member":
      return { ...none, legislatorCode: sponsor.legislatorCode, legislatorId: sponsor.legislatorId };
    case "committee":
      return { ...none, committeeCode: sponsor.committeeCode };
    case "presession":
      return { ...none, message: sponsor.message };
    default:
      return sponsor satisfies never;
  }
}

/** What search keeps of one document, stored in the same transaction as the document. */
export type SearchRecord = {
  entry: SearchEntry;
  passages: readonly Passage[];
  /**
   * The citations the document's whole text makes (a Measure, a Proposed Amendment, an ORS section), each once, with
   * where its first mention starts in the text. Read over the whole text and not passage by passage, so a citation
   * that a passage boundary splits is still the document's.
   */
  citations: readonly Citation[];
  /**
   * The vectors of passages this document brings that the index does not hold yet: the passage's hash and its
   * int8 vector, under the id of the model that made it. A vector that is already stored is not given again,
   * so an unchanged passage is never embedded twice.
   */
  vectors: { modelId: string; rows: readonly { hash: string; vector: Int8Array }[] };
};

/** A stored document with where it came from and the hash of its file: what the hash sample compares (ticket #20). */
export type StoredDocumentHash = { id: DocumentId; sourceUrl: string; contentHash: string };

export type IndexWriter = {
  /**
   * Stores what a full pull read, when, and the version of the OregonAI snapshot the build used, in one
   * transaction. A meeting's status, an agenda item's action, and a listed document's label, Measure and
   * a posting's Meaning are the feed's latest. The listing of analysis documents replaces the Session's,
   * so the server can tell a Measure whose statement the worker could not fetch from one that has none.
   * The same goes for the Testimony rows: what the feed says of each, and the Agency its Organization names,
   * are the feed's latest, whether or not the file is fetched. A full pull never deletes anything else (ADR-0005).
   * The pull counts as a complete one in the same transaction: every row it read is listed by it, and a row
   * that two complete pulls in a row have not listed is no longer listed (ADR-0030). A pull that is not complete
   * is never given to this method.
   */
  recordFullPull(session: SessionKey, asOf: Timestamp, pulled: FullPullRecord): void;
  /**
   * Stores what an increment read (ADR-0039): the rows OLIS created or modified since the last run, upserted as a full
   * pull upserts them, in one transaction, and the increment's time. It is not a complete pull and counts for nothing in
   * the two-pull rule (ADR-0030): it writes no `feed_pull` and no `feed_row`, so a row a complete pull has seen keeps the
   * number of the latest complete pull that listed it, and a row it sees first has no listing row (read as listed, not yet
   * checked). It never marks anything no longer listed, and it replaces no listing: the Versions it reads are added to the
   * listing of Versions, none removed.
   */
  recordIncrement(session: SessionKey, asOf: Timestamp, pulled: FullPullRecord): void;
  /**
   * When the Session's last complete full pull, last increment and last begun full pull (complete or refused) started,
   * or undefined while there has been none.
   */
  lastRuns(session: SessionKey): {
    fullPull: Timestamp | undefined;
    increment: Timestamp | undefined;
    fullPullAttempt: Timestamp | undefined;
  };
  /**
   * The highest `FloorLetterId` of the Session's Floor Letters the index holds a row of, or undefined while it holds none:
   * an increment asks OLIS for the ids above it, because the set carries no dates (ADR-0005, ADR-0045).
   */
  highestFloorLetterId(session: SessionKey): number | undefined;
  /** Records that a full pull was begun at this time, before it reads, so a pull that is refused still counts for its day. */
  recordFullPullAttempt(session: SessionKey, startedAt: Timestamp): void;
  /** The Pacific dates (YYYY-MM-DD) of the Session's committee meetings the index holds: days the Session meets. */
  meetingDays(session: SessionKey): string[];
  /** The Pacific dates (YYYY-MM-DD) of the Session's floor convenings (ConveneTimes) the index holds: days the Session meets (ADR-0042). */
  conveneDays(session: SessionKey): string[];
  /** The dates the Session begins and ends on (its LegislativeSessions row), or undefined until a full pull has read the row (ADR-0042). */
  sessionDates(session: SessionKey): SessionSpan | undefined;
  /** The commit of the snapshot the index reports (the last full pull's), or undefined while it reports none. */
  reportedSnapshotCommit(session: SessionKey): string | undefined;
  /**
   * Records which snapshot the index's links were all read with, and the parent of each Agency it gives one, in one
   * transaction so that the two always agree (ADR-0029). It is the last step of a pull, after the Statute Links and the
   * Agency Links have been read with this snapshot (ADR-0035): until then `session_overview` reports the snapshot of
   * the last pull that finished, and a pull that stops part-way leaves it so.
   */
  recordSnapshotRead(
    session: SessionKey,
    snapshot: SnapshotVersion,
    agencyParents: readonly { agency: AgencyId; parent: AgencyId }[],
  ): void;
  /**
   * For each entity set the index keeps rows of, how many are listed (fewer than two complete pulls in a row have
   * missed them) and how many are no longer listed (ADR-0030). For the build report.
   */
  listingCounts(session: SessionKey): { entitySet: string; listed: number; noLongerListed: number }[];
  /**
   * The CommitteeMembers rows the table holds, each as its committee and the Legislator Code the feed wrote, ordered
   * by committee, then code. For the build report, which is how an operator sees that rows sharing a declared key
   * were all kept (ADR-0030): no tool shows the set.
   */
  committeeMembers(session: SessionKey): { committeeCode: string; legislatorCode: string }[];
  /** The ids of the documents already stored for the Session: a stored document is never fetched again. */
  storedDocumentIds(session: SessionKey): Set<DocumentId>;
  /**
   * Brings what the feed says about documents already stored up to date, in one transaction: each one's
   * label, the node it belongs to, when it was posted, an analysis document's Version label and minority
   * flag and the nodes it points at, and what search files it under (its Measure, committee, title, date and whether
   * it is keyword-only). A fetched file is unchanging (ADR-0005), so its text, hash, retrieval time and passages
   * are left alone. A document that is filed as embeddable now needs its vectors to be stored before this call
   * (`storeVectors`). A link whose document is not stored is ignored.
   */
  refreshDocuments(
    session: SessionKey,
    links: readonly DocumentLink[],
    searchEntries: ReadonlyMap<DocumentId, SearchEntry>,
  ): void;
  /** Which of these passage hashes already have a vector under this model id. */
  storedVectorHashes(modelId: string, hashes: readonly string[]): Set<string>;
  /** The stored documents of the Session that search files as keyword-only, by id: they have no vectors. */
  keywordOnlyDocumentIds(session: SessionKey): Set<DocumentId>;
  /** The passages a stored document was cut into, in order, with their text as the document has it. */
  passagesOf(document: DocumentId): Passage[];
  /**
   * Keeps vectors for passages the index holds, in their own transaction. The server loads the vectors of the
   * passages of documents that are not keyword-only, so these are not seen until the document is filed as
   * embeddable (`refreshDocuments`).
   */
  storeVectors(vectors: SearchRecord["vectors"]): void;
  /** Every stored document of the Session with where it came from and the hash of its file, by id (the hash sample, ticket #20). */
  documentsToSample(session: SessionKey): StoredDocumentHash[];
  /** Every stored document of the Session whose file has no text layer, by id. */
  documentsWithoutTextLayer(session: SessionKey): { id: DocumentId; sourceUrl: string }[];
  /**
   * Keeps one fetched document, its text, the nodes it points at, and what search keeps of it (its entry and
   * its passages), in one transaction: a document is never stored without being searchable.
   */
  storeDocument(session: SessionKey, document: StoredDocument, search: SearchRecord): void;
  /**
   * Replaces a stored agenda with the one fetched again after its revision changed (ADR-0041), in one transaction:
   * the text, hashes, relations, filing, passages, citations and the revision it was fetched at are the new ones,
   * and no trace of the old text is left in search. The vectors are stored as `storeDocument` stores them.
   */
  replaceDocument(session: SessionKey, document: StoredDocument, search: SearchRecord): void;
  /**
   * The `AgendaRevisionNumber` each stored agenda was fetched at, by document id. An agenda stored before the revision
   * was recorded has none.
   */
  storedAgendaRevisions(session: SessionKey): Map<DocumentId, number>;
  /**
   * The files of the Session's stored Versions and postings of Proposed Amendments that have not been read
   * for Statute Links with this snapshot, each once however many documents share it: a file never read, and every
   * file read with another commit, because a range is expanded against the snapshot's section list (ADR-0035).
   * Read from the stored text; nothing is fetched.
   */
  unreadStatuteFiles(session: SessionKey, snapshot: SnapshotVersion): UnreadStatuteFile[];
  /** The stored text of one document, and whether the file had a text layer. */
  storedText(id: DocumentId): { text: string; hasTextLayer: boolean };
  /**
   * Keeps what reading one file came to with this snapshot, its links with it, in one transaction. The links an
   * earlier reading of the file made are replaced.
   */
  storeStatuteParse(record: StatuteParseRecord, snapshot: SnapshotVersion): void;
  /** The content hash of the Statutes Affected Table the Session's index holds, or undefined while it holds none. */
  statutesAffectedTableHash(session: SessionKey): string | undefined;
  /**
   * The Measures for which the feed lists a Version with this description ("E-Engrossed"), as the last full pull read
   * the feed and whether or not the worker fetched the Version's file.
   */
  measuresListingVersion(session: SessionKey, description: string): Set<MeasureId>;
  /**
   * Replaces the table the Session's index holds, its entries with it, in one transaction: a server that reads
   * during the pull sees the old table or the new one, never half of either. It also forgets the bytes last refused.
   */
  storeStatutesAffectedTable(session: SessionKey, record: StatutesAffectedTableRecord): void;
  /** The bytes the worker last refused as no table, by their sha256, and why; undefined if it refused none since it last stored a table. */
  refusedStatutesAffectedTable(session: SessionKey): { contentHash: string; reason: string } | undefined;
  /** Remembers the sha256 of bytes refused as no table, so that the next pull that is given them does not read them again. */
  refuseStatutesAffectedTable(session: SessionKey, refusal: { contentHash: string; reason: string }): void;
  /**
   * The Session's stored Fiscal Impact Statements, Versions and postings of Proposed Amendments that have not been
   * read for Agency Links with this snapshot, each once: a document never read, and every document read with another
   * commit of the snapshot, so that the index holds no link made with a snapshot it does not report (spec #1 story 56).
   * A Version and a posting are read after their Statute Links are (ADR-0027).
   */
  unreadAgencyDocuments(session: SessionKey, snapshot: SnapshotVersion): UnreadAgencyDocument[];
  /** The Statute Links read from the file a stored Version or posting has, in the order they were read. */
  statuteLinksOf(document: DocumentId): StatuteLink[];
  /**
   * Keeps what reading one document for Agency Links came to with this snapshot, in one transaction, and marks the
   * document read with it. The links an earlier reading of the document made are replaced.
   */
  storeAgencyRead(record: AgencyReadRecord, snapshot: SnapshotVersion): void;
  close(): void;
};

const idRow = z.object({ id: z.string() });
const revisionRow = z.object({ id: z.string(), revision: z.number() });
const pullNumberRow = z.object({ number: z.number() });
const countRow = z.object({ n: z.number() });
const memberRow = z.object({ committee_code: z.string(), legislator_code: z.string() });
const listingCountRow = z.object({ entity_set: z.string(), listed: z.number(), no_longer_listed: z.number() });
const scanRow = z.object({ id: z.string(), source_url: z.string() });
const sampleRow = z.object({ id: z.string(), source_url: z.string(), content_hash: z.string() });
const unreadFileRow = z.object({
  id: z.string(),
  kind: z.enum(["version", "proposed_amendment"]),
  content_hash: z.string(),
});
const storedTextRow = z.object({ text: z.string(), has_text_layer: z.number() });
const tableHashRow = z.object({ content_hash: z.string() });
const measureIdRow = z.object({ measure_id: z.string() });
const refusalRow = z.object({ content_hash: z.string(), reason: z.string() });
const unreadAgencyRow = z.object({ id: z.string(), kind: z.enum(["version", "proposed_amendment", "analysis"]) });
const passageRow = z.object({
  start_offset: z.number(),
  end_offset: z.number(),
  text_hash: z.string(),
  text: z.string(),
});

/** SQLite has no boolean: an analysis document's flag is 0 or 1, and any other document's is NULL. */
function minorityColumn(isMinority: boolean | undefined): 0 | 1 | null {
  return isMinority === undefined ? null : isMinority ? 1 : 0;
}

/** The meeting a link is listed under and, for a posting, what the committee did with it there. */
function meetingListingOf(link: DocumentLink): { meetingId: string; meaning: string | null } | undefined {
  if (!(meetingDocumentKinds as readonly DocumentKind[]).includes(link.kind)) return undefined;
  const bound =
    link.relations.find((relation) => relation.relation === "posted_to") ??
    link.relations.find((relation) => relation.relation === "meeting");
  return bound === undefined ? undefined : { meetingId: bound.to, meaning: bound.meaning };
}

export function openIndexWriter(path: string): IndexWriter {
  const database = openWriteConnection(path);
  const raiseSearchGeneration = database.prepare("UPDATE search_generation SET generation = generation + 1");
  /**
   * Raises the search generation (ADR-0025): the number the server compares to know that what it holds in memory for
   * the meaning side is out of date, and to load it again. Every write that changes what search shows calls this
   * inside its own transaction: storing the passages of a document, refiling one, and a full pull's listing or
   * unlisting of a document. A write that is added later (the increments of ticket #17, ADR-0030) calls it for the
   * same reasons and does not copy the statement.
   */
  function bumpSearchGeneration(): void {
    raiseSearchGeneration.run();
  }
  /** The upserts a full pull and an increment share; a full pull also lists what it read and replaces the Versions' listing. */
  function recordRows(
    session: SessionKey,
    asOf: Timestamp,
    pulled: FullPullRecord,
    mode: "full_pull" | "increment",
  ): void {
    const upsertMeasure = database.prepare(
      `INSERT INTO measure (session_key, prefix, number, catchline, location, committee_code, digest, created_at,
                              modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, prefix, number) DO UPDATE SET
           catchline = excluded.catchline, location = excluded.location, committee_code = excluded.committee_code,
           digest = excluded.digest, created_at = excluded.created_at, modified_at = excluded.modified_at`,
    );
    const upsertLegislator = database.prepare(
      `INSERT INTO legislator (session_key, id, name) VALUES (?, ?, ?)
         ON CONFLICT (session_key, id) DO UPDATE SET name = excluded.name`,
    );
    const upsertLegislatorCode = database.prepare(
      `INSERT INTO legislator_code (session_key, code, legislator_id) VALUES (?, ?, ?)
         ON CONFLICT (session_key, code) DO UPDATE SET legislator_id = excluded.legislator_id`,
    );
    const upsertSponsor = database.prepare(
      `INSERT INTO sponsor (session_key, sponsor_id, prefix, number, kind, level, print_order,
                              legislator_code, legislator_id, committee_code, presession_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, sponsor_id) DO UPDATE SET
           prefix = excluded.prefix, number = excluded.number, kind = excluded.kind, level = excluded.level,
           print_order = excluded.print_order, legislator_code = excluded.legislator_code,
           legislator_id = excluded.legislator_id, committee_code = excluded.committee_code,
           presession_message = excluded.presession_message`,
    );
    const upsertFloorVote = database.prepare(
      `INSERT INTO floor_vote (session_key, vote_id, history_id, prefix, number, chamber, action_date, action_text,
                                 legislator_code, legislator_id, vote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, vote_id) DO UPDATE SET
           history_id = excluded.history_id, prefix = excluded.prefix, number = excluded.number,
           chamber = excluded.chamber, action_date = excluded.action_date, action_text = excluded.action_text,
           legislator_code = excluded.legislator_code, legislator_id = excluded.legislator_id, vote = excluded.vote`,
    );
    const upsertCommitteeVote = database.prepare(
      `INSERT INTO committee_vote (session_key, vote_id, report_id, prefix, number, committee_code, meeting_date,
                                     legislator_code, legislator_id, vote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, vote_id) DO UPDATE SET
           report_id = excluded.report_id, prefix = excluded.prefix, number = excluded.number,
           committee_code = excluded.committee_code, meeting_date = excluded.meeting_date,
           legislator_code = excluded.legislator_code, legislator_id = excluded.legislator_id, vote = excluded.vote`,
    );
    const upsertHistory = database.prepare(
      `INSERT INTO history_action (session_key, history_id, prefix, number, chamber, action_date, action_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, history_id) DO UPDATE SET
           prefix = excluded.prefix, number = excluded.number, chamber = excluded.chamber,
           action_date = excluded.action_date, action_text = excluded.action_text`,
    );
    const recordAsOf = database.prepare(
      `INSERT INTO index_state (session_key, full_pull_as_of) VALUES (?, ?)
         ON CONFLICT (session_key) DO UPDATE SET full_pull_as_of = excluded.full_pull_as_of`,
    );
    const recordIncrementAsOf = database.prepare(
      `INSERT INTO increment_state (session_key, as_of) VALUES (?, ?)
         ON CONFLICT (session_key) DO UPDATE SET as_of = excluded.as_of`,
    );
    const upsertCommittee = database.prepare(
      `INSERT INTO committee (session_key, code, id, name) VALUES (?, ?, ?, ?)
         ON CONFLICT (session_key, code) DO UPDATE SET id = excluded.id, name = excluded.name`,
    );
    const upsertMeeting = database.prepare(
      `INSERT INTO meeting (id, session_key, committee_code, committee_id, at, status) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET committee_code = excluded.committee_code,
           committee_id = excluded.committee_id, at = excluded.at, status = excluded.status`,
    );
    const upsertAgendaItem = database.prepare(
      `INSERT INTO agenda_item (id, meeting_id, session_key, measure_prefix, measure_number, meeting_type, action,
                                  print_order, comments, board_name, executive_appointee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET meeting_id = excluded.meeting_id, measure_prefix = excluded.measure_prefix,
           measure_number = excluded.measure_number, meeting_type = excluded.meeting_type, action = excluded.action,
           print_order = excluded.print_order, comments = excluded.comments, board_name = excluded.board_name,
           executive_appointee = excluded.executive_appointee`,
    );
    const upsertMeetingDocument = database.prepare(
      `INSERT INTO meeting_document (document_id, meeting_id, session_key, kind, node_id, label, source_url,
                                       title, measure_id, meaning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (document_id) DO UPDATE SET meeting_id = excluded.meeting_id, kind = excluded.kind,
           node_id = excluded.node_id, label = excluded.label, source_url = excluded.source_url,
           title = excluded.title, measure_id = excluded.measure_id, meaning = excluded.meaning`,
    );
    const upsertTestimony = database.prepare(
      `INSERT INTO testimony (document_id, session_key, comm_test_id, measure_id, source_url, document_description,
                                position_id, submitter, behalf_of, organization, committee_id, committee_code,
                                meeting_at, agency_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (document_id) DO UPDATE SET
           comm_test_id = excluded.comm_test_id, measure_id = excluded.measure_id, source_url = excluded.source_url,
           document_description = excluded.document_description, position_id = excluded.position_id,
           submitter = excluded.submitter, behalf_of = excluded.behalf_of, organization = excluded.organization,
           committee_id = excluded.committee_id, committee_code = excluded.committee_code,
           meeting_at = excluded.meeting_at, agency_id = excluded.agency_id`,
    );
    const upsertFloorLetter = database.prepare(
      `INSERT INTO floor_letter (document_id, session_key, floor_letter_id, measure_id, source_url, chamber, letter_date,
                                   title, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (document_id) DO UPDATE SET
           floor_letter_id = excluded.floor_letter_id, measure_id = excluded.measure_id, source_url = excluded.source_url,
           chamber = excluded.chamber, letter_date = excluded.letter_date, title = excluded.title,
           description = excluded.description`,
    );
    const upsertCreated = database.prepare(
      `INSERT INTO document_created (document_id, created_at) VALUES (?, ?)
         ON CONFLICT (document_id) DO UPDATE SET created_at = excluded.created_at`,
    );
    const upsertAnalysisListing = database.prepare(
      `INSERT INTO analysis_listing (document_id, session_key, measure_id) VALUES (?, ?, ?)
         ON CONFLICT (document_id) DO UPDATE SET measure_id = excluded.measure_id`,
    );
    const selectLatestPull = database.prepare(
      "SELECT COALESCE(MAX(number), 0) AS number FROM feed_pull WHERE session_key = ?",
    );
    const insertPull = database.prepare("INSERT INTO feed_pull (session_key, number, as_of) VALUES (?, ?, ?)");
    const listRow = database.prepare(
      `INSERT INTO feed_row (session_key, entity_set, row_key, document_id, last_listed_pull) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (session_key, entity_set, row_key) DO UPDATE SET
           document_id = excluded.document_id, last_listed_pull = excluded.last_listed_pull`,
    );
    const selectUnlistedDocuments = database.prepare(
      "SELECT document_id AS id FROM feed_row WHERE session_key = ? AND document_id IS NOT NULL AND last_listed_pull <= ?",
    );
    const countDocumentsLastListedIn = database.prepare(
      "SELECT COUNT(*) AS n FROM feed_row WHERE session_key = ? AND document_id IS NOT NULL AND last_listed_pull = ?",
    );
    const upsertCommitteeMember = database.prepare(
      `INSERT INTO committee_member (session_key, row_key, committee_code, legislator_code, title, created_at,
                                       modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, row_key) DO NOTHING`,
    );
    const upsertConvening = database.prepare(
      "INSERT INTO convening (session_key, at, chamber) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    );
    const upsertSessionDates = database.prepare(
      `INSERT INTO session_dates (session_key, begin_date, end_date) VALUES (?, ?, ?)
         ON CONFLICT (session_key) DO UPDATE SET begin_date = excluded.begin_date, end_date = excluded.end_date`,
    );
    const insertVersionListing = database.prepare(
      "INSERT OR REPLACE INTO version_listing (document_id, session_key, measure_id, label) VALUES (?, ?, ?, ?)",
    );
    const clearVersionListing = database.prepare("DELETE FROM version_listing WHERE session_key = ?");
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const measure of pulled.measures) {
        upsertMeasure.run(
          measure.session,
          measure.prefix,
          measure.number,
          measure.catchline,
          measure.location.current,
          measure.location.committeeCode,
          measure.digest,
          measure.createdAt,
          measure.modifiedAt,
        );
      }
      for (const legislator of pulled.legislators) upsertLegislator.run(session, legislator.id, legislator.name);
      for (const record of pulled.legislatorCodes) upsertLegislatorCode.run(session, record.code, record.legislatorId);
      for (const sponsor of pulled.sponsors) {
        const columns = kindColumnsOf(sponsor);
        upsertSponsor.run(
          session,
          sponsor.id,
          sponsor.measure.prefix,
          sponsor.measure.number,
          sponsor.kind,
          sponsor.level,
          sponsor.printOrder,
          columns.legislatorCode,
          columns.legislatorId,
          columns.committeeCode,
          columns.message,
        );
      }
      for (const entry of pulled.floorVotes) {
        upsertFloorVote.run(
          session,
          entry.id,
          entry.historyId,
          entry.measure.prefix,
          entry.measure.number,
          entry.chamber,
          entry.date,
          entry.action,
          entry.legislatorCode,
          entry.legislatorId,
          entry.vote,
        );
      }
      for (const entry of pulled.committeeVotes) {
        upsertCommitteeVote.run(
          session,
          entry.id,
          entry.reportId,
          entry.measure.prefix,
          entry.measure.number,
          entry.committeeCode,
          entry.meetingDate,
          entry.legislatorCode,
          entry.legislatorId,
          entry.vote,
        );
      }
      for (const action of pulled.history) {
        upsertHistory.run(
          session,
          action.id,
          action.measure.prefix,
          action.measure.number,
          action.chamber,
          action.date,
          action.text,
        );
      }
      for (const committee of pulled.committees) {
        upsertCommittee.run(session, committee.code, committee.id, committee.name);
      }
      for (const meeting of pulled.meetings) {
        upsertMeeting.run(meeting.id, session, meeting.committeeCode, meeting.committeeId, meeting.at, meeting.status);
      }
      for (const item of pulled.agendaItems) {
        upsertAgendaItem.run(
          item.itemId,
          item.meetingId,
          session,
          item.measure?.prefix ?? null,
          item.measure?.number ?? null,
          item.meetingType,
          item.action,
          item.printOrder,
          item.comments,
          item.boardName,
          item.executiveAppointee,
        );
      }
      // Every CommitteeMembers row, by the whole row (the set's declared key is not unique). Two rows with one
      // whole-row key are the same row, and a row the feed changes is a new one; the old one stops being listed.
      for (const member of pulled.committeeMembers) {
        upsertCommitteeMember.run(
          session,
          member.key,
          member.committeeCode,
          member.legislatorCode,
          member.title,
          member.createdAt,
          member.modifiedAt,
        );
      }
      // The days with a floor convening, and the dates the Session is in progress between (ADR-0042).
      for (const convening of pulled.convenings) upsertConvening.run(session, convening.at, convening.chamber);
      if (pulled.sessionDates !== undefined) {
        upsertSessionDates.run(session, pulled.sessionDates.begin, pulled.sessionDates.end);
      }
      // What each meeting lists. A link to any other kind of document, or to no meeting, is not listed.
      for (const link of pulled.documentLinks) {
        const listing = meetingListingOf(link);
        if (listing === undefined) continue;
        upsertMeetingDocument.run(
          link.id,
          listing.meetingId,
          session,
          link.kind,
          link.nodeId,
          link.label,
          link.sourceUrl,
          link.title ?? null,
          link.relations.find((relation) => relation.relation === "measure")?.to ?? null,
          listing.meaning,
        );
      }
      // Who testified: every Testimony row as the feed says it, whether or not its file is fetched.
      for (const { link, agencyId } of pulled.testimony) {
        const committee = link.relations.find((relation) => relation.relation === "committee");
        if (committee === undefined) throw new Error(`The Testimony ${link.id} names no committee`);
        upsertTestimony.run(
          link.id,
          session,
          link.testimony.commTestId,
          link.relations.find((relation) => relation.relation === "measure")?.to ?? null,
          link.sourceUrl,
          link.label,
          link.testimony.position.id,
          link.testimony.submitter,
          link.testimony.behalfOf,
          link.testimony.organization,
          committee.to,
          link.testimony.committeeCode,
          link.testimony.meetingAt,
          agencyId,
        );
      }
      // Every Floor Letter row as the feed says it, whether or not its file is fetched (ADR-0045).
      for (const link of pulled.documentLinks) {
        const letter = link.floorLetter;
        if (letter === undefined) continue;
        upsertFloorLetter.run(
          link.id,
          session,
          letter.floorLetterId,
          link.relations.find((relation) => relation.relation === "measure")?.to ?? null,
          link.sourceUrl,
          letter.chamber,
          letter.letterDate,
          letter.title,
          letter.description,
        );
      }
      // When OLIS created the row of each document the feed links.
      for (const link of pulled.documentLinks) {
        if (link.createdAt !== undefined) upsertCreated.run(link.id, link.createdAt);
      }
      // Which analysis documents the feed lists for each Measure, as this pull read it. The rows are kept, not
      // replaced: a row this pull does not list is still counted until two complete pulls in a row have missed it,
      // and the count reads that from the listing state (ADR-0030).
      for (const link of pulled.documentLinks) {
        if (link.kind !== "analysis") continue;
        const measure = link.relations.find((relation) => relation.relation === "measure");
        if (measure === undefined) throw new Error(`The analysis document ${link.id} names no Measure`);
        upsertAnalysisListing.run(link.id, session, measure.to);
      }
      // Which Versions the feed lists for each Measure, as this pull read them (a Printed Amendment is not a Version).
      // A full pull replaces the listing; an increment read only the rows that changed, so it adds to it.
      if (mode === "full_pull") clearVersionListing.run(session);
      for (const link of pulled.documentLinks) {
        if (link.kind !== "version") continue;
        const measure = link.relations.find((relation) => relation.relation === "measure");
        if (measure === undefined) throw new Error(`The Version ${link.id} names no Measure`);
        insertVersionListing.run(link.id, session, measure.to, link.label);
      }
      if (mode === "increment") {
        recordIncrementAsOf.run(session, asOf);
        database.exec("COMMIT");
        return;
      }
      recordAsOf.run(session, asOf);
      // The pull is a complete one: it lists every row it read. A document that was no longer listed and is
      // listed again, or that this pull makes no longer listed, changes what search holds in memory.
      const previous = pullNumberRow.parse(selectLatestPull.get(session)).number;
      const number = previous + 1;
      const unlistedBefore = new Set(
        selectUnlistedDocuments.all(session, previous - 2).map((row) => idRow.parse(row).id),
      );
      insertPull.run(session, number, asOf);
      let relisted = false;
      for (const row of listedRowsOf(pulled)) {
        listRow.run(session, row.entitySet, row.key, row.documentId, number);
        if (row.documentId !== null && unlistedBefore.has(row.documentId)) relisted = true;
      }
      const agedOut = countRow.parse(countDocumentsLastListedIn.get(session, number - 2)).n > 0;
      if (relisted || agedOut) bumpSearchGeneration();
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  /**
   * Writes one fetched document with its relations, filing, passages, citations and vectors in one transaction. A
   * document it replaces (an agenda fetched again, ADR-0041) is deleted first, in the same transaction, so a reader
   * sees the old agenda or the new one and never neither.
   */
  function writeDocument(
    session: SessionKey,
    document: StoredDocument,
    search: SearchRecord,
    replacing: boolean,
  ): void {
    const insertDocument = database.prepare(
      `INSERT INTO document (id, node_id, session_key, kind, label, source_url, retrieved_at, content_hash,
                             text_hash, page_count, has_text_layer, posted_at, analysis_version_label,
                             analysis_is_minority, text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertRelation = database.prepare(
      `INSERT INTO document_relation (document_id, relation, to_id, meaning, provenance) VALUES (?, ?, ?, ?, ?)`,
    );
    const insertSearchDocument = database.prepare(
      `INSERT INTO search_document (document_id, session_key, node_id, kind, title, measure_id, committee_id,
                                    dated_at, keyword_only)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertPassage = database.prepare(
      "INSERT INTO passage (document_id, ordinal, start_offset, end_offset, text_hash) VALUES (?, ?, ?, ?, ?)",
    );
    const insertPassageText = database.prepare("INSERT INTO passage_fts (rowid, text) VALUES (?, ?)");
    const insertCitation = database.prepare(
      "INSERT INTO document_citation (citation_id, document_id, first_offset) VALUES (?, ?, ?)",
    );
    const insertAgendaRevision = database.prepare("INSERT INTO agenda_revision (document_id, revision) VALUES (?, ?)");
    const insertVector = database.prepare(
      "INSERT OR IGNORE INTO passage_vector (text_hash, model_id, vector) VALUES (?, ?, ?)",
    );
    database.exec("BEGIN IMMEDIATE");
    try {
      if (replacing) {
        // Each statement reads its result as BigInt: deleting from the contentless FTS5 table leaves the connection's
        // last rowid beyond what a JavaScript number holds, which `run` would refuse to convert for the next statement.
        const deleteFor = (sql: string): void => {
          const statement = database.prepare(sql);
          statement.setReadBigInts(true);
          statement.run(document.id);
        };
        deleteFor("DELETE FROM passage_fts WHERE rowid IN (SELECT id FROM passage WHERE document_id = ?)");
        deleteFor("DELETE FROM passage WHERE document_id = ?");
        deleteFor("DELETE FROM document_citation WHERE document_id = ?");
        deleteFor("DELETE FROM search_document WHERE document_id = ?");
        deleteFor("DELETE FROM document_relation WHERE document_id = ?");
        deleteFor("DELETE FROM agenda_revision WHERE document_id = ?");
        deleteFor("DELETE FROM document WHERE id = ?");
      }
      insertDocument.run(
        document.id,
        document.nodeId,
        session,
        document.kind,
        document.label,
        document.sourceUrl,
        document.retrievedAt,
        document.contentHash,
        document.textHash,
        document.pageCount,
        document.hasTextLayer ? 1 : 0,
        document.postedAt,
        document.versionLabel ?? null,
        minorityColumn(document.isMinority),
        document.text,
      );
      for (const relation of document.relations) {
        insertRelation.run(document.id, relation.relation, relation.to, relation.meaning, relation.provenance);
      }
      insertSearchDocument.run(
        document.id,
        session,
        search.entry.nodeId,
        search.entry.kind,
        search.entry.title,
        search.entry.measureId,
        search.entry.committeeId,
        search.entry.date,
        search.entry.keywordOnly ? 1 : 0,
      );
      search.passages.forEach((passage, ordinal) => {
        const inserted = insertPassage.run(document.id, ordinal, passage.start, passage.end, passage.hash);
        insertPassageText.run(inserted.lastInsertRowid, passage.text);
      });
      for (const citation of search.citations) insertCitation.run(citation.id, document.id, citation.index);
      for (const row of search.vectors.rows) insertVector.run(row.hash, search.vectors.modelId, row.vector);
      // The vectors of a keyword-only document are not loaded, so storing one changes nothing the server holds.
      if (document.agendaRevision !== undefined) insertAgendaRevision.run(document.id, document.agendaRevision);
      if (replacing || (!search.entry.keywordOnly && search.passages.length > 0)) bumpSearchGeneration();
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    recordFullPull(session, asOf, pulled) {
      recordRows(session, asOf, pulled, "full_pull");
    },
    recordIncrement(session, asOf, pulled) {
      recordRows(session, asOf, pulled, "increment");
    },
    lastRuns(session) {
      return {
        fullPull: readFullPullAsOf(database, session),
        increment: readIncrementAsOf(database, session),
        fullPullAttempt: readFullPullAttempt(database, session),
      };
    },
    highestFloorLetterId(session) {
      const row = database
        .prepare("SELECT MAX(floor_letter_id) AS id FROM floor_letter WHERE session_key = ?")
        .get(session);
      return z.object({ id: z.number().nullable() }).parse(row).id ?? undefined;
    },
    recordFullPullAttempt(session, startedAt) {
      database
        .prepare(
          `INSERT INTO full_pull_attempt (session_key, as_of) VALUES (?, ?)
           ON CONFLICT (session_key) DO UPDATE SET as_of = excluded.as_of`,
        )
        .run(session, startedAt);
    },
    meetingDays(session) {
      return readMeetingDays(database, session);
    },
    conveneDays(session) {
      return readConveneDays(database, session);
    },
    sessionDates(session) {
      return readSessionDates(database, session);
    },
    reportedSnapshotCommit(session) {
      const row = database.prepare("SELECT commit_sha FROM snapshot_state WHERE session_key = ?").get(session);
      return row === undefined ? undefined : z.object({ commit_sha: z.string() }).parse(row).commit_sha;
    },
    recordSnapshotRead(session, snapshot, agencyParents) {
      const recordSnapshot = database.prepare(
        `INSERT INTO snapshot_state (session_key, source, commit_sha, commit_date) VALUES (?, ?, ?, ?)
         ON CONFLICT (session_key) DO UPDATE SET
           source = excluded.source, commit_sha = excluded.commit_sha, commit_date = excluded.commit_date`,
      );
      const clearAgencyParents = database.prepare("DELETE FROM agency_parent");
      const insertAgencyParent = database.prepare("INSERT INTO agency_parent (agency_id, parent_id) VALUES (?, ?)");
      database.exec("BEGIN IMMEDIATE");
      try {
        recordSnapshot.run(session, snapshot.source, snapshot.commit, snapshot.commitDate);
        clearAgencyParents.run();
        for (const { agency, parent } of agencyParents) insertAgencyParent.run(agency, parent);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    listingCounts(session) {
      const rows = database
        .prepare(
          `SELECT entity_set, SUM(listed) AS listed, COUNT(*) - SUM(listed) AS no_longer_listed
           FROM feed_row_state WHERE session_key = ? GROUP BY entity_set ORDER BY entity_set`,
        )
        .all(session);
      return rows.map((row) => {
        const stored = listingCountRow.parse(row);
        return { entitySet: stored.entity_set, listed: stored.listed, noLongerListed: stored.no_longer_listed };
      });
    },
    committeeMembers(session) {
      const rows = database
        .prepare(
          `SELECT committee_code, legislator_code FROM committee_member WHERE session_key = ?
           ORDER BY committee_code, legislator_code, row_key`,
        )
        .all(session);
      return rows.map((row) => {
        const stored = memberRow.parse(row);
        return { committeeCode: stored.committee_code, legislatorCode: stored.legislator_code };
      });
    },
    storedDocumentIds(session) {
      const rows = database.prepare("SELECT id FROM document WHERE session_key = ?").all(session);
      return new Set(rows.map((row) => idRow.parse(row).id as DocumentId));
    },
    keywordOnlyDocumentIds(session) {
      const rows = database
        .prepare("SELECT document_id AS id FROM search_document WHERE session_key = ? AND keyword_only = 1")
        .all(session);
      return new Set(rows.map((row) => idRow.parse(row).id as DocumentId));
    },
    passagesOf(document) {
      const rows = database
        .prepare(
          `SELECT p.start_offset, p.end_offset, p.text_hash, d.text
           FROM passage p JOIN document d ON d.id = p.document_id
           WHERE p.document_id = ? ORDER BY p.ordinal`,
        )
        .all(document);
      return rows.map((row) => {
        const stored = passageRow.parse(row);
        return {
          start: stored.start_offset,
          end: stored.end_offset,
          text: stored.text.slice(stored.start_offset, stored.end_offset),
          hash: stored.text_hash,
        };
      });
    },
    storeVectors(vectors) {
      const insertVector = database.prepare(
        "INSERT OR IGNORE INTO passage_vector (text_hash, model_id, vector) VALUES (?, ?, ?)",
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const row of vectors.rows) insertVector.run(row.hash, vectors.modelId, row.vector);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    storedVectorHashes(modelId, hashes) {
      const select = database.prepare("SELECT 1 AS present FROM passage_vector WHERE text_hash = ? AND model_id = ?");
      return new Set(hashes.filter((hash) => select.get(hash, modelId) !== undefined));
    },
    documentsToSample(session) {
      const rows = database
        .prepare("SELECT id, source_url, content_hash FROM document WHERE session_key = ? ORDER BY id")
        .all(session);
      return rows.map((row) => {
        const stored = sampleRow.parse(row);
        return { id: stored.id as DocumentId, sourceUrl: stored.source_url, contentHash: stored.content_hash };
      });
    },
    documentsWithoutTextLayer(session) {
      const rows = database
        .prepare("SELECT id, source_url FROM document WHERE session_key = ? AND has_text_layer = 0 ORDER BY id")
        .all(session);
      return rows.map((row) => {
        const stored = scanRow.parse(row);
        return { id: stored.id as DocumentId, sourceUrl: stored.source_url };
      });
    },
    refreshDocuments(session, links, searchEntries) {
      const updateDocument = database.prepare(
        "UPDATE document SET node_id = ?, label = ?, posted_at = ?, analysis_version_label = ?, analysis_is_minority = ? WHERE id = ? AND session_key = ?",
      );
      // Only a row that differs is written, so that a pull which changes nothing leaves the generation alone.
      const updateSearchDocument = database.prepare(
        `UPDATE search_document SET node_id = ?1, kind = ?2, title = ?3, measure_id = ?4, committee_id = ?5,
                dated_at = ?6, keyword_only = ?7
         WHERE document_id = ?8 AND session_key = ?9
           AND (node_id IS NOT ?1 OR kind IS NOT ?2 OR title IS NOT ?3 OR measure_id IS NOT ?4
                OR committee_id IS NOT ?5 OR dated_at IS NOT ?6 OR keyword_only IS NOT ?7)`,
      );
      const deleteRelations = database.prepare("DELETE FROM document_relation WHERE document_id = ?");
      const insertRelation = database.prepare(
        `INSERT INTO document_relation (document_id, relation, to_id, meaning, provenance) VALUES (?, ?, ?, ?, ?)`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const link of links) {
          const updated = updateDocument.run(
            link.nodeId,
            link.label,
            link.postedAt,
            link.versionLabel ?? null,
            minorityColumn(link.isMinority),
            link.id,
            session,
          );
          if (updated.changes === 0) continue;
          const entry = searchEntries.get(link.id);
          if (entry === undefined) throw new Error(`No search entry was made for the stored document ${link.id}`);
          const filed = updateSearchDocument.run(
            entry.nodeId,
            entry.kind,
            entry.title,
            entry.measureId,
            entry.committeeId,
            entry.date,
            entry.keywordOnly ? 1 : 0,
            link.id,
            session,
          );
          if (filed.changes > 0) bumpSearchGeneration();
          deleteRelations.run(link.id);
          for (const relation of link.relations) {
            insertRelation.run(link.id, relation.relation, relation.to, relation.meaning, relation.provenance);
          }
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    storeDocument(session, document, search) {
      writeDocument(session, document, search, false);
    },
    replaceDocument(session, document, search) {
      writeDocument(session, document, search, true);
    },
    storedAgendaRevisions(session) {
      const rows = database
        .prepare(
          "SELECT r.document_id AS id, r.revision AS revision FROM agenda_revision r JOIN document d ON d.id = r.document_id WHERE d.session_key = ?",
        )
        .all(session);
      return new Map(
        rows.map((row) => {
          const parsed = revisionRow.parse(row);
          return [parsed.id as DocumentId, parsed.revision];
        }),
      );
    },
    unreadStatuteFiles(session, snapshot) {
      const rows = database
        .prepare(
          `SELECT MIN(d.id) AS id, d.kind, d.content_hash FROM document d
           WHERE d.session_key = ? AND d.kind IN ('version', 'proposed_amendment')
             AND NOT EXISTS (SELECT 1 FROM statute_read r WHERE r.content_hash = d.content_hash AND r.parsed_as = d.kind
                               AND r.snapshot_commit = ?)
           GROUP BY d.content_hash, d.kind ORDER BY MIN(d.id)`,
        )
        .all(session, snapshot.commit);
      return rows.map((row) => {
        const unread = unreadFileRow.parse(row);
        return { documentId: unread.id as DocumentId, readAs: unread.kind, contentHash: unread.content_hash };
      });
    },
    storedText(id) {
      const row = database.prepare("SELECT text, has_text_layer FROM document WHERE id = ?").get(id);
      if (row === undefined) throw new Error(`The store holds no document ${id}`);
      const stored = storedTextRow.parse(row);
      return { text: stored.text, hasTextLayer: stored.has_text_layer === 1 };
    },
    storeStatuteParse(record, snapshot) {
      const deleteParse = database.prepare("DELETE FROM statute_parse WHERE content_hash = ? AND parsed_as = ?");
      const deleteLinks = database.prepare("DELETE FROM statute_link WHERE content_hash = ? AND parsed_as = ?");
      const insertRead = database.prepare(
        `INSERT INTO statute_read (content_hash, parsed_as, snapshot_commit) VALUES (?, ?, ?)
         ON CONFLICT (content_hash, parsed_as) DO UPDATE SET snapshot_commit = excluded.snapshot_commit`,
      );
      const insertParse = database.prepare(
        `INSERT INTO statute_parse (content_hash, parsed_as, text_read, amended_version_header,
                                    header_measure_prefix, header_measure_number, relating_clause_edits)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertLink = database.prepare(
        `INSERT INTO statute_link (content_hash, parsed_as, ordinal, kind, target_type, target_id, measure_section)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      // The Agency Links are made from these links, so every document that shares the file is unread for them again.
      const unreadAgency = database.prepare(
        "DELETE FROM agency_read WHERE document_id IN (SELECT id FROM document WHERE content_hash = ? AND kind = ?)",
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        unreadAgency.run(record.contentHash, record.readAs);
        deleteParse.run(record.contentHash, record.readAs);
        deleteLinks.run(record.contentHash, record.readAs);
        insertRead.run(record.contentHash, record.readAs, snapshot.commit);
        insertParse.run(
          record.contentHash,
          record.readAs,
          record.textRead ? 1 : 0,
          record.amendedVersionHeader?.version ?? null,
          record.amendedVersionHeader?.measure.prefix ?? null,
          record.amendedVersionHeader?.measure.number ?? null,
          JSON.stringify(record.relatingClauseEdits),
        );
        record.links.forEach((link, ordinal) => {
          insertLink.run(
            record.contentHash,
            record.readAs,
            ordinal,
            link.kind,
            link.target.type,
            link.target.id,
            link.measureSection,
          );
        });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    statutesAffectedTableHash(session) {
      const row = database
        .prepare("SELECT content_hash FROM statutes_affected_table WHERE session_key = ?")
        .get(session);
      return row === undefined ? undefined : tableHashRow.parse(row).content_hash;
    },
    measuresListingVersion(session, description) {
      const rows = database
        .prepare("SELECT DISTINCT measure_id FROM version_listing WHERE session_key = ? AND label = ?")
        .all(session, description);
      return new Set(rows.map((row) => measureIdRow.parse(row).measure_id as MeasureId));
    },
    storeStatutesAffectedTable(session, record) {
      const insertEntry = database.prepare(
        `INSERT INTO statutes_affected_entry (session_key, ordinal, prefix, number, level, action, target_type,
                                              target_id, measure_section, emergency, lone_e)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        database
          .prepare(
            `INSERT INTO statutes_affected_table (session_key, source_url, retrieved_at, content_hash, page_count, text)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (session_key) DO UPDATE SET
               source_url = excluded.source_url, retrieved_at = excluded.retrieved_at,
               content_hash = excluded.content_hash, page_count = excluded.page_count, text = excluded.text`,
          )
          .run(session, record.sourceUrl, record.retrievedAt, record.contentHash, record.pageCount, record.text);
        database.prepare("DELETE FROM statutes_affected_entry WHERE session_key = ?").run(session);
        database.prepare("DELETE FROM statutes_affected_refusal WHERE session_key = ?").run(session);
        record.entries.forEach((entry, ordinal) => {
          insertEntry.run(
            session,
            ordinal,
            entry.measure.prefix,
            entry.measure.number,
            entry.level,
            entry.action,
            entry.target.type,
            entry.target.id,
            entry.measureSection,
            entry.emergency ? 1 : 0,
            entry.loneE ? 1 : 0,
          );
        });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    unreadAgencyDocuments(session, snapshot) {
      const rows = database
        .prepare(
          `SELECT d.id, d.kind FROM document d
           WHERE d.session_key = ?
             AND (d.kind IN ('version', 'proposed_amendment') OR (d.kind = 'analysis' AND d.label = 'Fiscal Impact Statement'))
             AND NOT EXISTS (SELECT 1 FROM agency_read r WHERE r.document_id = d.id AND r.snapshot_commit = ?)
           ORDER BY d.id`,
        )
        .all(session, snapshot.commit);
      return rows.map((row): UnreadAgencyDocument => {
        const unread = unreadAgencyRow.parse(row);
        return {
          documentId: unread.id as DocumentId,
          readAs: unread.kind === "analysis" ? "fiscal_impact_statement" : unread.kind,
        };
      });
    },
    statuteLinksOf(document) {
      const rows = database
        .prepare(
          `SELECT l.kind, l.target_type, l.target_id, l.measure_section
           FROM document d JOIN statute_link l ON l.content_hash = d.content_hash AND l.parsed_as = d.kind
           WHERE d.id = ? ORDER BY l.ordinal`,
        )
        .all(document);
      return rows.map((row) => statuteLinkOfRow(statuteLinkRow.parse(row)));
    },
    storeAgencyRead(record, snapshot) {
      const insertRead = database.prepare(
        `INSERT INTO agency_read (document_id, snapshot_commit) VALUES (?, ?)
         ON CONFLICT (document_id) DO UPDATE SET snapshot_commit = excluded.snapshot_commit`,
      );
      const deleteLinks = database.prepare("DELETE FROM agency_link WHERE document_id = ?");
      const deleteUnits = database.prepare("DELETE FROM unresolved_unit WHERE document_id = ?");
      const insertLink = database.prepare(
        "INSERT INTO agency_link (document_id, ordinal, agency_id, kind, evidence) VALUES (?, ?, ?, ?, ?)",
      );
      const insertUnit = database.prepare("INSERT INTO unresolved_unit (document_id, ordinal, unit) VALUES (?, ?, ?)");
      database.exec("BEGIN IMMEDIATE");
      try {
        deleteLinks.run(record.documentId);
        deleteUnits.run(record.documentId);
        insertRead.run(record.documentId, snapshot.commit);
        record.links.forEach((link, ordinal) => {
          insertLink.run(record.documentId, ordinal, link.agency, link.evidence.kind, evidenceToJson(link.evidence));
        });
        record.unresolvedUnits.forEach((unit, ordinal) => {
          insertUnit.run(record.documentId, ordinal, unit);
        });
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    refusedStatutesAffectedTable(session) {
      const row = database
        .prepare("SELECT content_hash, reason FROM statutes_affected_refusal WHERE session_key = ?")
        .get(session);
      if (row === undefined) return undefined;
      const stored = refusalRow.parse(row);
      return { contentHash: stored.content_hash, reason: stored.reason };
    },
    refuseStatutesAffectedTable(session, refusal) {
      database
        .prepare(
          `INSERT INTO statutes_affected_refusal (session_key, content_hash, reason) VALUES (?, ?, ?)
           ON CONFLICT (session_key) DO UPDATE SET content_hash = excluded.content_hash, reason = excluded.reason`,
        )
        .run(session, refusal.contentHash, refusal.reason);
    },
    close() {
      database.close();
    },
  };
}
