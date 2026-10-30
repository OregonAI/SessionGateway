// Configuration: everything a deployment varies is an environment variable, read once at startup
// through a zod schema (src/CLAUDE.md, "Configuration and portability"). A bad variable fails fast,
// and the message names the variable but never its value.
import { z } from "zod";
import { parseSessionKey, type SessionKey } from "#/packages/domain/index.ts";

export type Environment = Record<string, string | undefined>;

export type IngestConfig = {
  /** The one Session this deployment serves (ADR-0003). */
  session: SessionKey;
  olisBaseUrl: string;
  databasePath: string;
};

export type ServerConfig = {
  session: SessionKey;
  /** The OLIS service root, with a trailing slash: where the live lookup reads one Measure at request time. */
  olisBaseUrl: string;
  /** How long one live lookup may take, all its requests together, before the cache answers instead. */
  olisLiveTimeoutMs: number;
  databasePath: string;
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

const ingestSchema = z.object({
  SESSION_KEY: sessionKey,
  OLIS_BASE_URL: serviceRoot,
  DATABASE_PATH: z.string().min(1),
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
});

function parseEnvironment<Schema extends z.ZodType>(schema: Schema, env: Environment): z.output<Schema> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Bad configuration: ${problems.join("; ")}`);
}

export function loadIngestConfig(env: Environment): IngestConfig {
  const parsed = parseEnvironment(ingestSchema, env);
  return { session: parsed.SESSION_KEY, olisBaseUrl: parsed.OLIS_BASE_URL, databasePath: parsed.DATABASE_PATH };
}

export function loadServerConfig(env: Environment): ServerConfig {
  const parsed = parseEnvironment(serverSchema, env);
  return {
    session: parsed.SESSION_KEY,
    olisBaseUrl: parsed.OLIS_BASE_URL,
    olisLiveTimeoutMs: parsed.OLIS_LIVE_TIMEOUT_MS,
    databasePath: parsed.DATABASE_PATH,
    mcpPath: parsed.MCP_PATH,
    host: parsed.MCP_HOST,
    port: parsed.MCP_PORT,
    allowedHosts: parsed.MCP_ALLOWED_HOSTS,
    allowedOrigins: parsed.MCP_ALLOWED_ORIGINS,
    rateLimit: parsed.MCP_RATE_LIMIT,
    rateWindowSeconds: parsed.MCP_RATE_WINDOW_SECONDS,
  };
}
