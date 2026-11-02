// How to read one entity set of the OLIS OData v3 feed, quirks included (docs/research/olis-odata.md
// section 1 and section 8; spec #1, "OLIS client").
import { z } from "zod";
import type { PulledEntitySet } from "#/packages/domain/documents.ts";
import type { MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import { pacificWallClock, type Timestamp } from "#/packages/time/pacific.ts";
import type { OlisClientOptions, PullRead } from "./options.ts";

/** A page that takes longer than this is an outage, not a slow answer (olis-odata.md gotcha 15). */
const REQUEST_TIMEOUT_MS = 60_000;

/** Every request carries a timeout combined with the caller's shutdown signal (src/CLAUDE.md, "Errors"). */
function bounded(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

/** The error's own code when it has one (a refused connection has `ECONNREFUSED`). */
function codeOf(error: Error): string | undefined {
  const cause = error.cause;
  const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
  return typeof code === "string" ? code : undefined;
}

/**
 * Sends one request. A transport failure (Node's fetch rejects with a TypeError "fetch failed" and the
 * system error as its cause) is rethrown with the reason in words, the code of the cause in brackets,
 * and the original as the cause, so whoever reports it need not know how fetch words its errors.
 * An abort (a timeout or a shutdown) is the caller's to explain, and passes through as it is.
 */
async function sendToOlis(options: OlisClientOptions, url: URL, init: RequestInit): Promise<Response> {
  try {
    return await options.fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted !== true && error instanceof TypeError && error.message === "fetch failed") {
      const code = codeOf(error);
      const reason = code === undefined ? "the connection to OLIS failed" : `the connection to OLIS failed (${code})`;
      throw new Error(reason, { cause: error });
    }
    throw error;
  }
}

async function readCount(options: OlisClientOptions, url: URL, signal: AbortSignal): Promise<number> {
  // /$count answers 415 to a JSON Accept header (docs/research/olis-odata.md section 1, verified for a
  // request that sent no Accept header). This request names no type of its own, but fetch adds
  // `accept: */*`, which RFC 9110 section 12.5.1 reads the same as no Accept header at all. That live
  // OLIS answers `*/*` with the count is therefore NOT verified: the fake OLIS accepts it because it is
  // what this client sends, so no seam-1 test can show it. The by-hand contract test against live OLIS
  // (test/CLAUDE.md, "Hermetic") is the check.
  const response = await sendToOlis(options, url, { signal: bounded(signal) });
  if (!response.ok) throw new Error(`OLIS answered ${response.status} to ${url.pathname}`);
  const text = (await response.text()).trim();
  if (!/^\d+$/.test(text)) throw new Error(`OLIS answered ${url.pathname} with something other than a count`);
  return Number(text);
}

/** How a read checks the rows it got against the feed's own count of them. */
export type CountCheck =
  /** Counts with the `/$count` path segment as well: a second request, for a pull that reads whole sets. */
  | "count-endpoint-and-inlinecount"
  /** Counts with the first page's `$inlinecount` alone: one request, for a read of one Measure's rows. */
  | "inlinecount";

/**
 * Reads every row of one entity set that matches a `$filter`, following the pages, and checks that
 * the rows read match the feed's own count of them. The feed has no `$count=true`: it counts with
 * `$inlinecount=allpages` (a string in the first page) and with the `/$count` path segment.
 */
export async function readEntitySet<Row>(
  options: OlisClientOptions,
  entitySet: PulledEntitySet,
  filter: string,
  rowSchema: z.ZodType<Row>,
  signal: AbortSignal,
  countCheck: CountCheck = "count-endpoint-and-inlinecount",
): Promise<Row[]> {
  const page = z.object({
    value: z.array(rowSchema),
    "odata.count": z.string().regex(/^\d+$/).optional(),
    "odata.nextLink": z.string().optional(),
  });

  let counted: number | undefined;
  if (countCheck === "count-endpoint-and-inlinecount") {
    const countUrl = new URL(`${entitySet}/$count`, options.baseUrl);
    countUrl.searchParams.set("$filter", filter);
    counted = await readCount(options, countUrl, signal);
  }

  const firstUrl = new URL(entitySet, options.baseUrl);
  firstUrl.searchParams.set("$filter", filter);
  firstUrl.searchParams.set("$inlinecount", "allpages");

  const rows: Row[] = [];
  let inlineCounted: number | undefined;
  for (let url: URL | undefined = firstUrl; url !== undefined;) {
    const response = await sendToOlis(options, url, {
      // Without a JSON Accept header an entity set comes back as Atom XML.
      headers: { accept: "application/json;odata=nometadata" },
      signal: bounded(signal),
    });
    if (!response.ok) throw new Error(`OLIS answered ${response.status} to ${url.pathname}`);
    const parsed = page.safeParse(await response.json());
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      throw new Error(`OLIS sent a page of ${entitySet} that is not what the client reads: ${problems.join("; ")}`, {
        cause: parsed.error,
      });
    }
    const body = parsed.data;
    rows.push(...body.value);
    if (inlineCounted === undefined && body["odata.count"] !== undefined) inlineCounted = Number(body["odata.count"]);
    // The loop ends only when a page has no next link, so a feed that keeps sending one is bounded here
    // (src/CLAUDE.md, "Errors"): every page must bring a row, and the rows may not pass the feed's count.
    const ceiling = counted ?? inlineCounted;
    if (ceiling !== undefined && rows.length > ceiling) {
      const counter = counted === undefined ? "$inlinecount" : "/$count";
      throw new Error(`OLIS sent more rows than the ${ceiling} it counted for ${entitySet} (${counter})`);
    }
    if (body.value.length === 0 && body["odata.nextLink"] !== undefined) {
      throw new Error(`OLIS sent an empty page of ${entitySet} with a next link`);
    }
    // The next link is relative to the page it came with (`../odataservice.svc/...`).
    url = body["odata.nextLink"] === undefined ? undefined : new URL(body["odata.nextLink"], url);
  }

  if (inlineCounted === undefined) throw new Error(`OLIS did not report an $inlinecount for ${entitySet}`);
  if (options.onSetRead !== undefined && countCheck === "count-endpoint-and-inlinecount") {
    // The count the rows miss, if they miss one: the pull decides what a short set means.
    const figure = counted !== undefined && rows.length !== counted ? counted : inlineCounted;
    options.onSetRead({ entitySet, counted: figure, read: rows.length });
    return rows;
  }
  if (rows.length !== (counted ?? inlineCounted) || rows.length !== inlineCounted) {
    const counts =
      counted === undefined
        ? `${inlineCounted} rows ($inlinecount)`
        : `${counted} rows (/$count) and ${inlineCounted} ($inlinecount)`;
    throw new Error(`Short read of ${entitySet}: OLIS counted ${counts}; read ${rows.length}`);
  }
  return rows;
}

