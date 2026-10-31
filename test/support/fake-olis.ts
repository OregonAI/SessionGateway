// A fake OLIS: an in-process node:http server on 127.0.0.1:0 that replays the committed fixture
// (test/fixtures/olis-2025R1/feed/) as the feed stood at the injected clock's time, and answers the
// way the real OData v3 service does. The quirks come from docs/research/olis-odata.md section 1
// and section 8; each one is a way a naive OData client breaks:
//
//  - `$count=true` is rejected with 400; the v3 forms are `$inlinecount=allpages` (answered as the
//    string "odata.count") and the `/$count` path segment.
//  - `/$count` is answered with a 415 when the `Accept` header names JSON, and with the count otherwise.
//    That includes `*/*`, which is what fetch sends when a request names no Accept of its own. The
//    research verified only a request with no Accept header at all (olis-odata.md section 1), so
//    that live OLIS answers `*/*` is an assumption this fake cannot check.
//  - Without a JSON `Accept` header an entity set comes back as Atom XML.
//  - A page holds at most 5,000 rows, and `odata.nextLink` is relative (`../odataservice.svc/...`).
//  - Rows are served verbatim: misspelled property names (CommitteCode, CommittteCode,
//    LegislatoreCode) and decimal keys as strings.
//  - Timestamps carry no offset (they are Pacific local time, which the fixture rows already are).
//  - `$filter` is a conjunction of "Property eq 'text'", "Property eq 123" and "Property ge datetime'...'"
//    terms, the forms the live lookup sends (olis-odata.md section 1 verified `eq`, `ge`, `and` and
//    `datetime'...'`). Anything else is refused with 400, and so is a property no row of the set has,
//    as live OLIS refuses `Nope eq 1`.
//
// With `documents: true` it also serves the documents the feed links, as OLIS does: the bytes of each
// file in the fixture's manifest, at the path of the manifest's `source_url` (/liz/2025R1/Downloads/...),
// on the same port. It counts every document request, so a test can read how often the worker fetched
// a file from the harness and never from the database, and it can fail a chosen document once (a hang
// that outlasts the client's timeout, or an HTTP status) to show that a transient failure is retried.
//
// The Statutes Affected Table is not a feed document: no row links it, and Legislative Counsel publishes it on
// www.oregonlegislature.gov, not on OLIS. The fixture's manifest holds it at its own path (/AutoPubs/artables2025R1.pdf),
// and the fake serves that path like any other document, so a test points the worker's STATUTES_AFFECTED_TABLE_URL at
// the fake's origin. `serveDocument` serves other bytes at a path from then on (a made-up table, as a PDF the test
// builds), and `failDocuments` makes a path fail again after it was served (a table withdrawn).
//
// "As the feed stood at the clock's time" means the rows whose CreatedDate is not after it. The
// fixture holds each row's final state, so a row's other fields may be newer than the clock.
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Clock } from "#/packages/time/clock.ts";

type Row = Record<string, unknown>;

export type FakeOlisOptions = {
  clock: Clock;
  /** Rows per page. The real service uses 5,000; a test lowers it to make paging happen. */
  pageSize?: number;
  /**
   * Rows served whatever `$filter` says, as if the feed ignored the Session filter (by entity
   * set). They are counted too. A test adds them here, never to the committed fixture. They are read at
   * every request, so a test may change a row between two pulls to show a row OLIS changed.
   */
  strayRows?: Record<string, Row[]>;
  /**
   * Counts every row but leaves the last `n` of each set out of the pages: a feed that changed
   * between the count and the paging, or dropped a page.
   */
  withholdLastRows?: number;
  /**
   * A feed whose paging does not end. "repeats-the-first-page": every `odata.nextLink` points back
   * to the first page, so the same rows come again and again. "never-ends": once the rows run out
   * the pages are empty, and each still carries a `nextLink` to the next one.
   */
  pagingFault?: "repeats-the-first-page" | "never-ends";
  /**
   * Serve the documents themselves. Off by default: extracting the fixture's 278 PDFs takes seconds, so
   * only a test that reads documents asks for them. The feed is the same either way, rows that link a
   * document included; when this is off every request for a document is answered 404 (Not Found), as
   * OLIS does for a file it does not have, and the worker lists the document as not fetched.
   */
  documents?: boolean;
  /**
   * Failures to give a document before it is served, by `source_url`: each request for the document
   * takes the next one off its list, and once the list is empty the document is served. A list of one
   * is a document that fails once.
   */
  documentFailures?: Record<string, DocumentFailure[]>;
  /**
   * Documents served although no fixture row links them, by their path on the fake
   * (`/liz/2025R1/Downloads/...`), each as the bytes of a file under the fixture's `documents/`.
   * A test adds the feed row that links one through `strayRows`.
   */
  strayDocuments?: Record<string, string>;
};

