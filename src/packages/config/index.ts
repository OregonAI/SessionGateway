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
};

const sessionKey = z.string().transform((text, context) => {
  const parsed = parseSessionKey(text);
  if (parsed === undefined) {
    context.addIssue({ code: "custom", message: "must be an OLIS Session key such as 2025R1" });
    return z.NEVER;
  }
  return parsed;
});

const ingestSchema = z.object({
  SESSION_KEY: sessionKey,
  OLIS_BASE_URL: z.url(),
  DATABASE_PATH: z.string().min(1),
});

const serverSchema = z.object({
  SESSION_KEY: sessionKey,
  DATABASE_PATH: z.string().min(1),
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
  return { session: parsed.SESSION_KEY, databasePath: parsed.DATABASE_PATH };
}
