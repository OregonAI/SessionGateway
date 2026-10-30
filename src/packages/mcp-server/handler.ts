// The MCP server's handler: stateless Streamable HTTP, built on MCP SDK v2's createMcpHandler. It
// serves 2026-07-28 clients and, through the SDK's stateless fallback, 2025-era clients too.
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { ServerConfig } from "#/packages/config/index.ts";
import { openIndexReader, type IndexReader } from "#/packages/database/reader.ts";
import { createOlisClient } from "#/packages/olis-client/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import {
  getDocument,
  getDocumentInput,
  getDocumentOutput,
  noSuchPartMessage,
  unknownDocumentMessage,
} from "./lib/get-document.ts";
import { getMeasure, getMeasureInput, getMeasureOutput, unknownMeasureMessage } from "./lib/get-measure.ts";
import { createLiveStatusReader, type LiveLookupFailure, type LiveStatusReader } from "./lib/live-status.ts";
import {
  backwardsRangeMessage,
  MAX_MEETINGS_CHARACTERS,
  meetings,
  meetingsInput,
  meetingsOutput,
  NO_FILTER_MESSAGE,
  unknownCommitteeMessage,
} from "./lib/meetings.ts";
import { sessionOverview, sessionOverviewInput, sessionOverviewOutput } from "./lib/session-overview.ts";
import { noSuchPageMessage, testimony, testimonyInput, testimonyOutput } from "./lib/testimony.ts";
import { createRateLimiter, rateLimitMessage, type RateLimiter } from "./lib/rate-limit.ts";

export type HandlerDeps = {
  /**
   * The time the server answers by: it times the rate limit's window, dates each live lookup, and
   * `meetings` measures "upcoming" and the next meeting from it. A test that freezes or moves it moves all three.
   */
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

function buildServer(
  reader: IndexReader,
  liveStatus: LiveStatusReader,
  config: ServerConfig,
  limiter: RateLimiter,
  clock: Clock,
): McpServer {
  const server = new McpServer({ name: "session-gateway", version: "0.0.0" });
  server.registerTool(
    "get_measure",
    {
      title: "Get a Measure",
      description:
        "Looks up one Measure of the Session by its id or citation and returns its catchline, its digest as OLIS publishes it, its sponsors who are Legislators in print order, its analysis documents (Fiscal Impact Statements, revenue impact statements, staff measure summaries and budget reports) by the Version each is of, with the ones the Legislature's label does not place on a Version, and the ones it flags as a minority report's, listed apart and saying why, how many of its analysis documents this index does not hold, a link to its OLIS page, when this index was last refreshed and a notice that it is not the official record. Its location, history, floor votes and committee votes are given twice: as the index last pulled them (as_of), and in live_status, read from OLIS when the call arrives with the committee meetings still ahead of the Measure (its schedule). If OLIS cannot be read, live_status holds the index's values and says plainly that the live lookup failed.",
      inputSchema: getMeasureInput,
      outputSchema: getMeasureOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const refused = refuseOverRateLimit(limiter, config);
      if (refused !== undefined) return refused;
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
      description: `Lists committee meetings of the Session, earliest first, for a Measure (meetings with an agenda item about it), a committee, a date range, or all three together. Each meeting has when it starts, the status OLIS gives it (Scheduled, Cancelled), whether it is still ahead of the service's clock, its agenda items, the Proposed Amendments posted to it, its Exhibits (each with OLIS's title for it), its Recording Logs, its agenda document and a link to its OLIS page. next_meeting_id names the next scheduled meeting. Every document OLIS lists for a meeting is listed, and each says whether this service has fetched the file yet (fetched): only a fetched one can be read with get_document. A call returns whole days of meetings, as many as fit in about ${MAX_MEETINGS_CHARACTERS} characters; when truncated is true, ask again with from set to the day after the last meeting returned. It is not the official record.`,
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
    "testimony",
    {
      title: "Testimony on a Measure",
      description:
        "Lists the Testimony submitted on one Measure of the Session, by its id or citation. It is not the official record.",
      inputSchema: testimonyInput,
      outputSchema: testimonyOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => {
      const refused = refuseOverRateLimit(limiter, config);
      if (refused !== undefined) return refused;
      const result = testimony(reader, config.session, input);
      switch (result.kind) {
        case "found":
          return {
            content: [{ type: "text", text: JSON.stringify(result.testimony) }],
            structuredContent: result.testimony,
          };
        case "unknown_measure":
          return {
            isError: true,
            content: [{ type: "text", text: unknownMeasureMessage(result.reference, result.session) }],
          };
        case "no_such_page":
          return {
            isError: true,
            content: [{ type: "text", text: noSuchPageMessage(result.measureId, result.page, result.pageCount) }],
          };
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
        "Returns which Session this service holds, how many Measures, committees, meetings and documents it has (and how many documents are scans with no text layer), when the index was last refreshed, and which version of the OregonAI snapshot it was built with (the commit of OregonAI's executive-regulatory-frameworks repository the registry and ORS data were copied from, and the commit's date). It is not the official record.",
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
  const liveStatus = createLiveStatusReader({
    olis: createOlisClient({ baseUrl: config.olisBaseUrl, fetch: deps.fetch }),
    legislatorOfCode: (session, code) => reader.findLegislatorOfCode(session, code),
    clock: deps.clock,
    timeoutMs: config.olisLiveTimeoutMs,
    signal: deps.signal,
    onFailure: deps.onLiveLookupFailed,
  });
  const handler = createMcpHandler(() => buildServer(reader, liveStatus, config, limiter, deps.clock));
  return {
    fetch: handler.fetch,
    close: async () => {
      await handler.close();
      reader.close();
    },
  };
}
