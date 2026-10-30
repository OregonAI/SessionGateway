// The ingest worker. A full pull reads every Measure, Legislator, sponsor, history and vote row of the
// deployment's Session from OLIS and stores them, with the time the pull started as the index's "as of"
// time. It resolves the Legislator Code of each sponsor and each vote to a Legislator on the way and
// reports the codes it could not.
import type { IngestConfig } from "#/packages/config/index.ts";
import {
  openIndexWriter,
  type CommitteeVoteRecord,
  type FloorVoteRecord,
  type SponsorRecord,
} from "#/packages/database/writer.ts";
import type { LegislatorId, Sponsorship } from "#/packages/domain/legislators.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";
import type { LegislatorAlias } from "#/packages/legislators/aliases.ts";
import {
  createLegislatorResolver,
  type LegislatorResolver,
  type Resolution,
  type UnresolvedLegislatorCode,
} from "#/packages/legislators/resolver.ts";
import { createOlisClient } from "#/packages/olis-client/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";

export type IngestDeps = {
  fetch: typeof fetch;
  clock: Clock;
  /** Aborts the pull on shutdown. */
  signal: AbortSignal;
  /** The alias file's entries: who the Legislator Codes it lists are, where the Legislators rows do not say. */
  legislatorAliases: readonly LegislatorAlias[];
};

export type FullPullResult = {
  measures: number;
  asOf: Timestamp;
  /**
   * The build report of Legislator Codes (spec #1, story 54): every code the pull could not resolve,
   * with how often each entity set used it. Empty when every code resolved.
   */
  unresolvedLegislatorCodes: UnresolvedLegislatorCode[];
};

/** The id of the Legislator a code resolved to, or null while it is unresolved. */
function legislatorIdOfResolution(resolution: Resolution): LegislatorId | null {
  switch (resolution.kind) {
    case "resolved":
      return resolution.legislator.id;
    case "unresolved":
      return null;
    default:
      return resolution satisfies never;
  }
}

/** What the database keeps of one MeasureSponsors row. A Member row names a Legislator by a code the resolver reads. */
function sponsorRecordOf(sponsorship: Sponsorship, resolver: LegislatorResolver): SponsorRecord {
  const common = {
    id: sponsorship.id,
    measure: sponsorship.measure,
    level: sponsorship.level,
    printOrder: sponsorship.printOrder,
  };
  switch (sponsorship.kind) {
    case "member":
      return {
        ...common,
        kind: "member",
        legislatorCode: sponsorship.legislatorCode,
        legislatorId: legislatorIdOfResolution(resolver.resolve("MeasureSponsors", sponsorship.legislatorCode)),
      };
    case "committee":
      return { ...common, kind: "committee", committeeCode: sponsorship.committeeCode };
    case "presession":
      return { ...common, kind: "presession", message: sponsorship.message };
    default:
      return sponsorship satisfies never;
  }
}

/** What the database keeps of one entry of a floor vote: the entry and the Legislator its code names. */
function floorVoteRecordOf(entry: FloorVoteEntry, resolver: LegislatorResolver): FloorVoteRecord {
  return { ...entry, legislatorId: legislatorIdOfResolution(resolver.resolve("MeasureVotes", entry.legislatorCode)) };
}

/** What the database keeps of one entry of a committee vote: the entry and the Legislator its code names. */
function committeeVoteRecordOf(entry: CommitteeVoteEntry, resolver: LegislatorResolver): CommitteeVoteRecord {
  return { ...entry, legislatorId: legislatorIdOfResolution(resolver.resolve("CommitteeVotes", entry.legislatorCode)) };
}

export async function runFullPull(config: IngestConfig, deps: IngestDeps): Promise<FullPullResult> {
  const asOf = formatPacific(deps.clock.now());
  const olis = createOlisClient({ baseUrl: config.olisBaseUrl, fetch: deps.fetch });
  const measures = await olis.readMeasures(config.session, deps.signal);
  const legislatorRows = await olis.readLegislators(config.session, deps.signal);
  const sponsorships = await olis.readSponsorships(config.session, deps.signal);
  const history = await olis.readHistoryActions(config.session, deps.signal);
  const committeeVotes = await olis.readCommitteeVotes(config.session, deps.signal);
  const floorVotes = await olis.readFloorVotes(config.session, deps.signal);

  // A Member sponsor and the voter of a vote entry each name a Legislator by a Legislator Code; the
  // resolver says who that is.
  const resolver = createLegislatorResolver({
    session: config.session,
    rows: legislatorRows,
    aliases: deps.legislatorAliases,
  });
  const sponsors = sponsorships.map((sponsorship) => sponsorRecordOf(sponsorship, resolver));
  const floorVoteRecords = floorVotes.map((entry) => floorVoteRecordOf(entry, resolver));
  const committeeVoteRecords = committeeVotes.map((entry) => committeeVoteRecordOf(entry, resolver));

  const writer = openIndexWriter(config.databasePath);
  try {
    writer.recordFullPull(config.session, asOf, {
      measures,
      history,
      legislators: resolver.people,
      sponsors,
      floorVotes: floorVoteRecords,
      committeeVotes: committeeVoteRecords,
    });
  } finally {
    writer.close();
  }
  return { measures: measures.length, asOf, unresolvedLegislatorCodes: resolver.unresolved() };
}
