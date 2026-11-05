// The MCP server's handler: stateless Streamable HTTP, built on MCP SDK v2's createMcpHandler. It
// serves 2026-07-28 clients and, through the SDK's stateless fallback, 2025-era clients too.
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { ServerConfig } from "#/packages/config/index.ts";
import { openIndexReader, type IndexReader } from "#/packages/database/reader.ts";
import { openSearchReader } from "#/packages/database/search.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import { createOlisClient } from "#/packages/olis-client/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { createEnvelope, type Envelope } from "./envelope.ts";
import {
  compareAmendment,
  compareAmendmentFaultMessage,
  compareAmendmentInput,
  compareAmendmentOutput,
} from "./lib/compare-amendment.ts";
import {
  findMeasures,
  findMeasuresFaultMessage,
  findMeasuresInput,
  findMeasuresOutput,
  FIND_MEASURES_MAX_EVIDENCE,
  FIND_MEASURES_PAGE_SIZE,
} from "./lib/find-measures.ts";
import { getDocument, getDocumentFaultMessage, getDocumentInput, getDocumentOutput } from "./lib/get-document.ts";
import { getMeasure, getMeasureFaultMessage, getMeasureInput, getMeasureOutput } from "./lib/get-measure.ts";
import { createLiveStatusReader, type LiveLookupFailure, type LiveStatusReader } from "./lib/live-status.ts";
import {
  MAX_MEETINGS_CHARACTERS,
  meetings,
  meetingsFaultMessage,
  meetingsInput,
  meetingsOutput,
} from "./lib/meetings.ts";
import { noFault } from "./lib/outcome.ts";
import { search, searchFaultMessage, searchInput, searchOutput, type SearchDeps } from "./lib/search.ts";
import { createVectorCache } from "./lib/vector-cache.ts";
import { sessionOverview, sessionOverviewInput, sessionOverviewOutput } from "./lib/session-overview.ts";
import {
  TESTIMONY_MAX_LISTED_LETTER_SETS,
  TESTIMONY_PAGE_SIZE,
  testimony,
  testimonyFaultMessage,
  testimonyInput,
  testimonyOutput,
} from "./lib/testimony.ts";

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
 * Registers each tool once, through the envelope: the rate limit, the As of, the notice, the Staleness warning and the MCP
 * result are the envelope's, and a tool is its name, its schemas, its function, its message for each of its faults and
 * whether an answer of it holds a source_url (`carriesSourceUrl`). The envelope words the notice from that for each
 * result: the clause that tells the reader to use source_url is there when the result holds one, and not otherwise.
 */
