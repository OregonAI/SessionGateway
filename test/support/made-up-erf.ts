// A MADE-UP stand-in for a checkout of OregonAI's executive-regulatory-frameworks (ERF) repository,
// for testing the snapshot build script (scripts/snapshot/build.ts). The real checkout is not in CI
// and is never touched by a test. Everything here is invented: the agencies, the rules, the
// statutes and their links. Only the shape is ERF's, as read from a checkout on 2026-10-30:
//   _meta/catalog/agencies.yml   `organizations:` rows with slug, name, oar_chapter, ...
//   _meta/graph.json             `nodes` (id, doc_type, ...) and `edges` (from, to, type)
//   statutes/ors-*.md            one file per ORS section
// It is a real git repository with one commit, because the build script names the commit.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type GraphNode = { id: string; title: string; doc_type: string; status: string; path: string };
export type GraphEdge = { from: string; to: string; type: string };
export type MadeUpGraph = { note: string; nodes: GraphNode[]; edges: GraphEdge[] };

export const madeUpAgenciesYaml = `note: MADE UP for a test. Shaped like ERF's registry; none of these bodies exist.
source_url: https://example.invalid/rules
organizations:
- slug: made-up-environment-agency
  name: Made-Up Environment Agency
  name_basis: unverified-oar-title
  oar_name: Made-Up Environment Agency
  oar_chapter: '340'
  raw_index_name: Made-Up Env. Agency
  source_url: https://example.invalid/rules/oar_chapter_340
  parent_chapter: null
  relations: []
  das_agency_number: '340'
  enabling_authority: ORS 468.030
- slug: made-up-human-services
  name: Made-Up Human Services
  name_basis: unverified-oar-title
  oar_name: Made-Up Human Services
  oar_chapter: '407'
  raw_index_name: Made-Up Human Svcs
  source_url: https://example.invalid/rules/oar_chapter_407
  parent_chapter: null
  relations: []
  das_agency_number: '100'
  aliases:
  - MUHS
  - Made-Up Department of Human Services
- slug: made-up-human-services-child-welfare
  name: Made-Up Human Services, Child Welfare
  name_basis: unverified-oar-title
  oar_name: Made-Up Human Services, Child Welfare
  oar_chapter: '413'
  raw_index_name: Child Welfare
  source_url: https://example.invalid/rules/oar_chapter_413
  parent_chapter: null
  relations:
  - target: made-up-human-services
    source: oar-index
    kind: part_of
    basis: reviewed-absence
  enabling_authority: 'none: a multi-line
    note, as ERF writes some of them.'
- slug: made-up-advisory-council
  name: Made-Up Advisory Council
  name_basis: enabling-authority
  oar_name: null
  oar_chapter: null
  raw_index_name: Made-Up Advisory Council
  source_url: null
  parent_chapter: null
  relations: []
`;

function node(id: string, docType: string): GraphNode {
  const path =
    docType === "statute"
      ? `statutes/${id}.md`
      : docType === "rule"
        ? `rules/${id.split("-")[1] ?? ""}/${id.split("-")[2] ?? ""}/${id}.md`
        : `agencies/made-up/policies/${id}.md`;
  return { id, title: `Made up ${id}`, doc_type: docType, status: "current", path };
}

