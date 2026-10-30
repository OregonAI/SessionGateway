// How to read one entity set of the OLIS OData v3 feed, quirks included (docs/research/olis-odata.md
// section 1 and section 8; spec #1, "OLIS client").
import { z } from "zod";
import type { OlisClientOptions } from "./options.ts";

/** A page that takes longer than this is an outage, not a slow answer (olis-odata.md gotcha 15). */
const REQUEST_TIMEOUT_MS = 60_000;

/** Every request carries a timeout combined with the caller's shutdown signal (src/CLAUDE.md, "Errors"). */
function bounded(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

async function readCount(options: OlisClientOptions, url: URL, signal: AbortSignal): Promise<number> {
  // /$count answers 415 to a JSON Accept header (docs/research/olis-odata.md section 1, verified for a
  // request that sent no Accept header). This request names no type of its own, but fetch adds
  // `accept: */*`, which RFC 9110 section 12.5.1 reads the same as no Accept header at all. That live
  // OLIS answers `*/*` with the count is therefore NOT verified: the fake OLIS accepts it because it is
  // what this client sends, so no seam-1 test can show it. The by-hand contract test against live OLIS
  // (test/CLAUDE.md, "Hermetic") is the check.
  const response = await options.fetch(url, { signal: bounded(signal) });
  if (!response.ok) throw new Error(`OLIS answered ${response.status} to ${url.pathname}`);
  const text = (await response.text()).trim();
  if (!/^\d+$/.test(text)) throw new Error(`OLIS answered ${url.pathname} with something other than a count`);
  return Number(text);
}

/**
 * Reads every row of one entity set that matches a `$filter`, following the pages, and checks that
 * the rows read match the feed's own count of them. The feed has no `$count=true`: it counts with
 * `$inlinecount=allpages` (a string in the first page) and with the `/$count` path segment.
 */
export async function readEntitySet<Row>(
  options: OlisClientOptions,
  entitySet: string,
  filter: string,
  rowSchema: z.ZodType<Row>,
  signal: AbortSignal,
): Promise<Row[]> {
  const page = z.object({
    value: z.array(rowSchema),
    "odata.count": z.string().regex(/^\d+$/).optional(),
    "odata.nextLink": z.string().optional(),
  });

  const countUrl = new URL(`${entitySet}/$count`, options.baseUrl);
  countUrl.searchParams.set("$filter", filter);
  const counted = await readCount(options, countUrl, signal);

  const firstUrl = new URL(entitySet, options.baseUrl);
  firstUrl.searchParams.set("$filter", filter);
  firstUrl.searchParams.set("$inlinecount", "allpages");

  const rows: Row[] = [];
  let inlineCounted: number | undefined;
  for (let url: URL | undefined = firstUrl; url !== undefined;) {
    const response = await options.fetch(url, {
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
    // The loop ends only when a page has no next link, so a feed that keeps sending one is bounded here
    // (src/CLAUDE.md, "Errors"): every page must bring a row, and the rows may not pass the feed's count.
    if (rows.length > counted) {
      throw new Error(`OLIS sent more rows than the ${counted} it counted for ${entitySet} (/$count)`);
    }
    if (body.value.length === 0 && body["odata.nextLink"] !== undefined) {
      throw new Error(`OLIS sent an empty page of ${entitySet} with a next link`);
    }
    if (inlineCounted === undefined && body["odata.count"] !== undefined) inlineCounted = Number(body["odata.count"]);
    // The next link is relative to the page it came with (`../odataservice.svc/...`).
    url = body["odata.nextLink"] === undefined ? undefined : new URL(body["odata.nextLink"], url);
  }

  if (inlineCounted === undefined) throw new Error(`OLIS did not report an $inlinecount for ${entitySet}`);
  if (rows.length !== counted || rows.length !== inlineCounted) {
    throw new Error(
      `Short read of ${entitySet}: OLIS counted ${counted} rows (/$count) and ${inlineCounted} ($inlinecount); read ${rows.length}`,
    );
  }
  return rows;
}
