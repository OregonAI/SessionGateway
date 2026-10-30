// The MCP server's handler: stateless Streamable HTTP, built on MCP SDK v2's createMcpHandler. It
// serves 2026-07-28 clients and, through the SDK's stateless fallback, 2025-era clients too.
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { ServerConfig } from "#/packages/config/index.ts";
import { openIndexReader, type IndexReader } from "#/packages/database/reader.ts";
import { createOlisClient } from "#/packages/olis-client/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { getMeasure, getMeasureInput, getMeasureOutput, unknownMeasureMessage } from "./lib/get-measure.ts";
import { createLiveStatusReader, type LiveLookupFailure, type LiveStatusReader } from "./lib/live-status.ts";
import { createRateLimiter, rateLimitMessage, type RateLimiter } from "./lib/rate-limit.ts";

export type HandlerDeps = {
  /** Times the rate limit's window, and dates each live lookup. */
  clock: Clock;
  /** Reads OLIS for the live status of get_measure. */
  fetch: typeof fetch;
  /** Aborts live lookups in flight on shutdown. */
  signal: AbortSignal;
  /** Told of each live lookup that failed, so the deployment can log it; the call itself still answers from the cache. */
  onLiveLookupFailed: (failure: LiveLookupFailure) => void;
};

export type SessionGatewayHandler = {
  fetch: McpHttpHandler["fetch"];
  close(): Promise<void>;
};

function buildServer(
  reader: IndexReader,
  liveStatus: LiveStatusReader,
  config: ServerConfig,
  limiter: RateLimiter,
): McpServer {
  const server = new McpServer({ name: "session-gateway", version: "0.0.0" });
  server.registerTool(
    "get_measure",
    {
      title: "Get a Measure",
      description:
        "Looks up one Measure of the Session by its id or citation and returns its catchline, its sponsors who are Legislators in print order, a link to its OLIS page, when this index was last refreshed and a notice that it is not the official record. Its location, history, floor votes and committee votes are given twice: as the index last pulled them (as_of), and in live_status, read from OLIS when the call arrives with the committee meetings still ahead of the Measure (its schedule). If OLIS cannot be read, live_status holds the index's values and says plainly that the live lookup failed.",
      inputSchema: getMeasureInput,
      outputSchema: getMeasureOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
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
      const result = await getMeasure(reader, liveStatus, config.session, input);
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
  const liveStatus = createLiveStatusReader({
    olis: createOlisClient({ baseUrl: config.olisBaseUrl, fetch: deps.fetch }),
    legislatorOfCode: (session, code) => reader.findLegislatorOfCode(session, code),
    clock: deps.clock,
    timeoutMs: config.olisLiveTimeoutMs,
    signal: deps.signal,
    onFailure: deps.onLiveLookupFailed,
  });
  const handler = createMcpHandler(() => buildServer(reader, liveStatus, config, limiter));
  return {
    fetch: handler.fetch,
    close: async () => {
      await handler.close();
      reader.close();
    },
  };
}
