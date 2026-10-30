// Rebuilds the committed 2025R1 fixture from the gitignored feed cache, measures.txt and the
// download cache. The same inputs give byte-identical output: rows keep the cache's order, JSON
// formatting is fixed, and every timestamp comes from the download cache, never from now.
//
//   node scripts/fixture/build.ts --cache <dir> [--offline] [--plan] [--fixture <dir>]
//
// <dir> holds olis-2025R1/feed/ (the feed cache), olis-2025R1/reports/ (the Statutes Affected
// Table) and olis-2025R1/downloads/ (this script's own download cache). A document the download
// cache lacks is fetched from OLIS once and then kept, with its source_url and retrieval time
// beside it; it is never fetched again. --offline never fetches: a missing document is an error
// that names it. --plan prints what would be fetched and an estimate, fetches nothing and writes
// nothing. --fixture overrides the output directory (default test/fixtures/olis-2025R1); it also
// holds measures.txt.
//
// Dependency-free: node: built-ins and relative .ts files only.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import {
  documentLinks,
  entitySets,
  keyString,
  linkedDocumentUrl,
  makeUnresolved,
  rowKeyOf,
  targetKeyOf,
} from "./schema.ts";
import type { LinkedBy, ManifestEntry, Row, Unresolved } from "./schema.ts";

const SESSION = "2025R1";
const OLIS_ORIGIN = "https://olis.oregonlegislature.gov/";
const defaultFixture = join(import.meta.dirname, "..", "..", "test", "fixtures", "olis-2025R1");

// The one download run must stay small and polite. These limits stop it before it starts.
const MAX_DOCUMENTS = 500;
const MAX_FIXTURE_BYTES = 100_000_000;
const MIN_GAP_MS = 1_000; // between the end of one response and the next request
const REQUEST_TIMEOUT_MS = 120_000;
const RETRY_WAITS_MS = [3_000, 9_000, 27_000]; // three retries, each wait longer than the last
const MAX_REDIRECTS = 3;
const MAX_FAILURES_IN_A_ROW = 5; // a streak means something systemic: stop instead of hammering OLIS

// The Statutes Affected Table is not on OLIS and no feed row links it. The source_url comes from
// docs/research/olis-odata.md section 5; the cache's .hdr file has the response headers only.
const ARTABLES = {
  url: "https://www.oregonlegislature.gov/AutoPubs/artables2025R1.pdf",
  file: "artables2025R1.pdf",
  path: "documents/reports/artables2025R1.pdf",
  note:
    "The Statutes Affected Table, published by Legislative Counsel outside OLIS. No feed row links it " +
    "(olis-odata.md section 5), so linked_by is empty.",
};

/** An expected failure: printed as one message, with no stack. */
class BuildError extends Error {}

type Args = { cache: string; offline: boolean; plan: boolean; fixture: string };

function parseArgs(args: string[]): Args {
  const parsed: Args = { cache: "", offline: false, plan: false, fixture: defaultFixture };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--offline") parsed.offline = true;
    else if (arg === "--plan") parsed.plan = true;
    else if (arg === "--cache" && i + 1 < args.length) parsed.cache = args[++i] as string;
    else if (arg === "--fixture" && i + 1 < args.length) parsed.fixture = args[++i] as string;
    else throw new BuildError(`unknown argument ${String(arg)}`);
  }
  if (parsed.cache === "") throw new BuildError("usage: node scripts/fixture/build.ts --cache <dir> [--offline] [--plan] [--fixture <dir>]");
  if (parsed.offline && parsed.plan) throw new BuildError("--offline and --plan do not combine: --plan already fetches nothing");
  return parsed;
}

// ---------------------------------------------------------------------------------------------
// measures.txt

type Chosen = { prefix: string; number: number };

