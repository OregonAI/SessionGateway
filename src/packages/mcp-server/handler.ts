// The MCP server's handler: stateless Streamable HTTP, built on MCP SDK v2's createMcpHandler. It
// serves 2026-07-28 clients and, through the SDK's stateless fallback, 2025-era clients too.
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { ServerConfig } from "#/packages/config/index.ts";
import { openIndexReader, type IndexReader } from "#/packages/database/reader.ts";
import { openSearchReader } from "#/packages/database/search.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import { createOlisClient } from "#/packages/olis-client/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import {
  getDocument,
  getDocumentInput,
  getDocumentOutput,
  noLongerListedNotHeldMessage,
  noSuchPartMessage,
  testimonyNotHeldMessage,
  unknownDocumentMessage,
} from "./lib/get-document.ts";
import {
  compareAmendment,
  compareAmendmentInput,
  compareAmendmentOutput,
  unknownAmendmentMessage,
} from "./lib/compare-amendment.ts";
import { getMeasure, getMeasureInput, getMeasureOutput, unknownMeasureMessage } from "./lib/get-measure.ts";
import { createLiveStatusReader, type LiveLookupFailure, type LiveStatusReader } from "./lib/live-status.ts";
import { filterFaultMessage } from "./lib/filters.ts";
import { MAX_MEETINGS_CHARACTERS, meetings, meetingsInput, meetingsOutput, NO_FILTER_MESSAGE } from "./lib/meetings.ts";
import { search, searchInput, searchOutput, type SearchDeps } from "./lib/search.ts";
import { createVectorCache } from "./lib/vector-cache.ts";
import { sessionOverview, sessionOverviewInput, sessionOverviewOutput } from "./lib/session-overview.ts";
import {
  noSuchPageMessage,
  TESTIMONY_MAX_LISTED_LETTER_SETS,
  TESTIMONY_PAGE_SIZE,
  testimony,
  testimonyInput,
  testimonyOutput,
} from "./lib/testimony.ts";
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
  /** Embeds each question that `search` is asked. Created in the entry script, like the clock. */
  embedder: Embedder;
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
  searchDeps: SearchDeps,
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
        "Looks up one Measure of the Session by its id or citation and returns its catchline, its digest as OLIS publishes it, its sponsors who are Legislators in print order, its Statute Links by the Version or Proposed Amendment each was read from, with the measure section (a Proposed Amendment's links are listed only while no later Version is held; compare_amendment answers for the rest), its analysis documents (Fiscal Impact Statements, revenue impact statements, staff measure summaries and budget reports) by the Version each is of, with the ones the Legislature's label does not place on a Version, and the ones it flags as a minority report's, listed apart and saying why, how many of its analysis documents this index does not hold, a link to its OLIS page, when this index was last refreshed and a notice that it is not the official record. Its location, history, floor votes and committee votes are given twice: as the index last pulled them (as_of), and in live_status, read from OLIS when the call arrives with the committee meetings still ahead of the Measure (its schedule). If OLIS cannot be read, live_status holds the index's values and says plainly that the live lookup failed.",
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
    "compare_amendment",
    {
      title: "Compare a Proposed Amendment",
      description:
        "Looks up one Proposed Amendment of the Session by its citation (SB 69-2, HB 3795-A3) or its id and compares it with the Version it amends. It returns the meetings the amendment was posted to, with what each committee did with it; the Version it amends, read from the amendment's own header and checked against the letter in its number (or why that Version is not known: nothing is guessed); the amendment's Statute Links by kind (amends, repeals, adds-to, cites) and measure section, with ORS ranges expanded and chapter targets marked as not resolvable on OregonAI; the Statute Links of the Version it amends in the same shape; the amendment's edits to the relating clause; and a note that what the amendment deletes from the Version was not evaluated. It is not the official record.",
      inputSchema: compareAmendmentInput,
      outputSchema: compareAmendmentOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => {
      const refused = refuseOverRateLimit(limiter, config);
      if (refused !== undefined) return refused;
      const result = compareAmendment(reader, config.session, input);
      switch (result.kind) {
        case "found":
          return {
            content: [{ type: "text", text: JSON.stringify(result.comparison) }],
            structuredContent: result.comparison,
          };
        case "unknown":
          return {
            isError: true,
            content: [{ type: "text", text: unknownAmendmentMessage(result.reference, result.session) }],
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
        case "not_held":
          return {
            isError: true,
            content: [{ type: "text", text: testimonyNotHeldMessage(result.id, result.session) }],
          };
        case "no_longer_listed_not_held":
          return {
            isError: true,
            content: [
              { type: "text", text: noLongerListedNotHeldMessage(result.id, result.session, result.lastListedAt) },
            ],
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
        case "unknown_committee":
        case "backwards_range":
          return { isError: true, content: [{ type: "text", text: filterFaultMessage(result) }] };
        case "no_filter":
          return { isError: true, content: [{ type: "text", text: NO_FILTER_MESSAGE }] };
        default:
          return result satisfies never;
      }
    },
  );
  server.registerTool(
    "testimony",
    {
      title: "Testimony on a Measure",
      description: `Lists the Testimony submitted to committees on one Measure of the Session, by its id or citation, grouped by position (support, oppose, neutral, unknown; any other position id is shown under its number) and then by Organization, with each item's submitter, BehalfOf, committee, meeting date, whether its file has a text layer, and the Agency's registry slug when Organization names an Agency. Organization is free text typed by the submitter and is often a city ("Portland"), not an organization: it is grouped as written, with capitals and spaces ignored, and no attempt is made to tell cities from organizations. BehalfOf often names the real organization, so it is shown on every item. The tool returns no letter text: give an item's id to get_document to read it. Rows whose files hold the same text are one set of identical letters: identical_letters lists the ${TESTIMONY_MAX_LISTED_LETTER_SETS} largest sets, each once, as the id to read and a count (identical_letters_left_out says how many it leaves out), and every item of a set, on any page, says its id to read (same_letter_as) and the set's count (same_letter_count); the items stay one per row. A Measure can have thousands of rows, so a call returns a page of ${TESTIMONY_PAGE_SIZE} items in a fixed order (position, organization group, CommTestId): ask for the next with page. Every page carries the Measure's total, the counts by position, the number of organization groups and the identical letters. It is not the official record.`,
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
            content: [{ type: "text", text: noSuchPageMessage(result.measureId, result.page, result.lastPage) }],
          };
        default:
          return result satisfies never;
      }
    },
  );
  server.registerTool(
    "search",
    {
      title: "Search the Session",
      description:
        "Searches every document of the Session at once, by the words in it and by the meaning of its passages, and returns the best hits first, at most 20 (up to 50 with limit). A passage matches by words when it holds every word of the query; the meaning side finds passages whose sense is near the question's, so a question worded differently from the document still finds it. A citation anywhere in the query (HB 3131, SB 69-2, ORS 468.130) puts its exact matches first: a Measure's Versions from Introduced to Enrolled, the amendment, the documents whose text holds the section. A citation that names nothing the index holds puts nothing first, and `notes` says so. Testimony is left out unless include_testimony is true, kind is testimony, measure is given, the query says testimony, or the query cites exactly one Measure (HB 3131): that Measure is then the question's subject for this rule only, and the search is not filtered to it. Agendas, Recording Logs and witness-registration lists are found by their words only: by a passage that holds every word of the query, or after those by one that holds some of them. Filters: kind, measure, committee, and from and to (Pacific dates). Each hit has its id (give it to get_document), kind, title, Measure, date, a snippet of the passage that matched, the link to the document and how it was found (found_by). It is not the official record.",
      inputSchema: searchInput,
      outputSchema: searchOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => {
      const refused = refuseOverRateLimit(limiter, config);
      if (refused !== undefined) return refused;
      const result = await search(searchDeps, config.session, input);
      switch (result.kind) {
        case "found":
          return { content: [{ type: "text", text: JSON.stringify(result.search) }], structuredContent: result.search };
        case "unknown_measure":
        case "unknown_committee":
        case "backwards_range":
          return { isError: true, content: [{ type: "text", text: filterFaultMessage(result) }] };
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
  const searchIndex = openSearchReader(config.databasePath);
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
  const searchDeps: SearchDeps = {
    reader,
    searchIndex,
    embedder: deps.embedder,
    vectors: createVectorCache({
      reader,
      searchIndex,
      session: config.session,
      modelId: deps.embedder.modelId,
    }),
  };
  const handler = createMcpHandler(() => buildServer(reader, searchDeps, liveStatus, config, limiter, deps.clock));
  return {
    fetch: handler.fetch,
    close: async () => {
      await handler.close();
      searchIndex.close();
      reader.close();
    },
  };
}
