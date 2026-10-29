export interface Config {
  dbPath: string;
  port: number;
  host: string;
  token: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dbPath: env.SESSION_DB || "data/session.db",
    port: Number(env.PORT || 8080),
    host: env.HOST || "0.0.0.0",
    token: env.MCP_TOKEN || undefined,
  };
}
