// Checks that the committed fixture is internally consistent.
//
//   node scripts/fixture/verify.ts [--fixture <dir>]
//
// Exits 0 when every manifest hash matches, every manifest entry's file exists, every file under
// documents/ is in the manifest, every document a fixture row links is in the manifest, and
// every key a fixture row references resolves to a row inside the fixture. Anything else prints
// one line per problem and exits 1. An entity set this script does not understand is a problem,
// never skipped.
//
// A reference that the full 2025R1 feed cannot resolve either ("Rep Neron" has no Legislators
// row) is accepted only if unresolved.json lists it; an entry there that matches no unresolved
// reference is a problem too, so the list is exactly the full cache's own gaps.
//
// Dependency-free: node: built-ins and relative .ts files only.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import {
  absentProperties,
  describeKey,
  entitySets,
  isRecord,
  isUnresolved,
  keyString,
  linkedDocumentUrl,
  requiredManifestStrings,
  rowKeyOf,
  targetKeyOf,
  unresolvedId,
  valuesOf,
} from "./schema.ts";
import type { Row, Unresolved } from "./schema.ts";

const defaultFixture = join(import.meta.dirname, "..", "..", "test", "fixtures", "olis-2025R1");

function parseArgs(args: string[]): string {
  let fixture = defaultFixture;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--fixture" && i + 1 < args.length) {
      fixture = args[i + 1] as string;
      i++;
    } else {
      console.error("usage: node scripts/fixture/verify.ts [--fixture <dir>]");
      exit(2);
    }
  }
  return fixture;
}

const fixtureDir = parseArgs(argv.slice(2));
const problems: string[] = [];
const problem = (line: string): void => {
  problems.push(line);
};

