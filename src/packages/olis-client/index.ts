// The OLIS client: the only code that sees the feed's own shapes (src/CLAUDE.md, "Shape"). It reads
// the OData v3 feed and hands everything else domain types named as GLOSSARY.md names them.
import type { HistoryAction, Measure, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type {
  AgendaItem,
  Committee,
  CommitteeMember,
  Convening,
  DocumentLink,
  Meeting,
  SessionDates,
} from "#/packages/domain/documents.ts";
import type { LegislatorRow, Sponsorship } from "#/packages/domain/legislators.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";
import { readCommitteeMembers } from "./lib/committee-members.ts";
import { readCommitteeVoteRows } from "./lib/committee-votes.ts";
import {
  downloadDocument,
  downloadFile,
  downloadStoredDocument,
  readDocumentLinks,
  type Download,
} from "./lib/documents.ts";
import { readFloorLetters } from "./lib/floor-letters.ts";
import { readFloorVoteRows } from "./lib/floor-votes.ts";
import { readHistoryActionRows } from "./lib/history.ts";
import { readLegislatorRows } from "./lib/legislators.ts";
import { readMeasureLive, type MeasureLiveRead } from "./lib/live.ts";
import { readMeasureRows } from "./lib/measures.ts";
import { readAgendaItems, readCommittees, readMeetings } from "./lib/meetings.ts";
import type { OlisClientOptions, PullRead, SetCount } from "./lib/options.ts";
import { readConvenings, readSessionDates } from "./lib/schedule.ts";
import { readSponsorshipRows } from "./lib/sponsors.ts";

export type { Download, OlisClientOptions, MeasureLiveRead, PullRead, SetCount };

/**
 * The client has a reader for each entity set a Pull reads, and each takes the `PullRead` the caller wants on every call:
 * the whole set, the rows changed since a time, or the rows above an id. Which sets a Pull reads and how is the caller's
 * to say (the ingest worker's register); the client keeps no rule about sets. A reader refuses a mode its set cannot be
 * read by (the rows of a set with no dates are not read "changed since"), which is a bug in the caller and throws.
 */
export type OlisClient = {
  /** The Measures of the Session, as the feed lists them. */
  readMeasures(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<Measure[]>;
  /** The Legislators rows of the Session: the people the feed names, one row per Legislator Code. */
  readLegislators(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<LegislatorRow[]>;
  /** The MeasureSponsors rows of the Session, in the feed's order. */
  readSponsorships(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<Sponsorship[]>;
  /** The MeasureHistoryActions rows of the Session, in the feed's order. */
  readHistoryActions(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<HistoryAction[]>;
  /** The CommitteeVotes rows of the Session: one entry for each member in each committee vote, in the feed's order. */
  readCommitteeVotes(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<CommitteeVoteEntry[]>;
  /** The MeasureVotes rows of the Session: one entry for each Legislator in each floor vote, in the feed's order. */
  readFloorVotes(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<FloorVoteEntry[]>;
  /**
   * What OLIS says now about one Measure (the live lookup, ticket #21): only that Measure's rows, one
   * request for each of five kinds of row. It reads no other Measure and never pulls a whole set. `readAt`
   * is the time of the read: the schedule is the meetings at or after it.
   */
  readMeasureLive(key: MeasureKey, readAt: Date, signal: AbortSignal): Promise<MeasureLiveRead>;
  /** The committees of the Session. */
  readCommittees(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<Committee[]>;
  /** The committee meetings of the Session, each with its agenda document when the feed links one. */
  readMeetings(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<Meeting[]>;
  /** The agenda items of the committee meetings of the Session. */
  readAgendaItems(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<AgendaItem[]>;
  /**
   * The CommitteeMembers rows of the Session, one entry for each row. The set's declared key is not unique, so
   * each entry's `key` is the whole row, and no two rows are taken for one (olis-odata.md section 8, gotcha 5).
   */
  readCommitteeMembers(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<CommitteeMember[]>;
  /** The ConveneTimes rows of the Session: the floor convenings, each day of which is a day the Session meets (ticket #67). */
  readConvenings(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<Convening[]>;
  /** The Session's own LegislativeSessions row (its begin and end dates), or undefined when the feed has none (ticket #67). */
  readSessionDates(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<SessionDates | undefined>;
  /**
   * The Session's Floor Letters (ticket #64, ADR-0045), each a document link that carries its row. The set has no dates, so
   * it is read `whole` (counted with `$count`) or `above_id` (only the letters whose `FloorLetterId` is greater); a
   * `changed_since` read throws.
   */
  readFloorLetters(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<DocumentLink[]>;
  /** The documents the feed links for the Session, apart from agendas (a meeting's) and Floor Letters, not yet fetched. */
  readDocumentLinks(session: SessionKey, read: PullRead, signal: AbortSignal): Promise<DocumentLink[]>;
  /** Fetches one document from OLIS. */
  downloadDocument(link: DocumentLink, signal: AbortSignal): Promise<Download>;
  /** `downloadDocument` for a document the store holds, which is known by its `source_url` alone (the hash sample, ticket #20). */
  downloadStoredDocument(sourceUrl: string, signal: AbortSignal): Promise<Download>;
  /**
   * Fetches a file by its address, with the retries a document gets: the Statutes Affected Table, which Legislative
   * Counsel publishes on its own site and the deployment names. A file that is not there is a failed download with status 404.
   */
  downloadFile(url: URL, signal: AbortSignal): Promise<Download>;
};

export function createOlisClient(options: OlisClientOptions): OlisClient {
  return {
    readMeasures: (session, read, signal) => readMeasureRows(options, session, read, signal),
    readLegislators: (session, read, signal) => readLegislatorRows(options, session, read, signal),
    readSponsorships: (session, read, signal) => readSponsorshipRows(options, session, read, signal),
    readHistoryActions: (session, read, signal) => readHistoryActionRows(options, session, read, signal),
    readCommitteeVotes: (session, read, signal) => readCommitteeVoteRows(options, session, read, signal),
    readFloorVotes: (session, read, signal) => readFloorVoteRows(options, session, read, signal),
    readMeasureLive: (key, readAt, signal) => readMeasureLive(options, key, readAt, signal),
    readCommittees: (session, read, signal) => readCommittees(options, session, read, signal),
    readMeetings: (session, read, signal) => readMeetings(options, session, read, signal),
    readAgendaItems: (session, read, signal) => readAgendaItems(options, session, read, signal),
    readCommitteeMembers: (session, read, signal) => readCommitteeMembers(options, session, read, signal),
    readConvenings: (session, read, signal) => readConvenings(options, session, read, signal),
    readSessionDates: (session, read, signal) => readSessionDates(options, session, read, signal),
    readDocumentLinks: (session, read, signal) => readDocumentLinks(options, session, read, signal),
    readFloorLetters: (session, read, signal) => readFloorLetters(options, session, read, signal),
    downloadDocument: (link, signal) => downloadDocument(options, link, signal),
    downloadStoredDocument: (sourceUrl, signal) => downloadStoredDocument(options, sourceUrl, signal),
    downloadFile: (url, signal) => downloadFile(options, url, signal),
  };
}