/**
 * A read narrowed to one Measure, for the live lookup: the filter names the Session, the prefix and
 * the number, and the read counts with the first page's `$inlinecount` alone, one request for each
 * set. `also` adds one more term to the filter.
 */
export type MeasureScope = {
  kind: "measure";
  measure: MeasureKey;
  /** A further `$filter` term, such as `MeetingDate ge datetime'2025-01-29T09:00:00'`. */
  also?: string;
};

/** Which rows of a Session a read of a set asks for: a Pull's (`PullRead`) or one Measure's, for the live lookup. */
export type RowSelection = PullRead | MeasureScope;

/** An OData string literal: single quotes doubled. */
function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/**
 * The term that keeps the rows OLIS created or modified after a time. The feed's dates are Pacific wall-clock times
 * with no offset, so the time is written that way. A row with only one of the two dates (many sets have a null
 * ModifiedDate) is picked up by the other.
 */
function changedSinceTerm(since: Timestamp): string {
  const wallClock = pacificWallClock(new Date(Temporal.Instant.from(since).epochMilliseconds)).toString({
    smallestUnit: "second",
  });
  return `(CreatedDate gt datetime'${wallClock}' or ModifiedDate gt datetime'${wallClock}')`;
}

/**
 * Reads the rows of one Session of an entity set that the `selection` asks for: all of them, those changed since a time,
 * or the rows of one Measure of it. The feed is asked for one Session, but a row of another one is never taken for it:
 * measure numbers restart every Session, so SB 69 of one Session is not SB 69 of another, and a Legislator Code can name a
 * different person in another Session. Nor is a row of another Measure taken for the scope's. The selection is the
 * caller's to make: this reads whichever set it is given as it is asked to, with no rule about sets.
 */
export async function readSessionRows<
  Row extends { SessionKey: string; MeasurePrefix?: string | null; MeasureNumber?: number | null },
>(
  options: OlisClientOptions,
  entitySet: PulledEntitySet,
  session: SessionKey,
  rowSchema: z.ZodType<Row>,
  signal: AbortSignal,
  selection: RowSelection,
): Promise<Row[]> {
  switch (selection.kind) {
    case "whole":
      return readWholeSession(options, entitySet, session, [], rowSchema, signal);
    case "changed_since":
      return readWholeSession(options, entitySet, session, [changedSinceTerm(selection.since)], rowSchema, signal);
    case "above_id":
      // Only the FloorLetters reader reads above an id (floor-letters.ts); every other set is read by dates.
      throw new Error(`${entitySet} cannot be read above an id: its rows are read by their dates`);
    case "measure": {
      const { measure } = selection;
      const terms = [
        `SessionKey eq ${literal(session)}`,
        `MeasurePrefix eq ${literal(measure.prefix)}`,
        `MeasureNumber eq ${String(measure.number)}`,
        ...(selection.also === undefined ? [] : [selection.also]),
      ];
      const rows = await readEntitySet(options, entitySet, terms.join(" and "), rowSchema, signal, "inlinecount");
      return rows.filter(
        (row) =>
          row.SessionKey === session && row.MeasurePrefix === measure.prefix && row.MeasureNumber === measure.number,
      );
    }
    default:
      return selection satisfies never;
  }
}

/** The rows of the Session, narrowed by `also` terms, counted with `/$count` and `$inlinecount`: a Pull's read of a set. */
async function readWholeSession<Row extends { SessionKey: string }>(
  options: OlisClientOptions,
  entitySet: PulledEntitySet,
  session: SessionKey,
  also: readonly string[],
  rowSchema: z.ZodType<Row>,
  signal: AbortSignal,
): Promise<Row[]> {
  const filter = [`SessionKey eq ${literal(session)}`, ...also].join(" and ");
  const rows = await readEntitySet(options, entitySet, filter, rowSchema, signal);
  return rows.filter((row) => row.SessionKey === session);
}
