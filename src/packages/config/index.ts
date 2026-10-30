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
  databasePath: string;
  /** Where the MCP endpoint is mounted, such as /session-gateway/mcp. */
  mcpPath: string;
  host: string;
  port: number;
  /** Host names (without ports) a request may be addressed to; any other Host header is refused. */
  allowedHosts: string[];
  /** Origin host names a browser request may come from. A request with an Origin not listed is refused. */
  allowedOrigins: string[];
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

const serverSchema = z.object({
  SESSION_KEY: sessionKey,
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
    databasePath: parsed.DATABASE_PATH,
    mcpPath: parsed.MCP_PATH,
    host: parsed.MCP_HOST,
    port: parsed.MCP_PORT,
    allowedHosts: parsed.MCP_ALLOWED_HOSTS,
    allowedOrigins: parsed.MCP_ALLOWED_ORIGINS,
  };
}
