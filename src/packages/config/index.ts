// Configuration: everything a deployment varies is an environment variable, read once at startup
// through a zod schema (src/CLAUDE.md, "Configuration and portability"). A bad variable fails fast,
// and the message names the variable but never its value.
import { z } from "zod";
import { parseSessionKey, type SessionKey } from "#/packages/domain/index.ts";

export type Environment = Record<string, string | undefined>;

/** How often the worker reads what OLIS changed between full pulls (ADR-0039). */
export const incrementSettings = ["off", "daily", "15min"] as const;
export type IncrementsSetting = (typeof incrementSettings)[number];

/** How often the worker reads the whole Session again (ADR-0039). Under `weekly` and `monthly` the value names the day too. */
export const fullPullSettings = ["nightly", "weekly", "monthly"] as const;
export type FullPullSetting = (typeof fullPullSettings)[number];

export type IngestConfig = {
  /** The increments' rhythm: INGEST_INCREMENTS, `daily` unless set. */
  increments: IncrementsSetting;
  /** The full pull's rhythm: INGEST_FULL_PULL, `weekly` unless set. */
  fullPull: FullPullSetting;
  /** How many stored documents the nightly hash sample fetches again: INGEST_HASH_SAMPLE_SIZE, 200 unless set (ADR-0040). */
  hashSampleSize: number;
  /** The one Session this deployment serves (ADR-0003). */
  session: SessionKey;
  olisBaseUrl: string;
  /** The origin documents are fetched from: OLIS's own, unless a test points the worker elsewhere. */
  olisDocumentOrigin: string;
  databasePath: string;
  /** The OregonAI snapshot file the worker copies into the build (scripts/snapshot/build.ts writes it). */
  snapshotPath: string;
  /** The directory that holds the pinned embedding model's files (`npm run model:fetch`). */
  modelPath: string;
  /** How many threads one run of the embedding model may use. */
  modelThreads: number;
  /**
   * Where Legislative Counsel publishes the Statutes Affected Table of the Session (`artables{session}.pdf`), or null
   * when the deployment does not load it. The worker fetches it in each full pull (ADR-0034).
   */
  statutesAffectedTableUrl: string | null;
  /**
   * The folder of machine-transcript files (`<eventId>.transcript.json`, which OregonAI/hearing-transcripts writes) the worker
   * ingests, or null when the deployment has none (ticket #134, ADR-0055). The worker ingests whatever the publication gate says.
   */
  transcriptsPath: string | null;
};

export type ServerConfig = {
  /** The worker's rhythms, which the server reads to say when the index is too old (ADR-0039). */
  increments: IncrementsSetting;
  fullPull: FullPullSetting;
  session: SessionKey;
  /** The OLIS service root, with a trailing slash: where the live lookup reads one Measure at request time. */
  olisBaseUrl: string;
  /** How long one live lookup may take, all its requests together, before the cache answers instead. */
  olisLiveTimeoutMs: number;
  databasePath: string;
  /** The directory that holds the pinned embedding model's files, which embeds each question. */
  modelPath: string;
  /** Where the MCP endpoint is mounted, such as /session-gateway/mcp. */
  mcpPath: string;
  host: string;
  port: number;
  /** Host names (without ports) a request may be addressed to; any other Host header is refused. */
  allowedHosts: string[];
  /** Origin host names a browser request may come from. A request with an Origin not listed is refused. */
  allowedOrigins: string[];
  /** Most tool calls the server answers in one window, over every caller together. */
  rateLimit: number;
  /** The length of that window, in seconds. */
  rateWindowSeconds: number;
  /**
   * The publication gate for machine transcripts (ticket #134, ADR-0055): TRANSCRIPTS_PUBLISHED, `false` unless it is the text
   * `true`. While it is false no tool's answer holds any transcript text. The owner turns it on.
   */
  transcriptsPublished: boolean;
};

const sessionKey = z.string().transform((text, context) => {
  const parsed = parseSessionKey(text);
  if (parsed === undefined) {
    context.addIssue({ code: "custom", message: "must be an OLIS Session key such as 2025R1" });
    return z.NEVER;
  }
  return parsed;
});

