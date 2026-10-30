// The whole system for one seam-1 test: a fake OLIS at a simulated time, the ingest worker's full
// pull into a database in a disposable directory, and the MCP handler reading that database. It
// wires the production packages through their entry points, the way src/bin/ does.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadIngestConfig, loadServerConfig, type ServerConfig } from "#/packages/config/index.ts";
import { runFullPull, type FullPullResult } from "#/packages/ingest/index.ts";
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
  /**
   * Whether the fake OLIS serves the rows that link documents, and the documents. Off by default:
   * pulling the fixture's 278 documents takes seconds, and a test of `get_measure` reads none.
   */
  documents?: boolean;
  olis?: Omit<FakeOlisOptions, "clock" | "documents">;
  /** How long the worker waits for one attempt to fetch a document; a test that makes one hang sets it short. */
  documentTimeoutMs?: number;
  /**
   * Rewrites the fake OLIS's service root, ending in a slash, into the OLIS_BASE_URL the worker is
   * given. For writing the root the way docs/research/olis-odata.md does, without the slash.
   */
  olisBaseUrl?: (serviceRoot: string) => string;
  /** Further environment variables for the server's configuration (MCP_PATH, MCP_PORT, ...). */
  serverEnv?: Record<string, string>;
};

export type System = {
  clock: SimulatedClock;
  olis: FakeOlis;
  database: TempDatabase;
  /** The server's configuration, as the entry script would load it. */
  serverConfig: ServerConfig;
  /** The MCP handler, serving the database the full pull wrote. */
  handler: SessionGatewayHandler;
  /**
   * The build report the worker wrote beside the database at the end of its last full pull
   * (`build-report.json`): what an operator reads to chase scans and failed fetches.
   */
  buildReport(): Record<string, unknown>;
  /** Runs the worker's full pull again, at the clock's time now, into the same database. */
  pullAgain(): Promise<FullPullResult>;
  stop(): Promise<void>;
};

/** Starts the fake OLIS, runs the ingest worker's full pull and starts the server's handler. */
export async function startSystem(options: SystemOptions): Promise<System> {
  assertNotPacific();
  const clock = createSimulatedClock(options.clockAt);
  const olis = await startFakeOlis({ clock, documents: options.documents ?? false, ...options.olis });
  const database = createTempDatabase();
  const env = {
    SESSION_KEY: options.sessionKey ?? "2025R1",
    OLIS_BASE_URL: options.olisBaseUrl === undefined ? olis.baseUrl : options.olisBaseUrl(olis.baseUrl),
    DATABASE_PATH: database.path,
    OLIS_DOCUMENT_ORIGIN: olis.origin,
  };
  const pull = (): Promise<FullPullResult> =>
    runFullPull(loadIngestConfig(env), {
      fetch,
      clock,
      signal: AbortSignal.timeout(30_000),
      // The worker does not wait between attempts to fetch a document: a test reads how many there were.
      pause: () => Promise.resolve(),
      ...(options.documentTimeoutMs === undefined ? {} : { documentTimeoutMs: options.documentTimeoutMs }),
    });
  try {
    await pull();
    const serverConfig = loadServerConfig({ ...env, ...options.serverEnv });
    const handler = createSessionGatewayHandler(serverConfig, { clock });
    return {
      clock,
      olis,
      database,
      serverConfig,
      handler,
      buildReport: () => {
        const report: unknown = JSON.parse(readFileSync(join(dirname(database.path), "build-report.json"), "utf8"));
        if (typeof report !== "object" || report === null || Array.isArray(report)) {
          throw new Error("The build report is not a JSON object");
        }
        return report as Record<string, unknown>;
      },
      pullAgain: pull,
      stop: async () => {
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