/** One request the fake OLIS received, as the feed's own URL words it. */
export type FakeOlisRequest = {
  /** The entity set, such as "MeasureHistoryActions". */
  entitySet: string;
  /** True for the `/$count` path segment. */
  isCount: boolean;
  /** The `$filter` option, decoded, or null if the request had none. */
  filter: string | null;
};

/** What the fake OLIS does with every request from now on (see `FakeOlis.behave`). */
export type FakeOlisBehavior =
  | { kind: "answer" }
  /** Answers with this error status, such as 503. */
  | { kind: "fail"; status: number }
  /** Accepts the request and never answers it. */
  | { kind: "hang" }
  /** Closes the connection without a response. */
  | { kind: "drop-connection" };

/** How a document request fails once: no answer until the client gives up, or an HTTP status. */
export type DocumentFailure = "hang" | number;

export type FakeOlis = {
  /** The service root with a trailing slash, for the OLIS client's base URL. */
  baseUrl: string;
  /** The origin that serves the documents (`http://127.0.0.1:<port>`), for the worker's OLIS_DOCUMENT_ORIGIN. */
  origin: string;
  /**
   * Every document request received so far, as the path it asked for (`/liz/2025R1/Downloads/...`),
   * in order. A test reads how often a file was fetched from here, never from the database.
   */
  documentRequests(): readonly string[];
  /**
   * From now on, serves these bytes at this path (`/AutoPubs/artables2025R1.pdf`) in place of the fixture's file, or
   * where the fixture has none: a made-up document that a test builds. Served only when `documents` is on.
   */
  serveDocument(path: string, bytes: Uint8Array): void;
  /**
   * From now on, adds these failures to the ones the document at this `source_url` has still to give before it is
   * served (see `documentFailures`): `[404]` makes the next request answer Not Found, as a document withdrawn does.
   */
  failDocuments(sourceUrl: string, failures: readonly DocumentFailure[]): void;
  /**
   * From now on, leave the last `count` rows of each set out of the pages (see `withholdLastRows`), or of the one set
   * named, so that a feed is short in a set other than the first the worker reads.
   */
  withholdLastRows(count: number, entitySet?: string): void;
  /** From now on, answer (or not) the way `behavior` says. Answering is the default. */
  behave(behavior: FakeOlisBehavior): void;
  /**
   * Changes fields of the rows of one entity set that `matches`, from now on. The fixture holds each
   * row's final state, so a test that needs a Measure to have moved since the pull says how here, and
   * the row it makes is made up for its case.
   */
  amendRows(entitySet: string, matches: (row: Row) => boolean, changes: Row): void;
  /**
   * Adds rows to one entity set, from now on. Unlike `strayRows`, which the pull sees too, these appear
   * after it, and the fake still hides one whose CreatedDate is after its clock.
   */
  addRows(entitySet: string, rows: readonly Row[]): void;
  /** Every feed request received since the fake started or `forgetRequests` was last called. */
  requests(): readonly FakeOlisRequest[];
  forgetRequests(): void;
  close(): Promise<void>;
};

const fixtureDirectory = new URL("../fixtures/olis-2025R1/", import.meta.url);
const feedDirectory = new URL("feed/", fixtureDirectory);
const serviceRoot = ["odata", "odataservice.svc"];