/** One Measure per line, with a comment saying why: `SB 69  # why it was chosen`. */
function readMeasures(path: string): Chosen[] {
  if (!existsSync(path)) throw new BuildError(`${path} does not exist: it lists the Measures to include`);
  const chosen: Chosen[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const match = /^([A-Za-z]+)\s*(\d+)\s*(?:#\s*(.*))?$/.exec(line);
    if (match === null) throw new BuildError(`measures.txt line ${index + 1}: expected "SB 69  # why", got "${line}"`);
    const [, prefix, number, comment] = match;
    if (comment === undefined || comment.trim() === "") {
      throw new BuildError(`measures.txt line ${index + 1}: ${prefix} ${number} has no comment saying why it was chosen`);
    }
    const entry = { prefix: (prefix as string).toUpperCase(), number: Number(number) };
    if (chosen.some((c) => c.prefix === entry.prefix && c.number === entry.number)) {
      throw new BuildError(`measures.txt line ${index + 1}: ${entry.prefix} ${entry.number} is listed twice`);
    }
    chosen.push(entry);
  });
  if (chosen.length === 0) throw new BuildError("measures.txt lists no Measures");
  return chosen;
}

// ---------------------------------------------------------------------------------------------
// Row selection: the rows about the chosen Measures, plus the rows they point at. The closure
// runs one way. A row pulled in by a reference must itself be about a chosen Measure (or about
// none); otherwise the build stops instead of quietly pulling in another Measure.

type Selection = { included: Map<string, number[]>; unresolved: Unresolved[] };

function loadFeed(feedDir: string): Map<string, Row[]> {
  // unresolved.json says which references the FULL cache cannot resolve. That is only true if the
  // cache is full: a missing file would turn every reference into that entity set into a false gap.
  const lacking = Object.keys(entitySets).filter((entitySet) => !existsSync(join(feedDir, `${entitySet}.json`)));
  if (lacking.length > 0) {
    throw new BuildError(
      `the feed cache ${feedDir} lacks ${lacking.map((entitySet) => `${entitySet}.json`).join(", ")}. ` +
        `The build needs the full ${SESSION} feed, because a missing file would make every reference into it look like a gap of the full cache.`,
    );
  }
  const feed = new Map<string, Row[]>();
  for (const entitySet of Object.keys(entitySets)) {
    const path = join(feedDir, `${entitySet}.json`);
    const rows: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(rows)) throw new BuildError(`${path}: expected a JSON array`);
    feed.set(entitySet, rows as Row[]);
  }
  return feed;
}

function select(feed: Map<string, Row[]>, chosen: Chosen[]): Selection {
  const chosenKeys = new Set(chosen.map((c) => `${c.prefix} ${c.number}`));
  const isChosen = (row: Row): boolean => row.SessionKey === SESSION && chosenKeys.has(`${String(row.MeasurePrefix)} ${String(row.MeasureNumber)}`);
  const hasMeasure = (row: Row): boolean => row.MeasurePrefix !== null && row.MeasurePrefix !== undefined && row.MeasureNumber !== null && row.MeasureNumber !== undefined;

  const included = new Map<string, Set<number>>();
  const queue: Array<[string, number]> = [];
  const add = (entitySet: string, index: number): void => {
    let members = included.get(entitySet);
    if (members === undefined) included.set(entitySet, (members = new Set()));
    if (members.has(index)) return;
    members.add(index);
    queue.push([entitySet, index]);
  };

  // Seed: every row about a chosen Measure, in every entity set that has a Measure.
  for (const [entitySet, spec] of Object.entries(entitySets)) {
    if (!spec.aboutMeasure) continue;
    (feed.get(entitySet) ?? []).forEach((row, index) => {
      if (isChosen(row)) add(entitySet, index);
    });
  }
  for (const c of chosen) {
    const exists = (feed.get("Measures") as Row[]).some((r) => isChosen(r) && r.MeasurePrefix === c.prefix && r.MeasureNumber === c.number);
    if (!exists) throw new BuildError(`measures.txt: ${c.prefix} ${c.number} has no Measures row in the ${SESSION} feed cache`);
  }

  // Follow references. Lookup indexes are built on first use, for the target sets only.
  const indexes = new Map<string, Map<string, number>>();
  const indexOf = (entitySet: string): Map<string, number> => {
    let index = indexes.get(entitySet);
    if (index === undefined) {
      index = new Map();
      const spec = entitySets[entitySet] as { key: string[] };
      (feed.get(entitySet) ?? []).forEach((row, i) => {
        const values = spec.key.map((p) => row[p]);
        if (!values.some((v) => v === null || v === undefined)) index?.set(keyString(values), i);
      });
      indexes.set(entitySet, index);
    }
    return index;
  };

  const unresolved: Array<{ gap: Unresolved; rowIndex: number }> = [];
  for (let head = 0; head < queue.length; head++) {
    const [entitySet, rowIndex] = queue[head] as [string, number];
    const spec = entitySets[entitySet] as (typeof entitySets)[string];
    const row = (feed.get(entitySet) as Row[])[rowIndex] as Row;
    for (const ref of spec.refs) {
      const target = targetKeyOf(row, ref);
      if (target === null) continue;
      const targetSpec = entitySets[ref.to] as (typeof entitySets)[string];
      const targetIndex = indexOf(ref.to).get(keyString(targetSpec.key.map((p) => target[p])));
      if (targetIndex === undefined) {
        unresolved.push({ rowIndex, gap: makeUnresolved(entitySet, row, ref, target) });
        continue;
      }
      const targetRow = (feed.get(ref.to) as Row[])[targetIndex] as Row;
      if (targetSpec.aboutMeasure && hasMeasure(targetRow) && !isChosen(targetRow)) {
        throw new BuildError(
          `${entitySet} ${JSON.stringify(rowKeyOf(entitySet, row))} refers to ${ref.to} ${JSON.stringify(target)}, ` +
            `which is about ${String(targetRow.MeasurePrefix)} ${String(targetRow.MeasureNumber)}, not in measures.txt. ` +
            "The closure does not pull in other Measures: add that Measure on purpose, or drop the chosen one.",
        );
      }
      add(ref.to, targetIndex);
    }
  }

  const sorted = new Map<string, number[]>();
  for (const [entitySet, members] of included) sorted.set(entitySet, [...members].sort((a, b) => a - b));
  // Stable order for the unresolved list: entity set order of the schema, then cache row order.
  const setOrder = Object.keys(entitySets);
  unresolved.sort(
    (a, b) =>
      setOrder.indexOf(a.gap.entity_set) - setOrder.indexOf(b.gap.entity_set) ||
      a.rowIndex - b.rowIndex ||
      a.gap.property.localeCompare(b.gap.property) ||
      a.gap.refers_to.localeCompare(b.gap.refers_to),
  );
  return { included: sorted, unresolved: unresolved.map((u) => u.gap) };
}

