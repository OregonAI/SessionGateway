// The whole system for one seam-1 test: a fake OLIS at a simulated time, the ingest worker's full
// pull into a database in a disposable directory, and the MCP handler reading that database. It
// wires the production packages through their entry points, the way src/bin/ does.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
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
import { runIngestLoop } from "#/packages/ingest/loop.ts";
import { committedAliasFilePath, readLegislatorAliases } from "#/packages/legislators/aliases.ts";
import { createSessionGatewayHandler, type SessionGatewayHandler } from "#/packages/mcp-server/handler.ts";
import { createSimulatedClock, type SimulatedClock } from "./clock.ts";
import { createFakeEmbedder } from "./fake-embedder.ts";
import { startFakeOlis, type FakeOlis, type FakeOlisOptions } from "./fake-olis.ts";
import { snapshotFixturePath } from "./oregonai-snapshot.ts";
import { modelPath } from "./real-embedder.ts";
import { templateCacheVariable } from "./template-cache.ts";
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
  /** The worker's rhythms (the INGEST_INCREMENTS and INGEST_FULL_PULL variables): unset, as a deployment leaves them. */
  ingest?: { increments?: string; fullPull?: string };
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
  /**
   * Runs the worker's loop (`runIngestLoop`) from the clock's time now until the clock reaches `until`, an ISO-8601
   * instant. The loop's sleep is the harness's: it moves the simulated clock by the time it was asked to wait, so a
   * test runs a day of the worker's schedule at once and no timer runs. A run that fails throws out of this call.
   */
  runSchedule(until: string): Promise<void>;
  stop(): Promise<void>;
};

/**
 * A system built once, its database kept as a template (ticket #47). `start` gives a case a system of its own: a fresh
 * fake OLIS at the same clock, and a full copy of the template's database files in a directory of its own, so no case
 * can change another's data. A case that only reads takes the copy as it is; a case that changes state changes the
 * fake or the clock and runs `pullAgain`, which then fetches and embeds only what the change adds.
 */
export type SystemTemplate = {
  /**
   * Starts a system on a copy of the template's database. A case may add `serverEnv`, and give `snapshot`, the path of
   * a copy of the snapshot the template was built with that the case then changes (the database holds no path).
   */
  start(extra?: { serverEnv?: Record<string, string>; snapshot?: string }): Promise<System>;
};

/** Where the templates of one test run are kept for every file to share: made by the global setup, removed at its end. */
const cacheVariable = templateCacheVariable;

/**
 * The name of the database a system's options build, or undefined when they build one that is not worth keeping. It
 * hashes everything that decides what the full pull writes (the clock, the Session, the documents, the rows the fake
 * adds, the snapshot's bytes, the table's address, the alias file) and leaves out what only the server reads
 * (`serverEnv`). A test that gives its own embedder gets no key: an embedder is code, not data.
 */
function templateKey(options: SystemOptions): string | undefined {
  if (options.embedder !== undefined) return undefined;
  const origin = "http://olis.invalid:1";
  const description = {
    clockAt: options.clockAt,
    sessionKey: options.sessionKey,
    snapshot: createHash("sha256")
      .update(readFileSync(options.snapshot ?? snapshotFixturePath))
      .digest("hex"),
    documents: options.documents,
    olis: options.olis,
    statutesAffectedTableUrl: options.statutesAffectedTableUrl?.(origin),
    documentTimeoutMs: options.documentTimeoutMs,
    olisBaseUrl: options.olisBaseUrl?.(`${origin}/`),
    legislatorAliasesPath:
      options.legislatorAliasesPath === undefined
        ? undefined
        : createHash("sha256").update(readFileSync(options.legislatorAliasesPath)).digest("hex"),
  };
  return createHash("sha256").update(JSON.stringify(description)).digest("hex").slice(0, 32);
}

/**
 * Runs `startSystem(options)` once, checkpoints the WAL into the database file, and keeps the files in a directory
 * of their own (the test run's cache when there is one, so that every file asking for the same options shares it).
 * The template is the state the full pull leaves, so use it only for cases whose subject is not the pull itself
 * (test/CLAUDE.md, "Database").
 */
