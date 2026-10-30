// The OLIS client: the only code that sees the feed's own shapes (src/CLAUDE.md, "Shape"). It reads
// the OData v3 feed and hands everything else domain types named as GLOSSARY.md names them.
import type { HistoryAction, Measure, SessionKey } from "#/packages/domain/index.ts";
import type { LegislatorRow, Sponsorship } from "#/packages/domain/legislators.ts";
import type { CommitteeVoteEntry } from "#/packages/domain/votes.ts";
import { readCommitteeVoteRows } from "./lib/committee-votes.ts";
import { readHistoryActionRows } from "./lib/history.ts";
import { readLegislatorRows } from "./lib/legislators.ts";
import { readMeasureRows } from "./lib/measures.ts";
import type { OlisClientOptions } from "./lib/options.ts";
import { readSponsorshipRows } from "./lib/sponsors.ts";

export type { OlisClientOptions };

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
};

export function createOlisClient(options: OlisClientOptions): OlisClient {
  return {
    readMeasures: (session, signal) => readMeasureRows(options, session, signal),
    readLegislators: (session, signal) => readLegislatorRows(options, session, signal),
    readSponsorships: (session, signal) => readSponsorshipRows(options, session, signal),
    readHistoryActions: (session, signal) => readHistoryActionRows(options, session, signal),
    readCommitteeVotes: (session, signal) => readCommitteeVoteRows(options, session, signal),
  };
}
