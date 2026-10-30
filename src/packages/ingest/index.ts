// The ingest worker. A full pull reads every Measure of the deployment's Session from OLIS and
// stores it, with the time the pull started as the index's "as of" time.
import type { IngestConfig } from "#/packages/config/index.ts";
import { openIndexWriter, type SponsorRecord } from "#/packages/database/writer.ts";
import { createLegislatorResolver } from "#/packages/legislators/resolver.ts";
import { createOlisClient } from "#/packages/olis-client/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";

export type IngestDeps = {
  fetch: typeof fetch;
  clock: Clock;
  /** Aborts the pull on shutdown. */
  signal: AbortSignal;
};

export type FullPullResult = {
  measures: number;
  asOf: Timestamp;
};

export async function runFullPull(config: IngestConfig, deps: IngestDeps): Promise<FullPullResult> {
  const asOf = formatPacific(deps.clock.now());
  const olis = createOlisClient({ baseUrl: config.olisBaseUrl, fetch: deps.fetch });
  const measures = await olis.readMeasures(config.session, deps.signal);
  const legislatorRows = await olis.readLegislators(config.session, deps.signal);
  const sponsorships = await olis.readSponsorships(config.session, deps.signal);

  // A Member sponsor names a Legislator by a Legislator Code; the resolver says who that is.
  const resolver = createLegislatorResolver({ session: config.session, rows: legislatorRows });
  const sponsors: SponsorRecord[] = [];
  for (const sponsorship of sponsorships) {
    if (sponsorship.kind !== "member") continue;
    const resolution = resolver.resolve(sponsorship.legislatorCode);
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
  return { measures: measures.length, asOf };
}