/** The fixture's documents by the path they are served at: the pathname of each manifest `source_url`. */
function loadDocumentPaths(): Map<string, URL> {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", fixtureDirectory), "utf8")) as {
    documents: { path: string; source_url: string }[];
  };
  const paths = new Map<string, URL>();
  for (const document of manifest.documents) {
    paths.set(new URL(document.source_url).pathname, new URL(document.path, fixtureDirectory));
  }
  return paths;
}

/**
 * The 20 entity sets of the real service (`$metadata`, docs/research/olis-odata.md section 2). The service has every
 * one of them, so a set the fixture holds no file for is a set with no rows and not one that answers 404.
 */
const entitySetNames = [
  "LegislativeSessions",
  "Measures",
  "MeasureDocuments",
  "MeasureAnalysisDocuments",
  "MeasureHistoryActions",
  "MeasureVotes",
  "MeasureSponsors",
  "Committees",
  "CommitteeMembers",
  "CommitteeStaffMembers",
  "CommitteeMeetings",
  "CommitteeAgendaItems",
  "CommitteeProposedAmendments",
  "CommitteeVotes",
  "CommitteeMeetingDocuments",
  "CommitteePublicTestimonies",
  "FloorSessionAgendaItems",
  "FloorLetters",
  "Legislators",
  "ConveneTimes",
];

function loadFeed(): Map<string, Row[]> {
  const sets = new Map<string, Row[]>();
  for (const file of readdirSync(feedDirectory)) {
    if (!file.endsWith(".json")) continue;
    const rows: unknown = JSON.parse(readFileSync(new URL(file, feedDirectory), "utf8"));
    if (!Array.isArray(rows)) throw new Error(`${file} is not a JSON array`);
    sets.set(file.slice(0, -".json".length), rows as Row[]);
  }
  for (const name of entitySetNames) {
    if (!sets.has(name)) sets.set(name, []);
  }
  return sets;
}

/** The wall clock in Pacific time as milliseconds, so it can be compared with a feed timestamp. */
function pacificWallClock(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    fractionalSecondDigits: 3,
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
    part("fractionalSecond"),
  );
}

/** A feed timestamp ("2025-01-17T15:16:44.993", no offset) as the same kind of wall-clock number. */
function feedWallClock(text: string): number {
  return Date.parse(`${text}Z`);
}

function sendText(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": contentType, dataserviceversion: "3.0;", "cache-control": "no-cache" });
  response.end(body);
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendText(
    response,
    status,
    "application/json;odata=minimalmetadata;charset=utf-8",
    JSON.stringify({ "odata.error": { code: "", message: { lang: "en-US", value: message } } }),
  );
}

type FilterTerm =
  { property: string; operator: "eq"; value: string | number } | { property: string; operator: "ge"; value: number };

const textTerm = /^(\w+) eq '((?:[^']|'')*)'$/;
const numberTerm = /^(\w+) eq (-?\d+)$/;
const datetimeTerm = /^(\w+) ge datetime'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)'$/;

/** Reads a `$filter` of terms joined by " and ", or says which term the fake does not understand. */
function parseFilter(filter: string): FilterTerm[] | { error: string } {
  const terms: FilterTerm[] = [];
  for (const text of filter.split(" and ")) {
    const asText = textTerm.exec(text);
    const asNumber = numberTerm.exec(text);
    const asDatetime = datetimeTerm.exec(text);
    if (asText?.[1] !== undefined && asText[2] !== undefined) {
      terms.push({ property: asText[1], operator: "eq", value: asText[2].replaceAll("''", "'") });
    } else if (asNumber?.[1] !== undefined && asNumber[2] !== undefined) {
      terms.push({ property: asNumber[1], operator: "eq", value: Number(asNumber[2]) });
    } else if (asDatetime?.[1] !== undefined && asDatetime[2] !== undefined) {
      terms.push({ property: asDatetime[1], operator: "ge", value: feedWallClock(asDatetime[2]) });
    } else {
      return {
        error: `The fake OLIS understands only "Property eq 'text'", "Property eq 123" and "Property ge datetime'...'" joined by " and ", not "${text}".`,
      };
    }
  }
  return terms;
}

