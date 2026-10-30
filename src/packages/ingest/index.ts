// The ingest worker. A full pull reads every Measure of the deployment's Session from OLIS and
// stores it, with the time the pull started as the index's "as of" time.
import type { IngestConfig } from "#/packages/config/index.ts";
import { openIndexWriter } from "#/packages/database/writer.ts";
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
  const writer = openIndexWriter(config.databasePath);
  try {
    writer.recordFullPull(config.session, measures, asOf);
  } finally {
    writer.close();
  }
  return { measures: measures.length, asOf };
}
