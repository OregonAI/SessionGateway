// The MCP server's entry script: serves the database the ingest worker writes, read-only, over
// stateless Streamable HTTP. Everything it needs comes from the environment (src/packages/config)
// and is created here, once, and passed down: the configuration, the clock and the logger's callback.
import { pino } from "pino";
import { loadServerConfig } from "#/packages/config/index.ts";
import { createSessionGatewayHandler } from "#/packages/mcp-server/handler.ts";
import { serveMcp } from "#/packages/mcp-server/http.ts";
import { systemClock } from "#/packages/time/clock.ts";

// Logs are JSON lines on stdout, so the deployment decides where they go (src/CLAUDE.md, "Configuration
// and portability"). pino's `err` key writes an Error's type, message and stack as fields of the line.
const logger = pino();

const config = loadServerConfig(process.env);
const handler = createSessionGatewayHandler(config, { clock: systemClock });
const server = await serveMcp(handler, config, {
  onError: (error) => {
    logger.error({ err: error }, "The MCP adapter reported an error");
  },
});
logger.info({ host: config.host, port: server.port, path: config.mcpPath }, "MCP server listening");

// On SIGINT or SIGTERM stop accepting requests, then release the database, and let the process end.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server
      .close()
      .then(() => handler.close())
      .catch((error: unknown) => {
        logger.error({ err: error }, "The MCP server did not shut down cleanly");
        process.exitCode = 1;
      });
  });
}