// ---------------------------------------------------------------------------------------------
// Documents the selected rows link

type Doc = {
  stem: string;
  url: string;
  /** From the DocumentLink: the mean size of this kind of document. */
  meanBytes: number;
  linkedBy: LinkedBy[];
};

function collectDocuments(feed: Map<string, Row[]>, selection: Selection): Doc[] {
  const byUrl = new Map<string, Doc>();
  const byStem = new Map<string, string>();
  for (const [entitySet, link] of Object.entries(documentLinks)) {
    const rows = feed.get(entitySet) as Row[];
    for (const index of selection.included.get(entitySet) ?? []) {
      const row = rows[index] as Row;
      let url: string | null;
      try {
        url = linkedDocumentUrl(entitySet, row);
      } catch {
        throw new BuildError(`${entitySet} ${JSON.stringify(rowKeyOf(entitySet, row))}: document URL "${link.url(row)}" is not a valid URL`);
      }
      if (url === null) continue;
      if (!url.startsWith(OLIS_ORIGIN)) {
        throw new BuildError(`${entitySet} ${JSON.stringify(rowKeyOf(entitySet, row))}: ${url} is not under ${OLIS_ORIGIN}; only OLIS URLs are fetched`);
      }
      const stem = `${link.kind}/${link.stem(row)}`;
      const clash = byStem.get(stem);
      if (clash !== undefined && clash !== url) throw new BuildError(`documents ${clash} and ${url} would both be stored as ${stem}`);
      byStem.set(stem, url);
      const doc = byUrl.get(url) ?? { stem, url, meanBytes: link.meanBytes, linkedBy: [] };
      doc.linkedBy.push({ entity_set: entitySet, row_key: rowKeyOf(entitySet, row) });
      byUrl.set(url, doc);
    }
  }
  return [...byUrl.values()].sort((a, b) => (a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// The download cache: <cache>/olis-2025R1/downloads/<kind>/<stem> with <stem>.meta.json beside it

type CacheMeta = {
  source_url: string;
  retrieved_at: string;
  status: number;
  content_type: string;
  bytes: number;
  sha256: string;
  final_url?: string;
};

const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const utcStamp = (millis: number): string => `${new Date(millis).toISOString().slice(0, 19)}+00:00`;

function cachedDocument(downloadsDir: string, doc: Doc): { meta: CacheMeta; file: string } | null {
  const file = join(downloadsDir, ...doc.stem.split("/"));
  const metaFile = `${file}.meta.json`;
  if (!existsSync(file) || !existsSync(metaFile)) return null;
  let meta: CacheMeta;
  try {
    meta = JSON.parse(readFileSync(metaFile, "utf8")) as CacheMeta;
  } catch {
    throw new BuildError(`download cache entry ${metaFile} is not valid JSON: delete the entry and rebuild`);
  }
  const bytes = readFileSync(file);
  if (meta.source_url !== doc.url || meta.bytes !== bytes.length || meta.sha256 !== sha256Of(bytes)) {
    throw new BuildError(`download cache entry ${file} does not match its ${metaFile}: delete the pair and rebuild`);
  }
  return { meta, file };
}

type Fetched = { body: Buffer; contentType: string; finalUrl: string; at: number };

/** Marks a failure worth retrying: a timeout, a network error or a 5xx. */
class TransientError extends Error {}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let lastResponseEnd = 0;

/** What went wrong, including the network error's cause (ECONNREFUSED and the like). */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
  return `${error.name}: ${error.message}${cause}`;
}

/**
 * One document, one request at a time, at least MIN_GAP_MS after the previous response ended.
 * Redirects are followed by hand so each hop stays under OLIS_ORIGIN and keeps the same gap.
 */
async function fetchOnce(url: string): Promise<Fetched> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!current.startsWith(OLIS_ORIGIN)) throw new BuildError(`redirected outside OLIS to ${current}`);
    const wait = lastResponseEnd + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "user-agent": "SessionGateway-fixture-build (+https://github.com/OregonAI/SessionGateway)",
          accept: "application/pdf, */*",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (location === null) throw new BuildError(`HTTP ${response.status} with no Location`);
        current = new URL(location, current).href;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status >= 500) throw new TransientError(`HTTP ${response.status}`);
        throw new BuildError(`HTTP ${response.status}`);
      }
      const body = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      if (/^text\/html/i.test(contentType)) throw new BuildError("OLIS answered with HTML, not a document");
      return { body, contentType, finalUrl: current, at: Date.now() };
    } catch (error) {
      if (error instanceof BuildError || error instanceof TransientError) throw error;
      // fetch() rejects on network errors and when our AbortSignal times out, mid-body included.
      throw new TransientError(describeFailure(error));
    } finally {
      lastResponseEnd = Date.now();
    }
  }
  throw new BuildError(`more than ${MAX_REDIRECTS} redirects`);
}

