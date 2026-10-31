// The whole system for one seam-1 test: a fake OLIS at a simulated time, the ingest worker's full
// pull into a database in a disposable directory, and the MCP handler reading that database. It
// wires the production packages through their entry points, the way src/bin/ does.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadIngestConfig, loadServerConfig, type ServerConfig } from "#/packages/config/index.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import {
  runFullPull,
  runIncrement,
  type FullPullResult,
  type IncrementResult,
  type IngestDeps,
} from "#/packages/ingest/index.ts";
import { committedAliasFilePath, readLegislatorAliases } from "#/packages/legislators/aliases.ts";
import { createSessionGatewayHandler, type SessionGatewayHandler } from "#/packages/mcp-server/handler.ts";
import { createSimulatedClock, type SimulatedClock } from "./clock.ts";
import { createFakeEmbedder } from "./fake-embedder.ts";
import { startFakeOlis, type FakeOlis, type FakeOlisOptions } from "./fake-olis.ts";
import { snapshotFixturePath } from "./oregonai-snapshot.ts";
import { modelPath } from "./real-embedder.ts";
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
   * The path of the OregonAI snapshot file the worker builds with (the SNAPSHOT_PATH variable): the
   * committed fixture unless a test gives another.
   */
  snapshot?: string;
  /**
   * Whether the fake OLIS serves the rows that link documents, and the documents. Off by default:
   * pulling the fixture's 278 documents takes seconds, and a test of `get_measure` reads none.
   */
  documents?: boolean;
  olis?: Omit<FakeOlisOptions, "clock" | "documents">;
  /**
   * The Statutes Affected Table's URL for the worker (the STATUTES_AFFECTED_TABLE_URL variable), made from the fake
   * OLIS's origin: `tableUrlOn` (test/support/statutes-affected-table.ts) points it at the fixture's table. Unset by
   * default, as a deployment that does not load the table leaves it.
   */
  statutesAffectedTableUrl?: (olisOrigin: string) => string;
  /** How long the worker waits for one attempt to fetch a document; a test that makes one hang sets it short. */
  documentTimeoutMs?: number;
  /**
   * Rewrites the fake OLIS's service root, ending in a slash, into the OLIS_BASE_URL the worker is
   * given. For writing the root the way docs/research/olis-odata.md does, without the slash.
   */
  olisBaseUrl?: (serviceRoot: string) => string;
  /**
   * The embedder the worker and the server share, as the entry scripts would make one. A fake by default
   * (test/support/fake-embedder.ts): a test of how well search ranks passes the real one
   * (`loadRealEmbedder()`, test/support/real-embedder.ts).
   */
  embedder?: Embedder;
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
  /**
   * The build report the worker wrote beside the database at the end of its last full pull
   * (`build-report.json`): what an operator reads to chase scans and failed fetches.
   */
  buildReport(): Record<string, unknown>;
  /**
   * Runs the worker's full pull again, at the clock's time now, into the same database. `embedder` stands in for the
   * system's own for this pull, to make a pull fail part-way.
   */
  pullAgain(options?: { embedder?: Embedder }): Promise<FullPullResult>;
  /**
   * Runs the worker's increment at the clock's time now, into the same database: what a test calls after it moves
   * the clock (and adds rows to the fake) to see what the next increment brings.
   */
  incrementAgain(): Promise<IncrementResult>;
  stop(): Promise<void>;
};

/** Starts the fake OLIS, runs the ingest worker's full pull and starts the server's handler. */
export async function startSystem(options: SystemOptions): Promise<System> {
  assertNotPacific();
  const clock = createSimulatedClock(options.clockAt);
  const olis = await startFakeOlis({ clock, documents: options.documents ?? false, ...options.olis });
  const database = createTempDatabase();
  const embedder = options.embedder ?? (await createFakeEmbedder());
  const shutdown = new AbortController();
  const env = {
    SESSION_KEY: options.sessionKey ?? "2025R1",
    OLIS_BASE_URL: options.olisBaseUrl === undefined ? olis.baseUrl : options.olisBaseUrl(olis.baseUrl),
    DATABASE_PATH: database.path,
    OLIS_DOCUMENT_ORIGIN: olis.origin,
    SNAPSHOT_PATH: options.snapshot ?? snapshotFixturePath,
    // The entry scripts load the model from here. The harness is given its embedder, so nothing reads it.
    MODEL_PATH: modelPath(),
    ...(options.statutesAffectedTableUrl === undefined
      ? {}
      : { STATUTES_AFFECTED_TABLE_URL: options.statutesAffectedTableUrl(olis.origin) }),
  };
  const workerDeps = (workerEmbedder: Embedder): IngestDeps => ({
    fetch,
    clock,
    signal: AbortSignal.timeout(30_000),
    // The worker does not wait between attempts to fetch a document: a test reads how many there were.
    pause: () => Promise.resolve(),
    ...(options.documentTimeoutMs === undefined ? {} : { documentTimeoutMs: options.documentTimeoutMs }),
    legislatorAliases: readLegislatorAliases(options.legislatorAliasesPath ?? committedAliasFilePath),
    embedder: workerEmbedder,
  });
  const pull = (pullOptions: { embedder?: Embedder } = {}): Promise<FullPullResult> =>
    runFullPull(loadIngestConfig(env), workerDeps(pullOptions.embedder ?? embedder));
  const increment = (): Promise<IncrementResult> => runIncrement(loadIngestConfig(env), workerDeps(embedder));
  try {
    await pull();
    const serverConfig = loadServerConfig({ ...env, ...options.serverEnv });
    const handler = createSessionGatewayHandler(serverConfig, {
      clock,
      fetch,
      signal: shutdown.signal,
      onLiveLookupFailed: () => {},
      embedder,
    });
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
      incrementAgain: increment,
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
