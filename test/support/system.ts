// The whole system for one seam-1 test: a fake OLIS at a simulated time, the ingest worker's full
// pull into a database in a disposable directory, and the MCP handler reading that database. It
// wires the production packages through their entry points, the way src/bin/ does.
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadIngestConfig, loadServerConfig, type ServerConfig } from "#/packages/config/index.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import { runFullPull, type FullPullResult } from "#/packages/ingest/index.ts";
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
  stop(): Promise<void>;
};

/**
 * A system built once, its database kept as a template (ticket #47). `start` gives a case a system of its own: a fresh
 * fake OLIS at the same clock, and a full copy of the template's database files in a directory of its own, so no case
 * can change another's data. A case that only reads takes the copy as it is; a case that changes state changes the
 * fake or the clock and runs `pullAgain`, which then fetches and embeds only what the change adds.
 */
export type SystemTemplate = {
  /** Starts a system on a copy of the template's database. `serverEnv` is the one option a case may add. */
  start(extra?: { serverEnv?: Record<string, string> }): Promise<System>;
  /** Removes the template's files. Call it once, after the last case. */
  remove(): Promise<void>;
};

/**
 * Runs `startSystem(options)` once, checkpoints the WAL into the database file, and keeps the files. The template is the
 * state the full pull leaves, so use it only for cases whose subject is not the pull itself (test/CLAUDE.md, "Database").
 */
export async function buildSystemTemplate(options: SystemOptions): Promise<SystemTemplate> {
  const first = await startSystem(options);
  const directory = mkdtempSync(join(tmpdir(), "session-gateway-template-"));
  try {
    const source = new DatabaseSync(first.database.path, { timeout: 5000 });
    try {
      source.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      source.close();
    }
    // After the checkpoint the database file holds everything, so the WAL and its shared-memory file are left out.
    cpSync(dirname(first.database.path), directory, {
      recursive: true,
      filter: (path) => !path.endsWith("-wal") && !path.endsWith("-shm"),
    });
    await first.stop();
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    start: (extra = {}) =>
      startSystem({ ...options, serverEnv: { ...options.serverEnv, ...extra.serverEnv } }, directory),
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
      return Promise.resolve();
    },
  };
}

/**
 * A template that is built when the first case asks for a system, and only then: a file whose cases all pull for
 * themselves never pays for it. Concurrent first asks share one build, and so do describes that give the same `key`
 * (the same options, as the two clients of `describe.for(eras)` have). The test file calls `remove` in `afterAll`.
 */
export function lazySystemTemplate(options: SystemOptions, key?: string): SystemTemplate {
  const known = key === undefined ? undefined : shared.get(key);
  if (known !== undefined) {
    known.holders += 1;
    return known.template;
  }
  let built: Promise<SystemTemplate> | undefined;
  const template: SystemTemplate = {
    start: async (extra) => {
      built ??= buildSystemTemplate(options);
      return (await built).start(extra);
    },
    remove: async () => {
      // A template with a key goes when the last describe that asked for it is done.
      const entry = key === undefined ? undefined : shared.get(key);
      if (entry !== undefined && (entry.holders -= 1) > 0) return;
      await (await built)?.remove();
    },
  };
  if (key !== undefined) shared.set(key, { template, holders: 1 });
  return template;
}

/** The templates a file shares between its describes, by the key the file gives (a file's module is its own). */
const shared = new Map<string, { template: SystemTemplate; holders: number }>();

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
    ...(options.statutesAffectedTableUrl === undefined
      ? {}
      : { STATUTES_AFFECTED_TABLE_URL: options.statutesAffectedTableUrl(olis.origin) }),
  };
  const pull = (pullOptions: { embedder?: Embedder } = {}): Promise<FullPullResult> =>
    runFullPull(loadIngestConfig(env), {
      fetch,
      clock,
      signal: AbortSignal.timeout(30_000),
      // The worker does not wait between attempts to fetch a document: a test reads how many there were.
      pause: () => Promise.resolve(),
      ...(options.documentTimeoutMs === undefined ? {} : { documentTimeoutMs: options.documentTimeoutMs }),
      legislatorAliases: readLegislatorAliases(options.legislatorAliasesPath ?? committedAliasFilePath),
      embedder: pullOptions.embedder ?? embedder,
    });
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
