// The ingest worker's entry script: one full pull of the deployment's Session into the database.
// Everything it needs comes from the environment (src/packages/config) and is created here, once,
// and passed down: the configuration, `fetch`, the clock and the shutdown signal.
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadIngestConfig } from "#/packages/config/index.ts";
import { runFullPull } from "#/packages/ingest/index.ts";
import { readLegislatorAliases } from "#/packages/legislators/aliases.ts";
import { systemClock } from "#/packages/time/clock.ts";

const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown.abort();
  });
}

const config = loadIngestConfig(process.env);
const pull = await runFullPull(config, {
  fetch,
  clock: systemClock,
  signal: shutdown.signal,
  legislatorAliases: readLegislatorAliases(),
});

// The build report of Legislator Codes (spec #1, story 54), beside the database it describes. It is
// written after every pull, empty or not, so an empty list shows the check ran and found nothing.
const reportPath = join(dirname(config.databasePath), "unresolved-legislator-codes.json");
const report = {
  session: config.session,
  as_of: pull.asOf,
  unresolved_legislator_codes: pull.unresolvedLegislatorCodes,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
