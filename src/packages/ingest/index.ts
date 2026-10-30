// The ingest worker. A full pull reads every Measure, Legislator and sponsor row of the deployment's
// Session from OLIS and stores them, with the time the pull started as the index's "as of" time. It
// resolves each sponsor's Legislator Code to a Legislator on the way and reports the codes it could not.
import type { IngestConfig } from "#/packages/config/index.ts";
import { openIndexWriter, type SponsorRecord } from "#/packages/database/writer.ts";
import type { LegislatorAlias } from "#/packages/legislators/aliases.ts";
import { createLegislatorResolver, type UnresolvedLegislatorCode } from "#/packages/legislators/resolver.ts";
import { createOlisClient } from "#/packages/olis-client/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";

export type IngestDeps = {
  fetch: typeof fetch;
  clock: Clock;
  /** Aborts the pull on shutdown. */
  signal: AbortSignal;
  /** The alias file's entries: who the Legislator Codes without a Legislators row are. */
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

export async function runFullPull(config: IngestConfig, deps: IngestDeps): Promise<FullPullResult> {
  const asOf = formatPacific(deps.clock.now());
  const olis = createOlisClient({ baseUrl: config.olisBaseUrl, fetch: deps.fetch });
  const measures = await olis.readMeasures(config.session, deps.signal);
  const legislatorRows = await olis.readLegislators(config.session, deps.signal);
  const sponsorships = await olis.readSponsorships(config.session, deps.signal);

  // A Member sponsor names a Legislator by a Legislator Code; the resolver says who that is.
  const resolver = createLegislatorResolver({
    session: config.session,
    rows: legislatorRows,
    aliases: deps.legislatorAliases,
  });
  const sponsors: SponsorRecord[] = [];
  for (const sponsorship of sponsorships) {
    if (sponsorship.kind !== "member") continue;
    const resolution = resolver.resolve("MeasureSponsors", sponsorship.legislatorCode);
    sponsors.push({
      id: sponsorship.id,
      measure: sponsorship.measure,
      level: sponsorship.level,
      printOrder: sponsorship.printOrder,
      legislatorCode: sponsorship.legislatorCode,
      legislatorId: resolution.kind === "resolved" ? resolution.legislator.id : null,
    });
  }

  const writer = openIndexWriter(config.databasePath);
  try {
    writer.recordFullPull(config.session, measures, asOf, { legislators: resolver.people, sponsors });
  } finally {
    writer.close();
  }
  return { measures: measures.length, asOf, unresolvedLegislatorCodes: resolver.unresolved() };
}
