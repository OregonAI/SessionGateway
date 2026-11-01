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
import { readFloorVoteRows } from "./lib/floor-votes.ts";
import { readHistoryActionRows } from "./lib/history.ts";
import { readLegislatorRows } from "./lib/legislators.ts";
import { readMeasureLive, type MeasureLiveRead } from "./lib/live.ts";
import { readMeasureRows } from "./lib/measures.ts";
import { readAgendaItems, readCommittees, readMeetings } from "./lib/meetings.ts";
import type { OlisClientOptions, SetCount } from "./lib/options.ts";
import { readConvenings, readSessionDates } from "./lib/schedule.ts";
import { readSponsorshipRows } from "./lib/sponsors.ts";

export type { Download, OlisClientOptions, MeasureLiveRead, SetCount };

export type OlisClient = {
  /** Every Measure of the Session, as the feed lists them. */
  readMeasures(session: SessionKey, signal: AbortSignal): Promise<Measure[]>;
  /** Every Legislators row of the Session: the people the feed names, one row per Legislator Code. */
  readLegislators(session: SessionKey, signal: AbortSignal): Promise<LegislatorRow[]>;
  /** Every MeasureSponsors row of the Session, in the feed's order. */
  readSponsorships(session: SessionKey, signal: AbortSignal): Promise<Sponsorship[]>;
  /** Every MeasureHistoryActions row of the Session, in the feed's order. */
  readHistoryActions(session: SessionKey, signal: AbortSignal): Promise<HistoryAction[]>;
  /** Every CommitteeVotes row of the Session: one entry for each member in each committee vote, in the feed's order. */
  readCommitteeVotes(session: SessionKey, signal: AbortSignal): Promise<CommitteeVoteEntry[]>;
  /** Every MeasureVotes row of the Session: one entry for each Legislator in each floor vote, in the feed's order. */
  readFloorVotes(session: SessionKey, signal: AbortSignal): Promise<FloorVoteEntry[]>;
  /**
   * What OLIS says now about one Measure (the live lookup, ticket #21): only that Measure's rows, one
   * request for each of five kinds of row. It reads no other Measure and never pulls a whole set. `readAt`
   * is the time of the read: the schedule is the meetings at or after it.
   */
  readMeasureLive(key: MeasureKey, readAt: Date, signal: AbortSignal): Promise<MeasureLiveRead>;
  /** Every committee of the Session. */
  readCommittees(session: SessionKey, signal: AbortSignal): Promise<Committee[]>;
  /** Every committee meeting of the Session, each with its agenda document when the feed links one. */
  readMeetings(session: SessionKey, signal: AbortSignal): Promise<Meeting[]>;
  /** Every agenda item of every committee meeting of the Session. */
  readAgendaItems(session: SessionKey, signal: AbortSignal): Promise<AgendaItem[]>;
  /**
   * Every CommitteeMembers row of the Session, one entry for each row. The set's declared key is not unique, so
   * each entry's `key` is the whole row, and no two rows are taken for one (olis-odata.md section 8, gotcha 5).
   */
  readCommitteeMembers(session: SessionKey, signal: AbortSignal): Promise<CommitteeMember[]>;
  /** Every ConveneTimes row of the Session: the floor convenings, each day of which is a day the Session meets (ticket #67). */
  readConvenings(session: SessionKey, signal: AbortSignal): Promise<Convening[]>;
  /** The Session's own LegislativeSessions row (its begin and end dates), or undefined when the feed has none (ticket #67). */
  readSessionDates(session: SessionKey, signal: AbortSignal): Promise<SessionDates | undefined>;
  /** Every document the feed links for the Session, apart from agendas (a meeting's), not yet fetched. */
  readDocumentLinks(session: SessionKey, signal: AbortSignal): Promise<DocumentLink[]>;
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
    readMeasures: (session, signal) => readMeasureRows(options, session, signal),
    readLegislators: (session, signal) => readLegislatorRows(options, session, signal),
    readSponsorships: (session, signal) => readSponsorshipRows(options, session, signal),
    readHistoryActions: (session, signal) => readHistoryActionRows(options, session, signal),
    readCommitteeVotes: (session, signal) => readCommitteeVoteRows(options, session, signal),
    readFloorVotes: (session, signal) => readFloorVoteRows(options, session, signal),
    readMeasureLive: (key, readAt, signal) => readMeasureLive(options, key, readAt, signal),
    readCommittees: (session, signal) => readCommittees(options, session, signal),
    readMeetings: (session, signal) => readMeetings(options, session, signal),
    readAgendaItems: (session, signal) => readAgendaItems(options, session, signal),
    readCommitteeMembers: (session, signal) => readCommitteeMembers(options, session, signal),
    readConvenings: (session, signal) => readConvenings(options, session, signal),
    readSessionDates: (session, signal) => readSessionDates(options, session, signal),
    readDocumentLinks: (session, signal) => readDocumentLinks(options, session, signal),
    downloadDocument: (link, signal) => downloadDocument(options, link, signal),
    downloadStoredDocument: (sourceUrl, signal) => downloadStoredDocument(options, sourceUrl, signal),
    downloadFile: (url, signal) => downloadFile(options, url, signal),
  };
}
