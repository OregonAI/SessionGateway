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
//
// With `documents: true` it also serves the documents the feed links, as OLIS does: the bytes of each
// file in the fixture's manifest, at the path of the manifest's `source_url` (/liz/2025R1/Downloads/...),
// on the same port. It counts every document request, so a test can read how often the worker fetched
// a file from the harness and never from the database, and it can fail a chosen document once (a hang
// that outlasts the client's timeout, or an HTTP status) to show that a transient failure is retried.
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
   * set). They are counted too. A test adds them here, never to the committed fixture.
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
   * Serve the rows that link documents and the documents themselves. Off by default: extracting the
   * fixture's 278 PDFs takes seconds, so only a test that reads documents asks for them. When off,
   * those entity sets are served empty, as in a Session that has posted nothing yet.
   */
  documents?: boolean;
  /**
   * Documents served although no fixture row links them, by their path on the fake
   * (`/liz/2025R1/Downloads/...`), each as the bytes of a file under the fixture's `documents/`.
   * A test adds the feed row that links one through `strayRows`.
   */
  strayDocuments?: Record<string, string>;
};

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
   * Makes the next request for this document fail, once: `"hang"` gives no answer until the client
   * gives up on it, and a number answers that HTTP status. `source_url` is the manifest's.
   */
  failDocumentOnce(sourceUrl: string, failure: DocumentFailure): void;
  /** From now on, leave the last `count` rows of each set out of the pages (see `withholdLastRows`). */
  withholdLastRows(count: number): void;
  close(): Promise<void>;
};

const fixtureDirectory = new URL("../fixtures/olis-2025R1/", import.meta.url);
const feedDirectory = new URL("feed/", fixtureDirectory);
const serviceRoot = ["odata", "odataservice.svc"];

/** The entity sets whose rows link a document (a meeting row links its agenda). */
const documentEntitySets = new Set([
  "MeasureDocuments",
  "MeasureAnalysisDocuments",
  "CommitteeProposedAmendments",
  "CommitteeMeetingDocuments",
  "CommitteePublicTestimonies",
  "CommitteeMeetings",
]);

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

function loadFeed(): Map<string, Row[]> {
  const sets = new Map<string, Row[]>();
  for (const file of readdirSync(feedDirectory)) {
    if (!file.endsWith(".json")) continue;
    const rows: unknown = JSON.parse(readFileSync(new URL(file, feedDirectory), "utf8"));
    if (!Array.isArray(rows)) throw new Error(`${file} is not a JSON array`);
    sets.set(file.slice(0, -".json".length), rows as Row[]);
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

export async function startFakeOlis(options: FakeOlisOptions): Promise<FakeOlis> {
  const feed = loadFeed();
  const documentPaths = loadDocumentPaths();
  for (const [path, file] of Object.entries(options.strayDocuments ?? {})) {
    documentPaths.set(path, new URL(`documents/${file}`, fixtureDirectory));
  }
  const documentRequests: string[] = [];
  const failures = new Map<string, DocumentFailure>();
  const servesDocuments = options.documents === true;
  const pageSize = options.pageSize ?? 5000;
  let withheldRows = options.withholdLastRows ?? 0;
  const supportedQueryOptions = new Set(["$filter", "$inlinecount", "$skiptoken"]);

  /** The rows of one entity set that match the request's `$filter`, as the feed stood at the clock's time. */
  function visibleRows(entitySet: string, filter: string | null): Row[] | { error: string } {
    const sessionKey = filter === null ? undefined : /^SessionKey eq '([^']*)'$/.exec(filter)?.[1];
    if (filter !== null && sessionKey === undefined) {
      return { error: `The fake OLIS understands only "$filter=SessionKey eq '<key>'", not "${filter}".` };
    }
    const now = pacificWallClock(options.clock.now());
    const rows = (servesDocuments || !documentEntitySets.has(entitySet) ? (feed.get(entitySet) ?? []) : []).filter(
      (row) => {
        if (sessionKey !== undefined && row["SessionKey"] !== sessionKey) return false;
        const created = row["CreatedDate"];
        return typeof created !== "string" || feedWallClock(created) <= now;
      },
    );
    return [
      ...rows,
      ...(servesDocuments || !documentEntitySets.has(entitySet) ? (options.strayRows?.[entitySet] ?? []) : []),
    ];
  }

  /** A document, as OLIS serves one: the bytes of a PDF at the path of its `source_url`. */
  function handleDocument(url: URL, response: ServerResponse): void {
    // The pathname as the manifest writes it: percent-encoded, as the worker must have sent it.
    const path = url.pathname;
    documentRequests.push(path);
    const failure = failures.get(path);
    if (failure !== undefined) {
      failures.delete(path);
      if (failure === "hang") return; // no answer: the client's timeout ends the request
      sendText(response, failure, "text/plain", `The fake OLIS fails this document with ${failure}.`);
      return;
    }
    const file = documentPaths.get(path);
    if (!servesDocuments || file === undefined) {
      sendText(response, 404, "text/plain", "Not Found");
      return;
    }
    response.writeHead(200, { "content-type": "application/pdf", "cache-control": "private" });
    response.end(readFileSync(file));
  }

  function handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname.toLowerCase().startsWith("/liz/")) {
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

    const delivered = rows.slice(0, rows.length - withheldRows);
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
    failDocumentOnce: (sourceUrl, failure) => {
      failures.set(new URL(sourceUrl).pathname, failure);
    },
    withholdLastRows: (count) => {
      withheldRows = count;
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