/**
 * The OLIS client resolves each entity set against the base URL, which drops the last path segment
 * of a base that does not end in a slash. docs/research/olis-odata.md writes the service root without
 * one, so the slash is added here, at the edge, whichever way the operator writes it.
 */
const serviceRoot = z.url().transform((text) => {
  const url = new URL(text);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
});

// The two rhythms of the ingest worker (ADR-0039). The server reads them too, because "too old" depends on them. The
// message names the variable (zod's issue path) and the values it accepts, never the value it was given.
const incrementsSetting = z
  .enum(incrementSettings, { error: `must be one of ${incrementSettings.join(", ")}` })
  .default("daily");
const fullPullSetting = z
  .enum(fullPullSettings, { error: `must be one of ${fullPullSettings.join(", ")}` })
  .default("weekly");

const ingestSchema = z.object({
  INGEST_INCREMENTS: incrementsSetting,
  INGEST_FULL_PULL: fullPullSetting,
  // About 200 documents a night, as ADR-0005 says. Only the worker samples, so only its schema reads this.
  INGEST_HASH_SAMPLE_SIZE: z
    .string()
    .regex(/^\d+$/, "must be a whole number")
    .transform(Number)
    .pipe(z.number().min(1, "must be at least 1"))
    .default(200),
  SESSION_KEY: sessionKey,
  OLIS_BASE_URL: serviceRoot,
  // Documents are on olis.oregonlegislature.gov, not on the feed's host. Only a test sets this.
  OLIS_DOCUMENT_ORIGIN: z
    .url()
    .default("https://olis.oregonlegislature.gov")
    .transform((text) => new URL(text).origin),
  DATABASE_PATH: z.string().min(1),
  SNAPSHOT_PATH: z.string().min(1),
  MODEL_PATH: z.string().min(1),
  // The Statutes Affected Table is Legislative Counsel's, not OLIS's: a different host (www.oregonlegislature.gov), a path
  // that holds the Session key, and a file that does not exist until the Session has ended. A deployment that does not name
  // it loads nothing (ADR-0034).
  STATUTES_AFFECTED_TABLE_URL: z
    .url({ protocol: /^https?$/ })
    .transform((text) => new URL(text).href)
    .optional(),
  // Where the transcript files are (OregonAI/hearing-transcripts writes them, ADR-0051, ADR-0054). Unset, the worker ingests none.
  TRANSCRIPTS_PATH: z.string().min(1).optional(),
  // One thread by default: the worker on the deploy box shares two cores with seven corpora (ADR-0007).
  // The backfill on the GPU desktop sets more.
  MODEL_THREADS: z
    .string()
    .regex(/^\d+$/, "must be a whole number")
    .transform(Number)
    .pipe(z.number().min(1, "must be at least 1").max(64, "must be at most 64"))
    .default(1),
});

const list = (text: string): string[] =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

const positiveWholeNumber = z
  .string()
  .regex(/^\d+$/, "must be a whole number")
  .transform(Number)
  .pipe(z.number().min(1, "must be at least 1"));

/**
 * The longest a live lookup may be told to take: 30 seconds, half the 60 seconds an MCP client waits for a
 * tool result by default (`DEFAULT_REQUEST_TIMEOUT_MSEC` in @modelcontextprotocol/client), so that the
 * cache's answer still reaches a client when OLIS never replies. It is also far below 2^31 - 1 ms, past
 * which Node counts a timer as 1 ms and every lookup would fail at once.
 */
const MAX_LIVE_TIMEOUT_MS = 30_000;

