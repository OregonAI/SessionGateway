// The MCP server's entry script: serves the database the ingest worker writes, read-only, over
// stateless Streamable HTTP. Everything it needs comes from the environment (src/packages/config).
import { loadServerConfig } from "#/packages/config/index.ts";
import { createSessionGatewayHandler } from "#/packages/mcp-server/handler.ts";
import { serveMcp } from "#/packages/mcp-server/http.ts";
import { systemClock } from "#/packages/time/clock.ts";

const config = loadServerConfig(process.env);
const handler = createSessionGatewayHandler(config, { clock: systemClock });
const server = await serveMcp(handler, config, {
  onError: (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
  },
});

// On SIGINT or SIGTERM stop accepting requests, then release the database, and let the process end.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server
      .close()
      .then(() => handler.close())
      .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
        process.exitCode = 1;
      });
  });
}