/** The made-up graph: four statutes, four rules, one policy, and the edges ERF writes between them. */
export function madeUpGraph(): MadeUpGraph {
  const statutes = ["ors-468.130", "ors-468.140", "ors-468a.010", "ors-409.711"];
  const rules = ["oar-340-012-0130", "oar-340-012-0170", "oar-407-001-0010", "oar-413-010-0000"];
  const implementsEdge = (from: string, to: string): GraphEdge[] => [
    { from, to, type: "implements" },
    { from: to, to: from, type: "implemented_by" },
  ];
  return {
    note: "MADE UP for a test.",
    nodes: [
      ...statutes.map((id) => node(id, "statute")),
      ...rules.map((id) => node(id, "rule")),
      node("das-10-000-01", "policy"),
    ],
    edges: [
      // Two rules of one agency implement one section, and one rule implements two: one agency, twice over.
      ...implementsEdge("oar-340-012-0130", "ors-468.130"),
      ...implementsEdge("oar-340-012-0170", "ors-468.130"),
      ...implementsEdge("oar-340-012-0130", "ors-468.140"),
      // Two agencies implement one section.
      ...implementsEdge("oar-407-001-0010", "ors-409.711"),
      ...implementsEdge("oar-413-010-0000", "ors-409.711"),
      // A policy is not a rule: it adds no agency to the table.
      ...implementsEdge("das-10-000-01", "ors-468a.010"),
      // A rule that implements a rule, and a section that cites another: neither is a rule -> section link.
      ...implementsEdge("oar-340-012-0170", "oar-340-012-0130"),
      { from: "ors-468.130", to: "ors-468.140", type: "related" },
    ],
  };
}

export type MadeUpErfOptions = {
  agenciesYaml?: string;
  graph?: MadeUpGraph;
  /** The files under statutes/. By default one for each statute node of the graph. */
  statuteFiles?: string[];
};

export type MadeUpErf = {
  path: string;
  /** The commit's SHA, as `git rev-parse HEAD` prints it. */
  commit: string;
  /** Changes a tracked file after the commit, so the checkout is no longer what the commit holds. */
  editAfterCommit(relativePath: string, text: string): void;
  /**
   * Gives a tracked file a new modification time without changing it. A plain `git status` then
   * refreshes git's index and writes it, which a read-only reader must not do.
   */
  touchAfterCommit(relativePath: string): void;
  remove(): void;
};

/** The commit date, pinned as UTC so a test can see the build script write it in Pacific time. */
export const madeUpCommitDateUtc = "2026-07-02T10:04:05+0000";

export function createMadeUpErf(options: MadeUpErfOptions = {}): MadeUpErf {
  const root = mkdtempSync(join(tmpdir(), "made-up-erf-"));
  const graph = options.graph ?? madeUpGraph();
  const write = (relativePath: string, text: string): void => {
    mkdirSync(dirname(join(root, relativePath)), { recursive: true });
    writeFileSync(join(root, relativePath), text);
  };
  write("_meta/catalog/agencies.yml", options.agenciesYaml ?? madeUpAgenciesYaml);
  write("_meta/graph.json", `${JSON.stringify(graph, null, 1)}\n`);
  const statuteFiles =
    options.statuteFiles ??
    graph.nodes.filter((entry) => entry.doc_type === "statute").map((entry) => `${entry.id}.md`);
  for (const file of statuteFiles) write(`statutes/${file}`, "Made up statute text.\n");
  write("statutes/_index.md", "# Statutes (made up)\n");
  write("statutes/CHANGELOG.md", "Made up.\n");

  // No global or system git configuration: a made-up repository must not depend on the machine's.
  const env = {
    PATH: process.env["PATH"] ?? "",
    HOME: root,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Made Up",
    GIT_AUTHOR_EMAIL: "made-up@example.invalid",
    GIT_COMMITTER_NAME: "Made Up",
    GIT_COMMITTER_EMAIL: "made-up@example.invalid",
    GIT_AUTHOR_DATE: madeUpCommitDateUtc,
    GIT_COMMITTER_DATE: madeUpCommitDateUtc,
  };
  const git = (...args: string[]): string => execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8" });
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "--no-gpg-sign", "-m", "Made-up ERF");
  return {
    path: root,
    commit: git("rev-parse", "HEAD").trim(),
    editAfterCommit: write,
    touchAfterCommit: (relativePath) => {
      const later = new Date(Date.now() + 60_000);
      utimesSync(join(root, relativePath), later, later);
    },
    remove: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
