// The whole system for one seam-1 test: a fake OLIS at a simulated time, the ingest worker's full
// pull into a database in a disposable directory, and the MCP handler reading that database. It
// wires the production packages through their entry points, the way src/bin/ does.
import { loadIngestConfig, loadServerConfig, type ServerConfig } from "#/packages/config/index.ts";
import { runFullPull, type FullPullResult } from "#/packages/ingest/index.ts";
import { committedAliasFilePath, readLegislatorAliases } from "#/packages/legislators/aliases.ts";
import { createSessionGatewayHandler, type SessionGatewayHandler } from "#/packages/mcp-server/handler.ts";
import { createSimulatedClock, type SimulatedClock } from "./clock.ts";
import { startFakeOlis, type FakeOlis, type FakeOlisOptions } from "./fake-olis.ts";
import { createTempDatabase, type TempDatabase } from "./temp-database.ts";

/** Seam 1 runs under a zone other than Pacific, so code that relies on local time fails (test/CLAUDE.md). */
function assertNotPacific(): void {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === "America/Los_Angeles") {
    throw new Error(
      "The tests must run under a time zone other than Pacific: vitest.config.ts sets TZ for the workers",
    );
  }
}

export type SystemOptions = {
  /** An ISO-8601 instant with an offset: the simulated time of the fake OLIS, the worker and the server. */
  clockAt: string;
  /** The deployment's Session (the SESSION_KEY variable). */
  sessionKey?: string;
  olis?: Omit<FakeOlisOptions, "clock">;
  /**
   * Rewrites the fake OLIS's service root, ending in a slash, into the OLIS_BASE_URL the worker is
   * given. For writing the root the way docs/research/olis-odata.md does, without the slash.
   */
  olisBaseUrl?: (serviceRoot: string) => string;
  /** Further environment variables for the server's configuration (MCP_PATH, MCP_PORT, ...). */
  serverEnv?: Record<string, string>;
  /** The alias file the worker reads, as the entry script would pass it. The committed one by default. */
  legislatorAliasesPath?: string;
};

export type System = {
  clock: SimulatedClock;
  olis: FakeOlis;
  database: TempDatabase;
  /** The server's configuration, as the entry script would load it. */
  serverConfig: ServerConfig;
  /** The MCP handler, serving the database the full pull wrote. */
  handler: SessionGatewayHandler;
  /** Runs the worker's full pull again, at the clock's time now, into the same database. */
  pullAgain(): Promise<FullPullResult>;
  stop(): Promise<void>;
};

/** Starts the fake OLIS, runs the ingest worker's full pull and starts the server's handler. */
export async function startSystem(options: SystemOptions): Promise<System> {
  assertNotPacific();
  const clock = createSimulatedClock(options.clockAt);
  const olis = await startFakeOlis({ clock, ...options.olis });
  const database = createTempDatabase();
  const shutdown = new AbortController();
  const env = {
    SESSION_KEY: options.sessionKey ?? "2025R1",
    OLIS_BASE_URL: options.olisBaseUrl === undefined ? olis.baseUrl : options.olisBaseUrl(olis.baseUrl),
    DATABASE_PATH: database.path,
  };
  const pull = (): Promise<FullPullResult> =>
    runFullPull(loadIngestConfig(env), {
      fetch,
      clock,
      signal: AbortSignal.timeout(30_000),
      legislatorAliases: readLegislatorAliases(options.legislatorAliasesPath ?? committedAliasFilePath),
    });
  try {
    await pull();
    const serverConfig = loadServerConfig({ ...env, ...options.serverEnv });
    const handler = createSessionGatewayHandler(serverConfig, {
      clock,
      fetch,
      signal: shutdown.signal,
      onLiveLookupFailed: () => {},
    });
    return {
      clock,
      olis,
      database,
      serverConfig,
      handler,
      pullAgain: pull,
      stop: async () => {
        shutdown.abort();
        await handler.close();
        await olis.close();
        database.remove();
      },
    };
  } catch (error) {
    await olis.close();
    database.remove();
    throw error;
  }
}