const serverSchema = z.object({
  INGEST_INCREMENTS: incrementsSetting,
  INGEST_FULL_PULL: fullPullSetting,
  SESSION_KEY: sessionKey,
  // The server needs OLIS for the live status of get_measure (ticket #21): a deployment without it would
  // answer every call from the cache and say the lookup failed, so a missing variable stops the start-up.
  OLIS_BASE_URL: serviceRoot,
  // get_measure's live lookup gives up after this long and answers from the cache, so the tool still
  // answers promptly when OLIS is slow. 5 seconds: a lookup for one Measure is a few small requests.
  // A value over MAX_LIVE_TIMEOUT_MS is refused at start-up, not clamped, so no deployment waits for days.
  OLIS_LIVE_TIMEOUT_MS: z
    .string()
    .regex(/^\d+$/, "must be a whole number")
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, "must be at least 1")
        .max(MAX_LIVE_TIMEOUT_MS, `must be at most ${String(MAX_LIVE_TIMEOUT_MS)} (milliseconds)`),
    )
    .default(5000),
  DATABASE_PATH: z.string().min(1),
  MODEL_PATH: z.string().min(1),
  MCP_PATH: z
    .string()
    .regex(/^\/\S*$/, "must start with /")
    .default("/mcp"),
  MCP_HOST: z.string().min(1).default("127.0.0.1"),
  MCP_PORT: z
    .string()
    .regex(/^\d+$/, "must be a whole number")
    .transform(Number)
    .pipe(z.number().max(65535, "must be at most 65535"))
    .default(3000),
  MCP_ALLOWED_HOSTS: z.string().transform(list).default(["localhost", "127.0.0.1", "[::1]"]),
  MCP_ALLOWED_ORIGINS: z.string().transform(list).default([]),
  // The MCP specification requires servers to rate-limit tool calls (src/CLAUDE.md, "MCP"), so a limit
  // is on by default: 120 calls a minute over every caller together.
  MCP_RATE_LIMIT: positiveWholeNumber.default(120),
  MCP_RATE_WINDOW_SECONDS: positiveWholeNumber.default(60),
  // The publication gate (ADR-0055): the text `true` or `false`, and anything else stops the start-up, because a gate that reads
  // "yes" or "TRUE" as off, or as on, is a decision the owner did not make. It is false when unset.
  TRANSCRIPTS_PUBLISHED: z
    .enum(["true", "false"], { error: "must be true or false" })
    .default("false")
    .transform((text) => text === "true"),
});

function parseEnvironment<Schema extends z.ZodType>(schema: Schema, env: Environment): z.output<Schema> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Bad configuration: ${problems.join("; ")}`);
}

export function loadIngestConfig(env: Environment): IngestConfig {
  const parsed = parseEnvironment(ingestSchema, env);
  return {
    increments: parsed.INGEST_INCREMENTS,
    fullPull: parsed.INGEST_FULL_PULL,
    hashSampleSize: parsed.INGEST_HASH_SAMPLE_SIZE,
    session: parsed.SESSION_KEY,
    olisBaseUrl: parsed.OLIS_BASE_URL,
    olisDocumentOrigin: parsed.OLIS_DOCUMENT_ORIGIN,
    databasePath: parsed.DATABASE_PATH,
    snapshotPath: parsed.SNAPSHOT_PATH,
    modelPath: parsed.MODEL_PATH,
    modelThreads: parsed.MODEL_THREADS,
    statutesAffectedTableUrl: parsed.STATUTES_AFFECTED_TABLE_URL ?? null,
    transcriptsPath: parsed.TRANSCRIPTS_PATH ?? null,
  };
}

export function loadServerConfig(env: Environment): ServerConfig {
  const parsed = parseEnvironment(serverSchema, env);
  return {
    increments: parsed.INGEST_INCREMENTS,
    fullPull: parsed.INGEST_FULL_PULL,
    session: parsed.SESSION_KEY,
    olisBaseUrl: parsed.OLIS_BASE_URL,
    olisLiveTimeoutMs: parsed.OLIS_LIVE_TIMEOUT_MS,
    databasePath: parsed.DATABASE_PATH,
    modelPath: parsed.MODEL_PATH,
    mcpPath: parsed.MCP_PATH,
    host: parsed.MCP_HOST,
    port: parsed.MCP_PORT,
    allowedHosts: parsed.MCP_ALLOWED_HOSTS,
    allowedOrigins: parsed.MCP_ALLOWED_ORIGINS,
    rateLimit: parsed.MCP_RATE_LIMIT,
    rateWindowSeconds: parsed.MCP_RATE_WINDOW_SECONDS,
    transcriptsPublished: parsed.TRANSCRIPTS_PUBLISHED,
  };
}
