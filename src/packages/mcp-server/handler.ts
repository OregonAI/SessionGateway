// The MCP server's handler: stateless Streamable HTTP, built on MCP SDK v2's createMcpHandler. It
// serves 2026-07-28 clients and, through the SDK's stateless fallback, 2025-era clients too.
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { ServerConfig } from "#/packages/config/index.ts";
import { openIndexReader, type IndexReader } from "#/packages/database/reader.ts";
import type { Clock } from "#/packages/time/clock.ts";
import {
  getDocument,
  getDocumentInput,
  getDocumentOutput,
  noSuchPartMessage,
  unknownDocumentMessage,
} from "./lib/get-document.ts";
import { getMeasure, getMeasureInput, getMeasureOutput, unknownMeasureMessage } from "./lib/get-measure.ts";
import {
  backwardsRangeMessage,
  meetings,
  meetingsInput,
  meetingsOutput,
  NO_FILTER_MESSAGE,
  unknownCommitteeMessage,
} from "./lib/meetings.ts";
import { sessionOverview, sessionOverviewInput, sessionOverviewOutput } from "./lib/session-overview.ts";
import { createRateLimiter, rateLimitMessage, type RateLimiter } from "./lib/rate-limit.ts";

export type HandlerDeps = {
  /** Times the rate limit's window. */
  clock: Clock;
};

export type SessionGatewayHandler = {
  fetch: McpHttpHandler["fetch"];
  close(): Promise<void>;
};

/**
 * The MCP specification requires servers to rate-limit tool calls (src/CLAUDE.md, "MCP"). A refused
 * call is an expected outcome, so it is a tool error the agent can read and act on.
 */
function refuseOverRateLimit(
  limiter: RateLimiter,
  config: ServerConfig,
): { isError: true; content: { type: "text"; text: string }[] } | undefined {
  const turn = limiter.take();
  if (turn.allowed) return undefined;
  return {
    isError: true,
    content: [
      { type: "text", text: rateLimitMessage(config.rateLimit, config.rateWindowSeconds, turn.retryAfterSeconds) },
    ],
  };
}

function buildServer(reader: IndexReader, config: ServerConfig, limiter: RateLimiter, clock: Clock): McpServer {
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
      const refused = refuseOverRateLimit(limiter, config);
      if (refused !== undefined) return refused;
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
  server.registerTool(
    "get_document",
    {
      title: "Get a document",
      description:
        "Returns the text of one document of the Session exactly as the Legislature published it, in parts, with where and when it was fetched, the ids of the Measure, Version, meeting and committee it belongs to, and whether it has a text layer at all. It is not the official record.",
      inputSchema: getDocumentInput,
      outputSchema: getDocumentOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => {
      const refused = refuseOverRateLimit(limiter, config);
      if (refused !== undefined) return refused;
      const result = getDocument(reader, config.session, input);
      switch (result.kind) {
        case "found":
          return {
            content: [{ type: "text", text: JSON.stringify(result.document) }],
            structuredContent: result.document,
          };
        case "unknown":
          return {
            isError: true,
            content: [{ type: "text", text: unknownDocumentMessage(result.id, result.session) }],
          };
        case "no_such_part":
          return {
            isError: true,
            content: [{ type: "text", text: noSuchPartMessage(result.id, result.part, result.partCount) }],
          };
        default:
          return result satisfies never;
      }
    },
  );
  server.registerTool(
    "meetings",
    {
      title: "Committee meetings",
      description:
        "Lists committee meetings of the Session, earliest first, for a Measure (meetings with an agenda item about it), a committee, a date range, or all three together. Each meeting has when it starts, the status OLIS gives it (Scheduled, Cancelled), whether it is still ahead of the service's clock, its agenda items, the Proposed Amendments posted to it, its Exhibits, its Recording Logs, its agenda document and a link to its OLIS page. next_meeting_id names the next scheduled meeting. At most 25 meetings come back; narrow with from and to when truncated is true. It is not the official record.",
      inputSchema: meetingsInput,
      outputSchema: meetingsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => {
      const refused = refuseOverRateLimit(limiter, config);
      if (refused !== undefined) return refused;
      const result = meetings(reader, config.session, clock.now(), input);
      switch (result.kind) {
        case "found":
          return {
            content: [{ type: "text", text: JSON.stringify(result.meetings) }],
            structuredContent: result.meetings,
          };
        case "unknown_measure":
          return {
            isError: true,
            content: [{ type: "text", text: unknownMeasureMessage(result.reference, result.session) }],
          };
        case "unknown_committee":
          return {
            isError: true,
            content: [{ type: "text", text: unknownCommitteeMessage(result.reference, result.session) }],
          };
        case "no_filter":
          return { isError: true, content: [{ type: "text", text: NO_FILTER_MESSAGE }] };
        case "backwards_range":
          return { isError: true, content: [{ type: "text", text: backwardsRangeMessage(result.from, result.to) }] };
        default:
          return result satisfies never;
      }
    },
  );
  server.registerTool(
    "session_overview",
    {
      title: "Overview of the Session",
      description:
        "Returns which Session this service holds, how many Measures, committees, meetings and documents it has (and how many documents are scans with no text layer), and when the index was last refreshed. It is not the official record.",
      inputSchema: sessionOverviewInput,
      outputSchema: sessionOverviewOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => {
      const refused = refuseOverRateLimit(limiter, config);
      if (refused !== undefined) return refused;
      const overview = sessionOverview(reader, config.session);
      return { content: [{ type: "text", text: JSON.stringify(overview) }], structuredContent: overview };
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
  const handler = createMcpHandler(() => buildServer(reader, config, limiter, deps.clock));
  return {
    fetch: handler.fetch,
    close: async () => {
      await handler.close();
      reader.close();
    },
  };
}
