// The MCP server's entry script: serves the database the ingest worker writes, read-only, over
// stateless Streamable HTTP. Everything it needs comes from the environment (src/packages/config)
// and is created here, once, and passed down: the configuration, the clock, the embedding model and the
// logger's callback.
import { pino } from "pino";
import { loadServerConfig } from "#/packages/config/index.ts";
import { loadOnnxEmbedder } from "#/packages/embedder/onnx.ts";
import { createSessionGatewayHandler } from "#/packages/mcp-server/handler.ts";
import { serveMcp } from "#/packages/mcp-server/http.ts";
import { systemClock } from "#/packages/time/clock.ts";

// Logs are JSON lines on stdout, so the deployment decides where they go (src/CLAUDE.md, "Configuration
// and portability"). pino's `err` key writes an Error's type, message and stack as fields of the line.
const logger = pino();

// SIGINT and SIGTERM are claimed before anything is opened. A port accepts connections as soon as it is
// bound, so a supervisor that waits for the port can signal the process while it is still starting up, and
// with no handler registered yet Node's default action ends the process there: no "listening" line and no
// graceful close. A signal that comes early is remembered, and the shutdown below runs once start-up is done.
const stopRequested = new Promise<void>((resolve) => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, resolve);
  }
});

// Aborted on shutdown, so a live lookup of OLIS still in flight ends instead of holding the close open.
const shutdown = new AbortController();

const config = loadServerConfig(process.env);
// The server holds the model for the life of the process and runs it on one thread: the deploy box has two
// cores shared with seven corpora (ADR-0007). A start-up that cannot load it fails here, naming the file.
const embedder = await loadOnnxEmbedder({ modelPath: config.modelPath, intraOpThreads: 1 });
const handler = createSessionGatewayHandler(config, {
  clock: systemClock,
  embedder,
  fetch,
  signal: shutdown.signal,
  onLiveLookupFailed: ({ measure, error }) => {
    logger.warn({ err: error, measure }, "The live lookup of OLIS failed; get_measure answered from the cache");
  },
});
const server = await serveMcp(handler, config, {
  onError: (error) => {
    logger.error({ err: error }, "The MCP adapter reported an error");
  },
});
logger.info({ host: config.host, port: server.port, path: config.mcpPath }, "MCP server listening");

// On SIGINT or SIGTERM stop accepting requests, then release the database, and let the process end.
// The live lookups in flight are aborted first, so the close doesn't wait out their timeout.
await stopRequested;
shutdown.abort();
try {
  await server.close();
  await handler.close();
} catch (error) {
  logger.error({ err: error }, "The MCP server did not shut down cleanly");
  process.exitCode = 1;
}