function matches(row: Row, term: FilterTerm): boolean {
  const value = row[term.property];
  if (term.operator === "ge") return typeof value === "string" && feedWallClock(value) >= term.value;
  return value === term.value;
}

export async function startFakeOlis(options: FakeOlisOptions): Promise<FakeOlis> {
  const feed = loadFeed();
  const documentPaths = loadDocumentPaths();
  for (const [path, file] of Object.entries(options.strayDocuments ?? {})) {
    documentPaths.set(path, new URL(`documents/${file}`, fixtureDirectory));
  }
  const documentRequests: string[] = [];
  const failures = new Map<string, DocumentFailure[]>(
    Object.entries(options.documentFailures ?? {}).map(([sourceUrl, list]) => [new URL(sourceUrl).pathname, [...list]]),
  );
  const servedBytes = new Map<string, Uint8Array>();
  const servesDocuments = options.documents === true;
  const pageSize = options.pageSize ?? 5000;
  let withheldRows = options.withholdLastRows ?? 0;
  /** The one set that is short, or undefined when every set is. */
  let withheldSet: string | undefined;
  let behavior: FakeOlisBehavior = { kind: "answer" };
  let received: FakeOlisRequest[] = [];
  const supportedQueryOptions = new Set(["$filter", "$inlinecount", "$skiptoken"]);

  /** The rows of one entity set that match the request's `$filter`, as the feed stood at the clock's time. */
  function visibleRows(entitySet: string, filter: string | null): Row[] | { error: string } {
    const terms = filter === null ? [] : parseFilter(filter);
    if ("error" in terms) return terms;
    const known = feed.get(entitySet) ?? [];
    // A set with no row at all cannot say which properties its type has, so a filter on one is not refused.
    const sample = [...known, ...(options.strayRows?.[entitySet] ?? [])];
    for (const term of terms) {
      if (sample.length > 0 && !sample.some((row) => term.property in row)) {
        return { error: `Could not find a property named '${term.property}' on type '${entitySet}'.` };
      }
    }
    const now = pacificWallClock(options.clock.now());
    const rows = known.filter((row) => {
      if (!terms.every((term) => matches(row, term))) return false;
      const created = row["CreatedDate"];
      return typeof created !== "string" || feedWallClock(created) <= now;
    });
    return [...rows, ...(options.strayRows?.[entitySet] ?? [])];
  }

  /** A document, as OLIS serves one: the bytes of a PDF at the path of its `source_url`. */
  function handleDocument(url: URL, response: ServerResponse): void {
    // The pathname as the manifest writes it: percent-encoded, as the worker must have sent it.
    const path = url.pathname;
    documentRequests.push(path);
    const failure = failures.get(path)?.shift();
    if (failure !== undefined) {
      if (failure === "hang") return; // no answer: the client's timeout ends the request
      sendText(response, failure, "text/plain", `The fake OLIS fails this document with ${failure}.`);
      return;
    }
    const file = documentPaths.get(path);
    const made = servedBytes.get(path);
    if (!servesDocuments || (file === undefined && made === undefined)) {
      sendText(response, 404, "text/plain", "Not Found");
      return;
    }
    response.writeHead(200, { "content-type": "application/pdf", "cache-control": "private" });
    response.end(made ?? (file === undefined ? undefined : readFileSync(file)));
  }

  function handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const documentPath = url.pathname.toLowerCase();
    if (request.method === "GET" && (documentPath.startsWith("/liz/") || documentPath.startsWith("/autopubs/"))) {
      handleDocument(url, response);
      return;
    }
    const segments = url.pathname.split("/").filter((segment) => segment !== "");
    const isServiceRoot = serviceRoot.every((name, index) => segments[index]?.toLowerCase() === name);
    const entitySet = segments[2];
    if (request.method !== "GET" || !isServiceRoot || entitySet === undefined || !feed.has(entitySet)) {
      sendError(response, 404, `Resource not found for the segment '${entitySet ?? url.pathname}'.`);
      return;
    }
    received.push({
      entitySet,
      isCount: segments[3] === "$count",
      filter: url.searchParams.get("$filter"),
    });
    switch (behavior.kind) {
      case "answer":
        break;
      case "fail":
        sendError(response, behavior.status, "The fake OLIS was told to fail.");
        return;
      case "hang":
        return;
      case "drop-connection":
        request.socket.destroy();
        return;
      default:
        return behavior satisfies never;
    }
    for (const name of url.searchParams.keys()) {
      if (name === "$count") {
        sendError(
          response,
          400,
          "The query parameter '$count' begins with a system-reserved '$' character but is not recognized.",
        );
        return;
      }
      if (!supportedQueryOptions.has(name)) {
        sendError(response, 400, `The fake OLIS does not support the query option '${name}'.`);
        return;
      }
    }
    const rows = visibleRows(entitySet, url.searchParams.get("$filter"));
    if ("error" in rows) {
      sendError(response, 400, rows.error);
      return;
    }
    const wantsJson = /json/i.test(request.headers.accept ?? "");

    if (segments[3] === "$count") {
      if (wantsJson) {
        sendText(response, 415, "text/plain", "Unsupported media type requested.");
        return;
      }
      sendText(response, 200, "text/plain;charset=utf-8", String(rows.length));
      return;
    }
    if (segments.length > 3) {
      sendError(response, 404, `Resource not found for the segment '${segments[3] ?? ""}'.`);
      return;
    }
    if (!wantsJson) {
      sendText(
        response,
        200,
        "application/atom+xml;type=feed;charset=utf-8",
        `<?xml version="1.0" encoding="utf-8" standalone="yes"?><feed xmlns="http://www.w3.org/2005/Atom"><title type="text">${entitySet}</title></feed>`,
      );
      return;
    }

    const withheld = withheldSet === undefined || withheldSet === entitySet ? withheldRows : 0;
    const delivered = rows.slice(0, rows.length - withheld);
    const skip = Number(url.searchParams.get("$skiptoken") ?? 0);
    const body: Record<string, unknown> = {};
    if (url.searchParams.get("$inlinecount") === "allpages") body["odata.count"] = String(rows.length);
    body["value"] = delivered.slice(skip, skip + pageSize);
    const hasMorePages = skip + pageSize < delivered.length;
    if (hasMorePages || options.pagingFault !== undefined) {
      const filter = url.searchParams.get("$filter");
      const keep = filter === null ? "" : `$filter=${encodeURIComponent(filter).replaceAll("%27", "'")}&`;
      const next = options.pagingFault === "repeats-the-first-page" ? 0 : skip + pageSize;
      body["odata.nextLink"] = `../odataservice.svc/${entitySet}?${keep}$skiptoken=${next}`;
    }
    sendText(response, 200, "application/json;odata=nometadata;charset=utf-8", JSON.stringify(body));
  }

  const server = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/odata/odataservice.svc/`,
    origin: `http://127.0.0.1:${port}`,
    documentRequests: () => [...documentRequests],
    serveDocument: (path, bytes) => {
      servedBytes.set(path, bytes);
    },
    failDocuments: (sourceUrl, more) => {
      const path = new URL(sourceUrl).pathname;
      failures.set(path, [...(failures.get(path) ?? []), ...more]);
    },
    withholdLastRows: (count, entitySet) => {
      withheldRows = count;
      withheldSet = entitySet;
    },
    behave: (next) => {
      behavior = next;
    },
    addRows: (entitySet, rows) => {
      const known = feed.get(entitySet) ?? [];
      known.push(...rows);
      feed.set(entitySet, known);
    },
    amendRows: (entitySet, matchesRow, changes) => {
      for (const row of feed.get(entitySet) ?? []) {
        if (matchesRow(row)) Object.assign(row, changes);
      }
    },
    requests: () => [...received],
    forgetRequests: () => {
      received = [];
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
        server.closeAllConnections();
      }),
  };
}
