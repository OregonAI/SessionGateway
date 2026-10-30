// Reads a local checkout of OregonAI's executive-regulatory-frameworks (ERF) repository into the
// snapshot's file shape (src/packages/oregonai-snapshot). This is the only code that knows ERF's
// layout, and it is a build-time script: nothing under src/ imports it (.dependency-cruiser.cjs).
//
// What it reads, all committed files of the checkout:
//   _meta/catalog/agencies.yml   the agency registry: slug, name, aliases, oar_chapter, das_agency_number
//   _meta/graph.json             ERF's own graph of its documents: `nodes` and `edges`
//   statutes/ors-*.md            one file per ORS section ERF holds
// and the checkout's HEAD commit, which is the snapshot's version.
//
// The checkout is read-only here: git runs with GIT_OPTIONAL_LOCKS=0 so that `git status` does not
// refresh the index, and nothing is written.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { orsChapterOf, parseOrsSectionId, type OrsSectionId } from "#/packages/domain/oregonai.ts";
import { formatPacific } from "#/packages/time/pacific.ts";
import { parseSnapshot, type SnapshotFile } from "#/packages/oregonai-snapshot/index.ts";
import { compareCodeUnits } from "./order.ts";

const REGISTRY_FILE = "_meta/catalog/agencies.yml";
const GRAPH_FILE = "_meta/graph.json";
const STATUTES_FOLDER = "statutes";

function git(checkout: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", checkout, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`\`git ${args.join(" ")}\` failed in "${checkout}": is it a checkout of the ERF repository?`, {
      cause: error,
    });
  }
}

const registrySchema = z.object({
  organizations: z.array(
    z.object({
      slug: z.string(),
      name: z.string().min(1),
      aliases: z.array(z.string().min(1)).optional(),
      oar_chapter: z.string().nullable(),
      das_agency_number: z.string().nullable().optional(),
    }),
  ),
});

const graphSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), doc_type: z.string() })),
  edges: z.array(z.object({ from: z.string(), to: z.string(), type: z.string() })),
});

