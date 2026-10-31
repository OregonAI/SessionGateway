// The ingest worker's entry script. Everything it needs comes from the environment (src/packages/config) and is created
// here, once, and passed down: the configuration, `fetch`, the clock, the sleep and the pause between attempts, the
// alias file's entries, the embedding model and the shutdown signal.
//
// With no argument it runs the schedule (ticket #17, ADR-0039): the loop wakes every quarter hour, asks the schedule
// what is due and runs the full pull or the increment, until it is told to stop. With `--once` it runs one full pull
// now and exits: how an operator makes the first pull, and the pull to make by hand.
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pino } from "pino";
import { loadIngestConfig } from "#/packages/config/index.ts";
import { modelLockPath } from "#/packages/embedder/lock.ts";
import { loadOnnxEmbedder } from "#/packages/embedder/onnx.ts";
import { runFullPull, type FullPullResult, type IngestDeps } from "#/packages/ingest/index.ts";
import { runIngestLoop } from "#/packages/ingest/loop.ts";
import { committedAliasFilePath, readLegislatorAliases } from "#/packages/legislators/aliases.ts";
import { systemClock } from "#/packages/time/clock.ts";

// Logs are JSON lines on stdout (src/CLAUDE.md, "Configuration and portability"); `err` writes an Error as fields.
const logger = pino();

const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown.abort();
  });
}

const config = loadIngestConfig(process.env);
const deps: IngestDeps = {
  fetch,
  clock: systemClock,
  signal: shutdown.signal,
  pause: (milliseconds, signal) => sleep(milliseconds, undefined, { signal }),
  legislatorAliases: readLegislatorAliases(committedAliasFilePath),
  embedder: await loadOnnxEmbedder({
    modelPath: config.modelPath,
    lockPath: modelLockPath,
    intraOpThreads: config.modelThreads,
  }),
};

// The build report of Legislator Codes (spec #1, story 54), beside the database it describes. It is
// written after every pull, empty or not, so an empty list shows the check ran and found nothing.
async function writeUnresolvedCodesReport(pull: FullPullResult): Promise<void> {
  const reportPath = join(dirname(config.databasePath), "unresolved-legislator-codes.json");
  const report = {
    session: config.session,
    as_of: pull.asOf,
    unresolved_legislator_codes: pull.unresolvedLegislatorCodes,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv.includes("--once")) {
  await writeUnresolvedCodesReport(await runFullPull(config, deps));
} else {
  await runIngestLoop(config, {
    ...deps,
    // The sleep ends early on shutdown, and the loop then ends: a signal is not an error.
    sleep: (milliseconds, signal) => sleep(milliseconds, undefined, { signal }).catch(() => undefined),
    onRunFailed: (run, error) => {
      logger.error({ run, err: error }, `The ${run} failed; the index goes on answering from the last good run`);
    },
    afterFullPull: writeUnresolvedCodesReport,
  });
}