function buildServer(
  envelope: Envelope,
  reader: IndexReader,
  searchDeps: SearchDeps,
  liveStatus: LiveStatusReader,
  config: ServerConfig,
  clock: Clock,
): McpServer {
  const server = new McpServer({ name: "session-gateway", version: "0.0.0" });
  envelope.register(server, {
    name: "get_measure",
    title: "Get a Measure",
    description:
      "Looks up one Measure of the Session by its id or citation and returns its catchline, its digest as OLIS publishes it, its sponsors who are Legislators in print order, its Statute Links by the Version or Proposed Amendment each was read from, with the measure section (a Proposed Amendment's links are listed only while no later Version is held; compare_amendment answers for the rest), its analysis documents (Fiscal Impact Statements, revenue impact statements, staff measure summaries and budget reports) by the Version each is of, with the ones the Legislature's label does not place on a Version, and the ones it flags as a minority report's, listed apart and saying why, how many of its analysis documents this index does not hold, its Agency Links by Agency (each Agency's registry slug and its parent, and its links grouped by kind of evidence, each kind with its count and three examples naming the node and the document, the documents named once with where the Legislature publishes them, and the units its Fiscal Impact Statements list that are not Agencies, kept as written; find_measures with the Agency lists every link), its hearings (each Recording Log with a speaker-turn index that has an Agenda item for the Measure: the Meeting, and the first turn under the item with a link into the official player at that second), a link to its OLIS page, when this index was last refreshed and a notice that it is not the official record. Its location, history, floor votes and committee votes are given as the index last pulled them (as_of), and live_status says what OLIS adds, read when the call arrives: each is unchanged, or a list shows only the new entries after the top level's last, or the whole value when it differs in another way; live_status also holds the committee meetings still ahead of the Measure (its schedule). If OLIS cannot be read, live_status says plainly that the live lookup failed and repeats none of the top level's values. When this index holds Legislative Counsel's Statutes Affected Table, each Version that table names also shows, beside its Statute Links, which of the links that change the law the table confirms and where the table and the links disagree.",
    input: getMeasureInput,
    output: getMeasureOutput,
    carriesSourceUrl: () => true,
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: (input, asOf) => getMeasure(reader, liveStatus, config.session, input, asOf),
    faultMessage: getMeasureFaultMessage,
  });
  envelope.register(server, {
    name: "compare_amendment",
    title: "Compare a Proposed Amendment",
    description:
      "Looks up one Proposed Amendment of the Session by its citation (SB 69-2, HB 3795-A3) or its id and compares it with the Version it amends. It returns the meetings the amendment was posted to, with what each committee did with it; the Version it amends, read from the amendment's own header and checked against the letter in its number (or why that Version is not known: nothing is guessed); the amendment's Statute Links by kind (amends, repeals, adds-to, cites) and measure section, with ORS ranges expanded and chapter targets marked as not resolvable on OregonAI; the Statute Links of the Version it amends in the same shape; the amendment's edits to the relating clause; and a note that what the amendment deletes from the Version was not evaluated. It is not the official record.",
    input: compareAmendmentInput,
    output: compareAmendmentOutput,
    carriesSourceUrl: (answer) => answer.amendment.postings.length > 0,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (input) => compareAmendment(reader, config.session, input),
    faultMessage: compareAmendmentFaultMessage,
  });
  envelope.register(server, {
    name: "get_document",
    title: "Get a document",
    description:
      "Returns the text of one document of the Session exactly as the Legislature published it, in parts, with where and when it was fetched, the ids of the Measure, Version, meeting and committee it belongs to, and whether it has a text layer at all. It is not the official record.",
    input: getDocumentInput,
    output: getDocumentOutput,
    carriesSourceUrl: () => true,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (input) => getDocument(reader, config.session, input),
    faultMessage: getDocumentFaultMessage,
  });
  envelope.register(server, {
    name: "meetings",
    title: "Committee meetings",
    description: `Lists committee meetings of the Session, earliest first, for a Measure (meetings with an agenda item about it), a committee, a date range, or all three together. Each meeting has when it starts, the status OLIS gives it (Scheduled, Cancelled), whether it is still ahead of the service's clock, its agenda items, the Proposed Amendments posted to it, its Exhibits (each with OLIS's title for it), its Recording Logs, its agenda document and a link to its OLIS page. next_meeting_id names the next scheduled meeting. Every document OLIS lists for a meeting is listed, and each says whether this service has fetched the file yet (fetched): only a fetched one can be read with get_document. A call returns whole days of meetings, as many as fit in about ${MAX_MEETINGS_CHARACTERS} characters; when truncated is true, ask again with from set to the day after the last meeting returned. It is not the official record.`,
    input: meetingsInput,
    output: meetingsOutput,
    carriesSourceUrl: (answer) => answer.meetings.length > 0,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (input) => meetings(reader, config.session, clock.now(), input),
    faultMessage: meetingsFaultMessage,
  });
  envelope.register(server, {
    name: "testimony",
    title: "Testimony on a Measure",
    description: `Lists the Testimony submitted to committees on one Measure of the Session, by its id or citation, grouped by position (support, oppose, neutral, unknown; any other position id is shown under its number) and then by Organization, with each item's submitter, BehalfOf, committee, meeting date, whether its file has a text layer, and the Agency's registry slug when Organization names an Agency. Organization is free text typed by the submitter and is often a city ("Portland"), not an organization: it is grouped as written, with capitals and spaces ignored, and no attempt is made to tell cities from organizations. BehalfOf often names the real organization, so it is shown on every item. The tool returns no letter text: give an item's id to get_document to read it. Rows whose files hold the same text are one set of identical letters: identical_letters lists the ${TESTIMONY_MAX_LISTED_LETTER_SETS} largest sets, each once, as the id to read and a count (identical_letters_left_out says how many it leaves out), and every item of a set, on any page, says its id to read (same_letter_as) and the set's count (same_letter_count); the items stay one per row. A Measure can have thousands of rows, so a call returns a page of ${TESTIMONY_PAGE_SIZE} items in a fixed order (position, organization group, CommTestId): ask for the next with page. Every page carries the Measure's total, the counts by position, the number of organization groups and the identical letters. It is not the official record.`,
    input: testimonyInput,
    output: testimonyOutput,
    carriesSourceUrl: (answer) => answer.total > 0,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (input) => testimony(reader, config.session, input),
    faultMessage: testimonyFaultMessage,
  });
  envelope.register(server, {
    name: "find_measures",
    title: "Find Measures that touch an Agency or a statute",
    description: `Finds the Measures, Versions and Proposed Amendments tied to an Agency (agency: an OregonAI registry slug such as bureau-of-labor-and-industries), to an ORS section (ors_section: "ORS 653.616") or to an ORS chapter (ors_chapter: "ORS chapter 657B"), optionally only the ones whose evidence OLIS created at or after a time (since: a date, or a time that is Pacific unless it has an offset or a zone; it is compared with the created_at of each piece of evidence). For an Agency the items come in four groups: those that touch its statutes (a Statute Link that amends, repeals or adds to a section or chapter whose rules the Agency implements, or whose sub-units' rules do; a citation does not count), those that name it in a Fiscal Impact Statement, those that name it in their text, and Testimony. The groups are kept apart, and an item is in each group it is tied in. For a section or chapter the items are the Versions and Proposed Amendments with a Statute Link to it, of every kind (amends, repeals, adds-to, cites), with the kind shown. Each item has its id, its Measure, its source_url, when OLIS first and last created the evidence (created_at and last_created_at, from the feed's CreatedDate) and its evidence grouped by kind, each kind with its count, how many the cut left out, and its newest examples, ${FIND_MEASURES_MAX_EVIDENCE} at the most for the item; the documents the examples name are listed once with where the Legislature publishes them. The most recently created come first, ${FIND_MEASURES_PAGE_SIZE} items to a page across the groups: ask for the next with page. It is not the official record.`,
    input: findMeasuresInput,
    output: findMeasuresOutput,
    carriesSourceUrl: (answer) => answer.groups.some((group) => group.items.length > 0),
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (input) => findMeasures(reader, config.session, input),
    faultMessage: findMeasuresFaultMessage,
  });
  envelope.register(server, {
    name: "search",
    title: "Search the Session",
    description:
      "Searches every document of the Session at once, by the words in it and by the meaning of its passages, and returns the best hits first, at most 20 (up to 50 with limit). A passage matches by words when it holds every word of the query; the meaning side finds passages whose sense is near the question's, so a question worded differently from the document still finds it. A citation anywhere in the query (HB 3131, SB 69-2, ORS 468.130) puts its exact matches first: a Measure's Versions from Introduced to Enrolled, the amendment, the documents whose text holds the section. A citation that names nothing the index holds puts nothing first, and `notes` says so. Testimony is left out unless include_testimony is true, kind is testimony, measure is given, the query says testimony, or the query cites exactly one Measure (HB 3131): that Measure is then the question's subject for this rule only, and the search is not filtered to it. Agendas, Recording Logs and witness-registration lists are found by their words only: by a passage that holds every word of the query, or after those by one that holds some of them. Each speaker turn of a Recording Log is a hit of its own, with `turn` giving the speaker (and Legislator Code), Meeting, Agenda item, Measure, timecode and a link into the official player at that second; the hit's id is the log's. Filters: kind, measure, committee, agency (the Measures with an Agency Link, of any evidence, to an Agency: its OregonAI registry slug), and from and to (Pacific dates). Each hit has its id (give it to get_document), kind, title, Measure, date, a snippet of the passage that matched, the link to the document and how it was found (found_by). It is not the official record.",
    input: searchInput,
    output: searchOutput,
    carriesSourceUrl: (answer) => answer.results.length > 0,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (input, asOf) => search(searchDeps, config.session, input, asOf),
    faultMessage: searchFaultMessage,
  });
  envelope.register(server, {
    name: "session_overview",
    title: "Overview of the Session",
    description:
      "Returns which Session this service holds, how many Measures, committees, meetings and documents it has (and how many documents are scans with no text layer), when the index was last refreshed, and which version of the OregonAI snapshot it was built with (the commit of OregonAI's executive-regulatory-frameworks repository the registry and ORS data were copied from, and the commit's date). It is not the official record.",
    input: sessionOverviewInput,
    output: sessionOverviewOutput,
    carriesSourceUrl: () => false,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: () => sessionOverview(reader, config.session),
    faultMessage: noFault,
  });
  return server;
}

export function createSessionGatewayHandler(config: ServerConfig, deps: HandlerDeps): SessionGatewayHandler {
  const reader = openIndexReader(config.databasePath);
  const searchIndex = openSearchReader(config.databasePath);
  // One envelope for the process: createMcpHandler builds a server for each request, and the envelope holds the rate
  // limiter, which counts the calls of every request together.
  const envelope = createEnvelope({ reader, config, clock: deps.clock });
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
      searchIndex,
      session: config.session,
      modelId: deps.embedder.modelId,
    }),
  };
  const handler = createMcpHandler(() => buildServer(envelope, reader, searchDeps, liveStatus, config, deps.clock));
  return {
    fetch: handler.fetch,
    close: async () => {
      await handler.close();
      searchIndex.close();
      reader.close();
    },
  };
}