/** The OAR chapter of a rule, from its id: `oar-340-012-0130` is in chapter 340. */
const ruleIdPattern = /^oar-(\d+)-\d+-\d+[a-z]?$/;

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read "${path}" as JSON`, { cause: error });
  }
}

function sample(items: Iterable<string>, count = 5): string {
  return [...items].slice(0, count).join(", ");
}

/**
 * The snapshot of the checkout at this path, as the JSON file holds it. Throws, naming the problem, if
 * the checkout is not what a commit can describe or its files disagree with each other.
 */
export function readErfSnapshot(checkout: string): SnapshotFile {
  // `git -C <path>` finds the nearest repository above the path. A folder that holds ERF's files but is
  // not itself the checkout (an export unpacked into another project's ignored cache folder, say) would
  // be given that other repository's commit, and `git status` does not list ignored files to say so.
  const root = git(checkout, ["rev-parse", "--show-toplevel"]).trim();
  if (realpathSync(root) !== realpathSync(checkout)) {
    throw new Error(
      `"${checkout}" is not the root of a git checkout: git finds the repository at "${root}", and that repository's commit would not describe these files. Give the folder that holds ERF's .git.`,
    );
  }
  // The commit names the data only if the data is the commit's.
  const changed = git(checkout, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    REGISTRY_FILE,
    GRAPH_FILE,
    STATUTES_FOLDER,
  ]).trim();
  if (changed !== "") {
    throw new Error(
      `The checkout has uncommitted changes in files the snapshot reads, so its commit would not describe the data:\n${changed}`,
    );
  }
  const commit = git(checkout, ["rev-parse", "HEAD"]).trim();
  const committed = git(checkout, ["log", "-1", "--format=%cI", "HEAD"]).trim();
  const commitDate = formatPacific(new Date(committed));

  let registryYaml: unknown;
  try {
    registryYaml = parseYaml(readFileSync(join(checkout, REGISTRY_FILE), "utf8"));
  } catch (error) {
    throw new Error(`Could not read "${REGISTRY_FILE}" as YAML`, { cause: error });
  }
  const registry = registrySchema.parse(registryYaml).organizations;
  const graph = graphSchema.parse(readJsonFile(join(checkout, GRAPH_FILE)));

  // The list of ORS sections is the statute nodes of ERF's graph. The files under statutes/ are the
  // same list: ERF's catalog marks exactly those sections "ingested". A checkout where the two differ
  // has a stale graph or a stray file, and either would make the list wrong.
  const documentTypeOf = new Map(graph.nodes.map((node) => [node.id, node.doc_type]));
  const sections: OrsSectionId[] = [];
  for (const node of graph.nodes) {
    if (node.doc_type !== "statute") continue;
    const section = parseOrsSectionId(node.id);
    if (section === undefined) throw new Error(`The graph has a statute whose id is not an ORS section id: ${node.id}`);
    sections.push(section);
  }
  const filed = new Set(
    readdirSync(join(checkout, STATUTES_FOLDER))
      .filter((name) => /^ors-.*\.md$/.test(name))
      .map((name) => name.slice(0, -".md".length)),
  );
  const listed = new Set<string>(sections);
  const missingFiles = [...listed].filter((id) => !filed.has(id));
  const missingNodes = [...filed].filter((id) => !listed.has(id));
  if (missingFiles.length > 0 || missingNodes.length > 0) {
    throw new Error(
      `${STATUTES_FOLDER}/ and ${GRAPH_FILE} list different ORS sections: ${missingFiles.length} graph nodes have no file (${sample(missingFiles)}) and ${missingNodes.length} files have no node (${sample(missingNodes)})`,
    );
  }

  // The chapter-to-agency table: a rule belongs to the registry row whose OAR chapter is the rule's, and
  // each `implements` edge from a rule to an ORS section puts that agency in the section's chapter.
  const agencyOfChapter = new Map<string, string>();
  for (const row of registry) {
    if (row.oar_chapter === null) continue;
    const other = agencyOfChapter.get(row.oar_chapter);
    if (other !== undefined) {
      throw new Error(`The registry gives OAR chapter ${row.oar_chapter} to both ${other} and ${row.slug}`);
    }
    agencyOfChapter.set(row.oar_chapter, row.slug);
  }
  const agenciesOfOrsChapter = new Map<string, Set<string>>();
  const unplaced = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type !== "implements") continue;
    const fromType = documentTypeOf.get(edge.from);
    const toType = documentTypeOf.get(edge.to);
    if (fromType === undefined || toType === undefined) {
      throw new Error(`The graph has an edge from ${edge.from} to ${edge.to} that names a node it does not list`);
    }
    if (fromType !== "rule" || toType !== "statute") continue;
    const oarChapter = ruleIdPattern.exec(edge.from)?.[1];
    const agency = oarChapter === undefined ? undefined : agencyOfChapter.get(oarChapter);
    if (agency === undefined) {
      unplaced.add(edge.from);
      continue;
    }
    const section = parseOrsSectionId(edge.to);
    if (section === undefined) throw new Error(`The graph has a statute whose id is not an ORS section id: ${edge.to}`);
    const chapter = orsChapterOf(section);
    const agencies = agenciesOfOrsChapter.get(chapter) ?? new Set<string>();
    agencies.add(agency);
    agenciesOfOrsChapter.set(chapter, agencies);
  }
  if (unplaced.size > 0) {
    throw new Error(
      `${unplaced.size} rules implement ORS sections but their OAR chapter is not in the registry (${sample(unplaced)}). The table would leave their agencies out.`,
    );
  }

  const file: SnapshotFile = {
    formatVersion: 1,
    version: { source: "executive-regulatory-frameworks", commit, commitDate },
    agencies: registry
      .map((row) => ({
        slug: row.slug,
        name: row.name,
        aliases: row.aliases ?? [],
        oarChapter: row.oar_chapter,
        dasAgencyNumber: row.das_agency_number ?? null,
      }))
      .sort((a, b) => compareCodeUnits(a.slug, b.slug)),
    orsSections: sections.sort(compareCodeUnits),
    chapterAgencies: Object.fromEntries(
      [...agenciesOfOrsChapter]
        .sort(([a], [b]) => compareCodeUnits(a, b))
        .map(([chapter, agencies]) => [chapter, [...agencies].sort(compareCodeUnits)]),
    ),
  };
  parseSnapshot(file);
  return file;
}
