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
  documentedGapReason,
  documentLinks,
  entitySets,
  isLinkedBy,
  isRecord,
  isUnresolved,
  keyString,
  legislatorCodesWithoutRow,
  linkedDocumentUrl,
  requiredManifestStrings,
  rowKeyOf,
  statutesAffectedTablePath,
  targetKeyOf,
  unresolvedId,
  valuesOf,
} from "./schema.ts";
import type { LinkedBy, Row, Unresolved } from "./schema.ts";

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
/** The manifest entries whose links checkLinkedDocuments() resolves against the feed rows. */
const linkedEntries: Array<{ path: string; sourceUrl: string; linkedBy: LinkedBy[] }> = [];
let documentCount = 0;

function checkManifest(): void {
  const manifest = readJson(join(fixtureDir, "manifest.json"), "manifest.json");
  if (manifest === undefined) return;
  if (!isRecord(manifest) || !Array.isArray(manifest["documents"])) {
    problem('manifest.json: expected {"documents": [...]}');
    return;
  }
  manifest["documents"].forEach((entry: unknown, index: number) => {
    const at = `manifest.json documents[${index}]`;
    if (!isRecord(entry)) {
      problem(`${at}: not an object`);
      return;
    }
    documentCount++;
    for (const field of requiredManifestStrings) {
      if (typeof entry[field] !== "string" || entry[field] === "") problem(`${at}: ${field} is missing`);
    }
    const linkedBy = entry["linked_by"];
    const linkedByOk = Array.isArray(linkedBy) && linkedBy.every(isLinkedBy);
    if (!linkedByOk)
      problem(`${at}: linked_by must list {entity_set, row_key} objects, empty for a document no row links`);
    const path = entry["path"];
    if (typeof path !== "string" || path === "") return;
    const name = `manifest entry ${path}`;
    if (typeof entry["source_url"] === "string") {
      manifestUrls.add(entry["source_url"]);
      if (linkedByOk) linkedEntries.push({ path, sourceUrl: entry["source_url"], linkedBy });
    }
    if (typeof entry["retrieved_at"] === "string") {
      if (!offsetTimestamp.test(entry["retrieved_at"]) || Number.isNaN(Date.parse(entry["retrieved_at"]))) {
        problem(`${name}: retrieved_at "${entry["retrieved_at"]}" is not ISO 8601 with an offset`);
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
    if (typeof entry["sha256"] === "string" && entry["sha256"] !== actual) {
      problem(`${name}: sha256 mismatch (manifest ${entry["sha256"].slice(0, 12)}..., file ${actual.slice(0, 12)}...)`);
    }
    if (entry["bytes"] !== undefined && entry["bytes"] !== bytes.length) {
      problem(
        `${name}: bytes mismatch (manifest ${typeof entry["bytes"] === "number" ? entry["bytes"] : JSON.stringify(entry["bytes"])}, file ${bytes.length})`,
      );
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
/** Each entity set's rows by key, for resolving references and the manifest's linked_by. */
const rowsByKey = new Map<string, Map<string, Row>>();

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
  if (!isRecord(content) || !Array.isArray(content["unresolved"])) {
    problem('unresolved.json: expected {"unresolved": [...]}');
    return entries;
  }
  content["unresolved"].forEach((entry: unknown, index: number) => {
    if (!isUnresolved(entry)) {
      problem(
        `unresolved.json unresolved[${index}]: needs entity_set, row_key, property, refers_to, target_key and a reason`,
      );
      return;
    }
    if (entitySets[entry.entity_set] === undefined) {
      problem(`unresolved.json unresolved[${index}]: unknown entity set "${entry.entity_set}"`);
      return;
    }
    // Only a gap of the full cache that the research documents, with its documented reason. Verify
    // has no cache to look in, so this is all that stops a hand edit from excusing a broken reference.
    if (documentedGapReason(entry.entity_set, entry.property, entry.refers_to, entry.target_key) !== entry.reason) {
      problem(
        `unresolved.json unresolved[${index}]: ${describeKey(entry.refers_to, entry.target_key)} is not a documented gap of the full cache, or its reason is not the documented one. ` +
          `The documented gaps are the Legislator Codes ${legislatorCodesWithoutRow.join(" and ")} (olis-odata.md section 8, gotcha 4) and a CommitteeMembers row whose LegislatorCode matches no Legislators row (gotcha 5).`,
      );
      return;
    }
    entries.set(unresolvedId(entry.entity_set, entry.row_key, entry.property, entry.refers_to), { entry, used: false });
  });
  return entries;
}

function checkReferences(): { references: number; accepted: number } {
  for (const [entitySet, rows] of feedRows) {
    const spec = entitySets[entitySet];
    const present = new Map<string, Row>();
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
      if (values === null)
        problem(`feed/${entitySet}.json row ${index}: a key property (${spec.key.join(", ")}) is null`);
      else present.set(keyString(values), row);
    });
    for (const [property, { why, count, first }] of absent) {
      problem(
        `feed/${entitySet}.json: ${count} row(s) lack the property ${property}, which the schema reads as: ${why} (the first is row ${first}). A property that is null is fine; one that is absent means the row is not the feed's own.`,
      );
    }
    rowsByKey.set(entitySet, present);
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
        const present = rowsByKey.get(ref.to);
        const found =
          targetSpec !== undefined &&
          present !== undefined &&
          present.has(keyString(targetSpec.key.map((p) => target[p])));
        const rowKey = rowKeyOf(entitySet, row);
        const id = unresolvedId(entitySet, rowKey, ref.property, ref.to);
        const listed = unresolved.get(id);
        if (found) {
          if (listed !== undefined)
            problem(
              `unresolved.json lists ${describeKey(entitySet, rowKey)}.${ref.property} -> ${ref.to}, but it resolves inside the fixture: remove the entry`,
            );
          continue;
        }
        if (listed !== undefined) {
          listed.used = true;
          accepted++;
          if (JSON.stringify(listed.entry.target_key) !== JSON.stringify(target)) {
            problem(
              `unresolved.json entry for ${describeKey(entitySet, rowKey)}.${ref.property} names target_key ${JSON.stringify(listed.entry.target_key)}, but the row refers to ${JSON.stringify(target)}`,
            );
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
    problem(
      `${describeKey(target, key)} is not in the fixture, but ${sources.length} row(s) refer to it: ${examples}${more}`,
    );
  }
  for (const { entry, used } of unresolved.values()) {
    if (!used)
      problem(
        `unresolved.json lists ${describeKey(entry.entity_set, entry.row_key)}.${entry.property} -> ${entry.refers_to}, but no fixture row has that unresolved reference: remove the entry`,
      );
  }
  return { references, accepted };
}

// ---------------------------------------------------------------------------------------------
// Documents and the rows that link them, in both directions: every document a fixture row links
// has a manifest entry, and every manifest entry is linked by the rows it names, which are in the
// fixture. Only the Statutes Affected Table may have no row.

/** The URL a row links, null when it links none, undefined when its link property is not a URL. */
function linkedUrl(entitySet: string, row: Row): string | null | undefined {
  try {
    return linkedDocumentUrl(entitySet, row);
  } catch {
    return undefined;
  }
}

function checkLinkedDocuments(): void {
  const linking = new Map<string, Array<{ entitySet: string; row: Row }>>();
  for (const [entitySet, rows] of feedRows) {
    for (const row of rows) {
      const url = linkedUrl(entitySet, row);
      if (url === undefined) {
        problem(`${describeKey(entitySet, rowKeyOf(entitySet, row))}: its document URL is not a valid URL`);
        continue;
      }
      if (url === null) continue;
      if (!manifestUrls.has(url))
        problem(`${describeKey(entitySet, rowKeyOf(entitySet, row))} links ${url}, which has no manifest entry`);
      linking.set(url, [...(linking.get(url) ?? []), { entitySet, row }]);
    }
  }

  const absentRows = new Map<string, { count: number; example: string }>();
  for (const { path, sourceUrl, linkedBy } of linkedEntries) {
    const named = new Set<string>();
    for (const { entity_set: entitySet, row_key: rowKey } of linkedBy) {
      const spec = entitySets[entitySet];
      if (spec === undefined || documentLinks[entitySet] === undefined) {
        problem(
          `manifest entry ${path}: linked_by names "${entitySet}", which is not an entity set whose rows link documents`,
        );
        continue;
      }
      const id = keyString(spec.key.map((p) => rowKey[p]));
      named.add(`${entitySet}|${id}`);
      const row = rowsByKey.get(entitySet)?.get(id);
      if (row === undefined) {
        const seen = absentRows.get(entitySet) ?? {
          count: 0,
          example: `${describeKey(entitySet, rowKey)} (for ${path})`,
        };
        seen.count++;
        absentRows.set(entitySet, seen);
        continue;
      }
      const url = linkedUrl(entitySet, row);
      if (url !== sourceUrl) {
        problem(
          `manifest entry ${path}: linked_by names ${describeKey(entitySet, rowKey)}, but that row links ${url === null ? "no document" : String(url)}, not ${sourceUrl}`,
        );
      }
    }
    const rows = linking.get(sourceUrl) ?? [];
    for (const { entitySet, row } of rows) {
      const rowKey = rowKeyOf(entitySet, row);
      const spec = entitySets[entitySet] as { key: string[] };
      if (!named.has(`${entitySet}|${keyString(spec.key.map((p) => rowKey[p]))}`)) {
        problem(
          `manifest entry ${path}: ${describeKey(entitySet, rowKey)} links this document, but linked_by does not name it`,
        );
      }
    }
    if (linkedBy.length === 0 && rows.length === 0 && path !== statutesAffectedTablePath) {
      problem(
        `manifest entry ${path}: no fixture row links ${sourceUrl}, and only ${statutesAffectedTablePath} may be unlinked`,
      );
    }
  }
  for (const [entitySet, { count, example }] of absentRows) {
    problem(
      `manifest.json: linked_by names ${count} row(s) of ${entitySet} that are not in the fixture, e.g. ${example}`,
    );
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