type RunStats = { fetched: number; reused: number; retries: number; failures: string[]; bytes: number };

async function fetchMissing(downloadsDir: string, missing: Doc[], stats: RunStats): Promise<void> {
  let done = 0;
  let streak = 0;
  for (const doc of missing) {
    done++;
    const started = Date.now();
    let fetched: Fetched | null = null;
    let lastProblem = "";
    for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
      try {
        fetched = await fetchOnce(doc.url);
        break;
      } catch (error) {
        if (error instanceof TransientError && attempt < RETRY_WAITS_MS.length) {
          stats.retries++;
          lastProblem = error.message;
          console.log(`  retry ${attempt + 1}/${RETRY_WAITS_MS.length} for ${doc.stem}: ${lastProblem}`);
          await sleep(RETRY_WAITS_MS[attempt] as number);
          continue;
        }
        lastProblem = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    if (fetched === null) {
      stats.failures.push(`${doc.url}: ${lastProblem}`);
      console.log(`[${done}/${missing.length}] FAILED ${doc.stem}: ${lastProblem}`);
      if (++streak >= MAX_FAILURES_IN_A_ROW) {
        throw new BuildError(`${streak} documents in a row failed (last: ${lastProblem}): stopping the run. Failed so far:\n  ${stats.failures.join("\n  ")}`);
      }
      continue;
    }
    streak = 0;
    const file = join(downloadsDir, ...doc.stem.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    // Body first, then the sidecar: an entry counts as cached only when both exist and agree.
    writeFileSync(`${file}.part`, fetched.body);
    renameSync(`${file}.part`, file);
    const meta: CacheMeta = {
      source_url: doc.url,
      retrieved_at: utcStamp(fetched.at),
      status: 200,
      content_type: fetched.contentType,
      bytes: fetched.body.length,
      sha256: sha256Of(fetched.body),
    };
    if (fetched.finalUrl !== doc.url) meta.final_url = fetched.finalUrl;
    writeFileSync(`${file}.meta.json.part`, `${JSON.stringify(meta, null, 2)}\n`);
    renameSync(`${file}.meta.json.part`, `${file}.meta.json`);
    stats.fetched++;
    stats.bytes += fetched.body.length;
    console.log(`[${done}/${missing.length}] fetched ${doc.stem} ${fetched.body.length} B in ${Date.now() - started} ms`);
    if (stats.bytes > MAX_FIXTURE_BYTES) {
      throw new BuildError(`downloaded ${stats.bytes} bytes, over the ${MAX_FIXTURE_BYTES} byte limit: stopping`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Output

const extensionFor = (contentType: string, bytes: Buffer): string => {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const known: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/tiff": ".tif",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/plain": ".txt",
  };
  if (known[type] !== undefined) return known[type] as string;
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-" ? ".pdf" : ".bin";
};

function readArtables(reportsDir: string): { entry: ManifestEntry; file: string } {
  const file = join(reportsDir, ARTABLES.file);
  const headers = join(reportsDir, "artables2025R1.hdr");
  for (const needed of [file, headers]) {
    if (!existsSync(needed)) throw new BuildError(`${needed} is missing: the Statutes Affected Table comes from the reports cache and is never fetched`);
  }
  const header = (name: string): string | undefined => {
    const line = readFileSync(headers, "utf8")
      .split(/\r?\n/)
      .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
    return line?.slice(name.length + 1).trim();
  };
  const date = header("Date");
  if (date === undefined || Number.isNaN(Date.parse(date))) throw new BuildError(`${headers} has no usable Date header`);
  const bytes = readFileSync(file);
  const length = header("Content-Length");
  if (length !== undefined && Number(length) !== bytes.length) {
    throw new BuildError(`${file} is ${bytes.length} bytes but ${headers} says Content-Length ${length}`);
  }
  return {
    file,
    entry: {
      path: ARTABLES.path,
      source_url: ARTABLES.url,
      retrieved_at: utcStamp(Date.parse(date)),
      sha256: sha256Of(bytes),
      bytes: bytes.length,
      content_type: header("Content-Type") ?? "application/pdf",
      linked_by: [],
      note: ARTABLES.note,
    },
  };
}

/** One row per line keeps the diff of a rebuild readable and the formatting fixed. */
const rowsFile = (rows: Row[]): string => `[\n${rows.map((row) => `  ${JSON.stringify(row)}`).join(",\n")}\n]\n`;
const jsonFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

async function main(): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const cacheRoot = join(args.cache, `olis-${SESSION}`);
  const downloadsDir = join(cacheRoot, "downloads");

  const chosen = readMeasures(join(args.fixture, "measures.txt"));
  const feed = loadFeed(join(cacheRoot, "feed"));
  const selection = select(feed, chosen);
  const docs = collectDocuments(feed, selection);
  const artables = readArtables(join(cacheRoot, "reports"));

  const rowCount = [...selection.included.values()].reduce((sum, rows) => sum + rows.length, 0);
  console.log(
    `${chosen.length} Measures -> ${rowCount} feed rows in ${selection.included.size} entity sets, ` +
      `${selection.unresolved.length} references the full cache cannot resolve, ${docs.length} linked documents`,
  );

  const cached = new Map<Doc, { meta: CacheMeta; file: string }>();
  const missing: Doc[] = [];
  for (const doc of docs) {
    const hit = cachedDocument(downloadsDir, doc);
    if (hit === null) missing.push(doc);
    else cached.set(doc, hit);
  }
  const estimate =
    missing.reduce((sum, doc) => sum + doc.meanBytes, 0) + [...cached.values()].reduce((sum, hit) => sum + hit.meta.bytes, 0);
  console.log(
    `documents: ${docs.length} linked, ${cached.size} in the download cache, ${missing.length} ${args.offline ? "missing" : "to fetch"}; ` +
      `estimated fixture documents ${megabytes(estimate)} (means from olis-odata.md section 7)`,
  );

  if (args.plan) {
    for (const doc of missing) console.log(`  would fetch ${doc.stem}  ${doc.url}`);
  }
  if (missing.length > MAX_DOCUMENTS || estimate > MAX_FIXTURE_BYTES) {
    throw new BuildError(
      `STOP: ${missing.length} documents to fetch (limit ${MAX_DOCUMENTS}), estimated ${megabytes(estimate)} (limit ${megabytes(MAX_FIXTURE_BYTES)}). Nothing was fetched.`,
    );
  }
  if (args.plan) return;

  if (args.offline && missing.length > 0) {
    throw new BuildError(
      `--offline: ${missing.length} document(s) are not in the download cache ${downloadsDir}:\n` +
        missing.map((doc) => `  ${doc.stem}  ${doc.url}`).join("\n"),
    );
  }

  const stats: RunStats = { fetched: 0, reused: cached.size, retries: 0, failures: [], bytes: 0 };
  if (missing.length > 0) {
    console.log(`fetching ${missing.length} documents from ${OLIS_ORIGIN}, one at a time`);
    try {
      await fetchMissing(downloadsDir, missing, stats);
    } finally {
      console.log(
        `download summary: fetched=${stats.fetched} reused=${stats.reused} retries=${stats.retries} ` +
          `failures=${stats.failures.length} bytes=${stats.bytes}`,
      );
    }
    if (stats.failures.length > 0) {
      throw new BuildError(`${stats.failures.length} document(s) could not be fetched; run again to fetch only those:\n  ${stats.failures.join("\n  ")}`);
    }
    for (const doc of missing) {
      const hit = cachedDocument(downloadsDir, doc);
      if (hit === null) throw new BuildError(`${doc.stem} is not in the download cache after fetching`);
      cached.set(doc, hit);
    }
  }

  // Assemble the manifest and the files to copy.
  const copies: Array<{ from: string; to: string }> = [];
  const entries: ManifestEntry[] = [];
  const seenPaths = new Set<string>();
  for (const doc of docs) {
    const hit = cached.get(doc) as { meta: CacheMeta; file: string };
    const bytes = readFileSync(hit.file);
    const path = `documents/${doc.stem}${extensionFor(hit.meta.content_type, bytes)}`;
    if (seenPaths.has(path)) throw new BuildError(`two documents would be written to ${path}`);
    seenPaths.add(path);
    copies.push({ from: hit.file, to: path });
    entries.push({
      path,
      source_url: doc.url,
      retrieved_at: hit.meta.retrieved_at,
      sha256: hit.meta.sha256,
      bytes: hit.meta.bytes,
      content_type: hit.meta.content_type,
      linked_by: doc.linkedBy,
    });
  }
  copies.push({ from: artables.file, to: artables.entry.path });
  entries.push(artables.entry);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total > MAX_FIXTURE_BYTES) throw new BuildError(`the documents total ${total} bytes, over the ${MAX_FIXTURE_BYTES} byte limit`);

  // Write: the generated parts are replaced wholesale; measures.txt and README.md stay.
  rmSync(join(args.fixture, "feed"), { recursive: true, force: true });
  rmSync(join(args.fixture, "documents"), { recursive: true, force: true });
  mkdirSync(join(args.fixture, "feed"), { recursive: true });
  for (const entitySet of Object.keys(entitySets)) {
    const indexes = selection.included.get(entitySet);
    if (indexes === undefined || indexes.length === 0) continue;
    const rows = feed.get(entitySet) as Row[];
    writeFileSync(join(args.fixture, "feed", `${entitySet}.json`), rowsFile(indexes.map((i) => rows[i] as Row)));
  }
  for (const { from, to } of copies) {
    const destination = join(args.fixture, ...to.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(from, destination);
    if (statSync(destination).size !== statSync(from).size) throw new BuildError(`copy of ${from} to ${destination} is the wrong size`);
  }
  writeFileSync(join(args.fixture, "manifest.json"), jsonFile({ documents: entries }));
  writeFileSync(join(args.fixture, "unresolved.json"), jsonFile({ unresolved: selection.unresolved }));

  console.log(
    `wrote ${args.fixture}: ${selection.included.size} feed files, ${rowCount} rows, ${entries.length} documents ` +
      `(${megabytes(total)}), ${selection.unresolved.length} unresolved references listed`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof BuildError) {
    console.error(`build: ${error.message}`);
    exit(error.message.startsWith("STOP") ? 2 : 1);
  }
  throw error;
});