/** Parses a JSON file, reporting a missing or malformed file as a problem. */
function readJson(path: string, label: string): unknown {
  if (!existsSync(path)) {
    problem(`${label}: file does not exist`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    problem(`${label}: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Manifest: hashes, files, and nothing under documents/ that the manifest does not list.

const offsetTimestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;
const manifestPaths = new Set<string>();
const manifestUrls = new Set<string>();
let documentCount = 0;

function checkManifest(): void {
  const manifest = readJson(join(fixtureDir, "manifest.json"), "manifest.json");
  if (manifest === undefined) return;
  if (!isRecord(manifest) || !Array.isArray(manifest.documents)) {
    problem('manifest.json: expected {"documents": [...]}');
    return;
  }
  manifest.documents.forEach((entry: unknown, index: number) => {
    const at = `manifest.json documents[${index}]`;
    if (!isRecord(entry)) {
      problem(`${at}: not an object`);
      return;
    }
    documentCount++;
    for (const field of requiredManifestStrings) {
      if (typeof entry[field] !== "string" || entry[field] === "") problem(`${at}: ${field} is missing`);
    }
    const path = entry.path;
    if (typeof path !== "string" || path === "") return;
    const name = `manifest entry ${path}`;
    if (typeof entry.source_url === "string") manifestUrls.add(entry.source_url);
    if (typeof entry.retrieved_at === "string") {
      if (!offsetTimestamp.test(entry.retrieved_at) || Number.isNaN(Date.parse(entry.retrieved_at))) {
        problem(`${name}: retrieved_at "${entry.retrieved_at}" is not ISO 8601 with an offset`);
      }
    }
    const segments = path.split("/");
    if (path.startsWith("/") || segments.includes("..") || segments.includes("")) {
      problem(`${name}: path must be relative to the fixture directory, with no .. or empty parts`);
      return;
    }
    manifestPaths.add(path);
    const file = join(fixtureDir, ...segments);
    if (!existsSync(file) || !statSync(file).isFile()) {
      problem(`${name}: file does not exist`);
      return;
    }
    const bytes = readFileSync(file);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (typeof entry.sha256 === "string" && entry.sha256 !== actual) {
      problem(`${name}: sha256 mismatch (manifest ${entry.sha256.slice(0, 12)}..., file ${actual.slice(0, 12)}...)`);
    }
    if (entry.bytes !== undefined && entry.bytes !== bytes.length) {
      problem(`${name}: bytes mismatch (manifest ${String(entry.bytes)}, file ${bytes.length})`);
    }
  });
}

function filesUnder(dir: string, prefix: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) found.push(...filesUnder(full, relative));
    else found.push(relative);
  }
  return found;
}

function checkDocumentsAreListed(): void {
  const dir = join(fixtureDir, "documents");
  if (!existsSync(dir)) return;
  for (const relative of filesUnder(dir, "documents")) {
    if (!manifestPaths.has(relative)) problem(`${relative}: file is under documents/ but not in the manifest`);
  }
}

// ---------------------------------------------------------------------------------------------
// Feed rows: every reference resolves inside the fixture, or is a listed gap of the full cache.

const feedRows = new Map<string, Row[]>();

function loadFeed(): void {
  const feedDir = join(fixtureDir, "feed");
  if (!existsSync(feedDir)) {
    problem("feed/: directory does not exist");
    return;
  }
  for (const file of readdirSync(feedDir).sort()) {
    if (!file.endsWith(".json")) {
      problem(`feed/${file}: only <EntitySet>.json files belong in feed/`);
      continue;
    }
    const entitySet = file.slice(0, -".json".length);
    if (entitySets[entitySet] === undefined) {
      problem(`feed/${file}: verify does not understand entity set "${entitySet}", so it cannot check its references`);
      continue;
    }
    const rows = readJson(join(feedDir, file), `feed/${file}`);
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || !rows.every(isRecord)) {
      problem(`feed/${file}: expected a JSON array of row objects`);
      continue;
    }
    feedRows.set(entitySet, rows);
  }
}

function loadUnresolved(): Map<string, { entry: Unresolved; used: boolean }> {
  const entries = new Map<string, { entry: Unresolved; used: boolean }>();
  const path = join(fixtureDir, "unresolved.json");
  if (!existsSync(path)) return entries;
  const content = readJson(path, "unresolved.json");
  if (content === undefined) return entries;
  if (!isRecord(content) || !Array.isArray(content.unresolved)) {
    problem('unresolved.json: expected {"unresolved": [...]}');
    return entries;
  }
  content.unresolved.forEach((entry: unknown, index: number) => {
    if (!isUnresolved(entry)) {
      problem(`unresolved.json unresolved[${index}]: needs entity_set, row_key, property, refers_to, target_key and a reason`);
      return;
    }
    if (entitySets[entry.entity_set] === undefined) {
      problem(`unresolved.json unresolved[${index}]: unknown entity set "${entry.entity_set}"`);
      return;
    }
    entries.set(unresolvedId(entry.entity_set, entry.row_key, entry.property, entry.refers_to), { entry, used: false });
  });
  return entries;
}

function checkReferences(): { references: number; accepted: number } {
  const keysPresent = new Map<string, Set<string>>();
  for (const [entitySet, rows] of feedRows) {
    const spec = entitySets[entitySet];
    const present = new Set<string>();
    // A property the schema reads that a row lacks altogether is not a null: it would skip the
    // reference it carries without a word. Report it once per property, not once per row.
    const absent = new Map<string, { why: string; count: number; first: number }>();
    rows.forEach((row, index) => {
      const lacking = absentProperties(entitySet, row);
      for (const { property, why } of lacking) {
        const seen = absent.get(property) ?? { why, count: 0, first: index };
        seen.count++;
        absent.set(property, seen);
      }
      if (spec === undefined || lacking.some(({ property }) => spec.key.includes(property))) return;
      const values = valuesOf(row, spec.key);
      if (values === null) problem(`feed/${entitySet}.json row ${index}: a key property (${spec.key.join(", ")}) is null`);
      else present.add(keyString(values));
    });
    for (const [property, { why, count, first }] of absent) {
      problem(`feed/${entitySet}.json: ${count} row(s) lack the property ${property}, which the schema reads as: ${why} (the first is row ${first}). A property that is null is fine; one that is absent means the row is not the feed's own.`);
    }
    keysPresent.set(entitySet, present);
  }

  const unresolved = loadUnresolved();
  const dangling = new Map<string, { target: string; key: Record<string, unknown>; sources: string[] }>();
  let references = 0;
  let accepted = 0;

  for (const [entitySet, rows] of feedRows) {
    const spec = entitySets[entitySet];
    if (spec === undefined) continue;
    for (const row of rows) {
      for (const ref of spec.refs) {
        const target = targetKeyOf(row, ref);
        if (target === null) continue;
        references++;
        const targetSpec = entitySets[ref.to];
        const present = keysPresent.get(ref.to);
        const found = targetSpec !== undefined && present !== undefined && present.has(keyString(targetSpec.key.map((p) => target[p])));
        const rowKey = rowKeyOf(entitySet, row);
        const id = unresolvedId(entitySet, rowKey, ref.property, ref.to);
        const listed = unresolved.get(id);
        if (found) {
          if (listed !== undefined) problem(`unresolved.json lists ${describeKey(entitySet, rowKey)}.${ref.property} -> ${ref.to}, but it resolves inside the fixture: remove the entry`);
          continue;
        }
        if (listed !== undefined) {
          listed.used = true;
          accepted++;
          if (JSON.stringify(listed.entry.target_key) !== JSON.stringify(target)) {
            problem(`unresolved.json entry for ${describeKey(entitySet, rowKey)}.${ref.property} names target_key ${JSON.stringify(listed.entry.target_key)}, but the row refers to ${JSON.stringify(target)}`);
          }
          continue;
        }
        const danglingKey = `${ref.to}|${keyString(Object.values(target))}`;
        const existing = dangling.get(danglingKey) ?? { target: ref.to, key: target, sources: [] };
        existing.sources.push(`${describeKey(entitySet, rowKey)}.${ref.property}`);
        dangling.set(danglingKey, existing);
      }
    }
  }

  for (const { target, key, sources } of dangling.values()) {
    const examples = sources.slice(0, 2).join("; ");
    const more = sources.length > 2 ? `; and ${sources.length - 2} more` : "";
    problem(`${describeKey(target, key)} is not in the fixture, but ${sources.length} row(s) refer to it: ${examples}${more}`);
  }
  for (const { entry, used } of unresolved.values()) {
    if (!used) problem(`unresolved.json lists ${describeKey(entry.entity_set, entry.row_key)}.${entry.property} -> ${entry.refers_to}, but no fixture row has that unresolved reference: remove the entry`);
  }
  return { references, accepted };
}

// ---------------------------------------------------------------------------------------------
// Documents the rows link: each must have a manifest entry with the same source_url.

function checkLinkedDocuments(): void {
  for (const [entitySet, rows] of feedRows) {
    for (const row of rows) {
      let url: string | null;
      try {
        url = linkedDocumentUrl(entitySet, row);
      } catch {
        problem(`${describeKey(entitySet, rowKeyOf(entitySet, row))}: its document URL is not a valid URL`);
        continue;
      }
      if (url !== null && !manifestUrls.has(url)) {
        problem(`${describeKey(entitySet, rowKeyOf(entitySet, row))} links ${url}, which has no manifest entry`);
      }
    }
  }
}

checkManifest();
checkDocumentsAreListed();
loadFeed();
const { references, accepted } = checkReferences();
checkLinkedDocuments();

if (problems.length > 0) {
  for (const line of problems) console.error(`verify: ${line}`);
  console.error(`verify: FAILED with ${problems.length} problem(s) in ${fixtureDir}`);
  exit(1);
}
const rowCount = [...feedRows.values()].reduce((sum, rows) => sum + rows.length, 0);
console.log(
  `verify: OK ${fixtureDir}: ${feedRows.size} feed files, ${rowCount} rows, ${references} references checked ` +
    `(${accepted} accepted as unresolved in the full cache), ${documentCount} documents hashed`,
);
