// The MCP server's handler: stateless Streamable HTTP, built on MCP SDK v2's createMcpHandler. It
// serves 2026-07-28 clients and, through the SDK's stateless fallback, 2025-era clients too.
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { ServerConfig } from "#/packages/config/index.ts";
import { openIndexReader, type IndexReader } from "#/packages/database/reader.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { getMeasure, getMeasureInput, getMeasureOutput, unknownMeasureMessage } from "./lib/get-measure.ts";
import { createRateLimiter, rateLimitMessage, type RateLimiter } from "./lib/rate-limit.ts";

export type HandlerDeps = {
  /** Times the rate limit's window. */
  clock: Clock;
};

export type SessionGatewayHandler = {
  fetch: McpHttpHandler["fetch"];
  close(): Promise<void>;
};

function buildServer(reader: IndexReader, config: ServerConfig, limiter: RateLimiter): McpServer {
  const server = new McpServer({ name: "session-gateway", version: "0.0.0" });
  server.registerTool(
    "get_measure",
    {
      title: "Get a Measure",
      description:
        "Looks up one Measure of the Session by its id or citation and returns its catchline, a link to its OLIS page, when this index was last refreshed and a notice that it is not the official record.",
      inputSchema: getMeasureInput,
      outputSchema: getMeasureOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => {
      // The MCP specification requires servers to rate-limit tool calls (src/CLAUDE.md, "MCP"). A
      // refused call is an expected outcome, so it is a tool error the agent can read and act on.
      const turn = limiter.take();
      if (!turn.allowed) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: rateLimitMessage(config.rateLimit, config.rateWindowSeconds, turn.retryAfterSeconds),
            },
          ],
        };
      }
      const result = getMeasure(reader, config.session, input);
      switch (result.kind) {
        case "found":
          return {
            content: [{ type: "text", text: JSON.stringify(result.measure) }],
            structuredContent: result.measure,
          };
        case "unknown":
          return {
            isError: true,
            content: [{ type: "text", text: unknownMeasureMessage(result.reference, result.session) }],
          };
        default:
          return result satisfies never;
      }
    },
  );
  return server;
}

export function createSessionGatewayHandler(config: ServerConfig, deps: HandlerDeps): SessionGatewayHandler {
  const reader = openIndexReader(config.databasePath);
  // One limiter for the process: createMcpHandler builds a server for each request, so the limiter
  // cannot live inside buildServer.
  const limiter = createRateLimiter({
    limit: config.rateLimit,
    windowSeconds: config.rateWindowSeconds,
    clock: deps.clock,
  });
  const handler = createMcpHandler(() => buildServer(reader, config, limiter));
  return {
    fetch: handler.fetch,
    close: async () => {
      await handler.close();
      reader.close();
    },
  };
}
