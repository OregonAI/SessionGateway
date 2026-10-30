// The ingest worker's entry script: one full pull of the deployment's Session into the database.
// Everything it needs comes from the environment (src/packages/config) and is created here, once,
// and passed down: the configuration, `fetch`, the clock, the pause between attempts and the shutdown signal.
import { setTimeout as sleep } from "node:timers/promises";
import { loadIngestConfig } from "#/packages/config/index.ts";
import { runFullPull } from "#/packages/ingest/index.ts";
import { systemClock } from "#/packages/time/clock.ts";

const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown.abort();
  });
}

const config = loadIngestConfig(process.env);
await runFullPull(config, {
  fetch,
  clock: systemClock,
  signal: shutdown.signal,
  pause: (milliseconds, signal) => sleep(milliseconds, undefined, { signal }),
});