async function buildDirectory(options: SystemOptions, key: string | undefined): Promise<string> {
  const cache = process.env[cacheVariable];
  const target = cache === undefined || key === undefined ? undefined : join(cache, key);
  if (target !== undefined && existsSync(target)) return target;
  const first = await startSystem(options);
  const directory = mkdtempSync(join(cache ?? tmpdir(), "session-gateway-template-"));
  try {
    const source = new DatabaseSync(first.database.path, { timeout: 5000 });
    try {
      // The pragma reports a checkpoint that another connection blocked as a row, not as an error: the copy leaves out
      // the WAL, so a page left in it would go missing from every copy.
      const row = source.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (row?.["busy"] !== 0 || row["log"] !== row["checkpointed"]) {
        throw new Error(`The template's WAL was not fully checkpointed: ${JSON.stringify(row)}`);
      }
    } finally {
      source.close();
    }
    // After the checkpoint the database file holds everything, so the WAL and its shared-memory file are left out.
    cpSync(dirname(first.database.path), directory, {
      recursive: true,
      filter: (path) => !path.endsWith("-wal") && !path.endsWith("-shm"),
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await first.stop();
  }
  if (target === undefined) {
    // A directory of this process alone: nothing else removes it.
    process.once("exit", () => {
      rmSync(directory, { recursive: true, force: true });
    });
    return directory;
  }
  try {
    renameSync(directory, target);
  } catch (error) {
    // Another file's worker built the same database first and its rename won: use that one. Any other failure is real.
    const code = (error as NodeJS.ErrnoException).code;
    rmSync(directory, { recursive: true, force: true });
    if (code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
  }
  return target;
}

const built = new Map<string, Promise<string>>();

/**
 * A template that is built when the first case asks for a system, and only then: a file whose cases all pull for
 * themselves never pays for it. The database is built once for every file of the run that gives the same options.
 */
export function systemTemplate(options: SystemOptions): SystemTemplate {
  const key = templateKey(options);
  const directory = (): Promise<string> => {
    if (key === undefined) return buildDirectory(options, key);
    const known = built.get(key);
    if (known !== undefined) return known;
    const made = buildDirectory(options, key);
    built.set(key, made);
    return made;
  };
  return {
    start: async (extra = {}) =>
      startSystem(
        {
          ...options,
          serverEnv: { ...options.serverEnv, ...extra.serverEnv },
          ...(extra.snapshot === undefined ? {} : { snapshot: extra.snapshot }),
        },
        await directory(),
      ),
  };
}

/**
 * `startSystem` for a case that only reads, or that changes state after the pull: the system is a copy of the template
 * for these options, built the first time any file of the run asks for them.
 */
export function startCopiedSystem(options: SystemOptions): Promise<System> {
  return systemTemplate(options).start();
}

/** Starts the fake OLIS, runs the ingest worker's full pull and starts the server's handler. */
export async function startSystem(options: SystemOptions, copyOf?: string): Promise<System> {
  assertNotPacific();
  const clock = createSimulatedClock(options.clockAt);
  const olis = await startFakeOlis({ clock, documents: options.documents ?? false, ...options.olis });
  const database = createTempDatabase();
  if (copyOf !== undefined) cpSync(copyOf, dirname(database.path), { recursive: true });
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
    ...(options.ingest?.increments === undefined ? {} : { INGEST_INCREMENTS: options.ingest.increments }),
    ...(options.ingest?.fullPull === undefined ? {} : { INGEST_FULL_PULL: options.ingest.fullPull }),
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
  const schedule = async (until: string): Promise<void> => {
    const stop = new AbortController();
    const end = new Date(until).getTime();
    const failures: unknown[] = [];
    await runIngestLoop(loadIngestConfig(env), {
      ...workerDeps(embedder),
      signal: stop.signal,
      sleep: (milliseconds) => {
        clock.advance(milliseconds);
        if (clock.now().getTime() >= end) stop.abort();
        return Promise.resolve();
      },
      onRunFailed: (_run, error) => {
        failures.push(error);
      },
    });
    if (failures.length > 0) throw new Error("A run of the worker's loop failed", { cause: failures[0] });
  };
  const increment = (): Promise<IncrementResult> => runIncrement(loadIngestConfig(env), workerDeps(embedder));
  try {
    if (copyOf === undefined) await pull();
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
      runSchedule: schedule,
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
