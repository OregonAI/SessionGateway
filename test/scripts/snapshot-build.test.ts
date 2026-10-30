// The snapshot build script (scripts/snapshot/build.ts), run as a child process the way an operator
// runs it, against a MADE-UP checkout of the ERF repository (test/support/made-up-erf.ts).
//
// This is not one of the two seams spec #1 agreed (test/CLAUDE.md): no MCP tool shows the registry,
// the section list or the chapter table yet, so the script's command line is the only place the
// ticket's first box, "a build step produces the snapshot ... with a version", can be seen. It is
// recorded as a decision in the ticket's report. The expected values are literals written from the
// made-up rows, never computed by the script's own rules.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMadeUpErf, madeUpGraph, type MadeUpErf, type MadeUpGraph } from "../support/made-up-erf.ts";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function madeUpErf(options: Parameters<typeof createMadeUpErf>[0] = {}): MadeUpErf {
  const erf = createMadeUpErf(options);
  cleanups.push(() => {
    erf.remove();
  });
  return erf;
}

function outputFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "snapshot-build-"));
  cleanups.push(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, "snapshot.json");
}

type Finished = { status: number | null; stdout: string; stderr: string };

/** Runs the build script with this command line, in this process's zone (not Pacific) and no network. */
function build(args: string[]): Finished {
  const finished = spawnSync(process.execPath, ["scripts/snapshot/build.ts", ...args], {
    env: { PATH: process.env["PATH"] ?? "", TZ: process.env["TZ"] ?? "UTC" },
    encoding: "utf8",
  });
  return { status: finished.status, stdout: finished.stdout, stderr: finished.stderr };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("the snapshot build script", () => {
  it("writes the registry, the ORS section ids and the chapter-to-agency table, versioned by the checkout's commit", () => {
    const erf = madeUpErf();
    const out = outputFile();

    const finished = build(["--erf", erf.path, "--out", out]);

    expect(finished.status, finished.stderr).toBe(0);
    expect(readJson(out)).toEqual({
      formatVersion: 1,
      // The commit date was made at 2026-07-02T10:04:05 UTC, which is 03:04:05 Pacific daylight time.
      version: {
        source: "executive-regulatory-frameworks",
        commit: erf.commit,
        commitDate: "2026-07-02T03:04:05-07:00",
      },
      agencies: [
        {
          slug: "made-up-advisory-council",
          name: "Made-Up Advisory Council",
          aliases: [],
          oarChapter: null,
          dasAgencyNumber: null,
        },
        {
          slug: "made-up-environment-agency",
          name: "Made-Up Environment Agency",
          aliases: [],
          oarChapter: "340",
          dasAgencyNumber: "340",
        },
        {
          slug: "made-up-human-services",
          name: "Made-Up Human Services",
          aliases: ["MUHS", "Made-Up Department of Human Services"],
          oarChapter: "407",
          dasAgencyNumber: "100",
        },
        {
          slug: "made-up-human-services-child-welfare",
          name: "Made-Up Human Services, Child Welfare",
          aliases: [],
          oarChapter: "413",
          dasAgencyNumber: null,
        },
      ],
      orsSections: ["ors-409.711", "ors-468.130", "ors-468.140", "ors-468a.010"],
      // Chapter 409: two agencies' rules implement ors-409.711. Chapter 468: one agency's rules implement
      // two sections, once each. Chapter 468A: only a policy implements ors-468a.010, so it has no row.
      chapterAgencies: {
        "ors-chapter-409": ["made-up-human-services", "made-up-human-services-child-welfare"],
        "ors-chapter-468": ["made-up-environment-agency"],
      },
    });
  });

  it("writes nothing and says why when the checkout has uncommitted changes to a file it reads", () => {
    const erf = madeUpErf();
    // The data on disk is no longer the commit's, so the commit would be a false version for it.
    erf.editAfterCommit("_meta/graph.json", '{"note":"edited after the commit","nodes":[],"edges":[]}\n');
    const out = outputFile();

    const finished = build(["--erf", erf.path, "--out", out]);

    expect(finished.status).toBe(1);
    expect(finished.stderr).toContain("_meta/graph.json");
    expect(finished.stderr).toContain("uncommitted");
    expect(existsSync(out)).toBe(false);
  });

  it("leaves the checkout as it found it: git's index is not rewritten", () => {
    const erf = madeUpErf();
    erf.touchAfterCommit("statutes/ors-468.130.md");
    const indexFile = join(erf.path, ".git", "index");
    const sha256 = (): string => createHash("sha256").update(readFileSync(indexFile)).digest("hex");
    const before = sha256();

    const finished = build(["--erf", erf.path, "--out", outputFile()]);

    expect(finished.status, finished.stderr).toBe(0);
    expect(sha256()).toBe(before);
    expect(existsSync(join(erf.path, ".git", "index.lock"))).toBe(false);
  });

  it("stops and names the rule when a rule that implements an ORS section is in an OAR chapter the registry lacks", () => {
    const graph = madeUpGraph();
    // oar-999-001-0001 is made up: chapter 999 is in none of the registry's rows.
    graph.nodes.push({
      id: "oar-999-001-0001",
      title: "Made up",
      doc_type: "rule",
      status: "current",
      path: "rules/999/001/oar-999-001-0001.md",
    });
    graph.edges.push({ from: "oar-999-001-0001", to: "ors-409.711", type: "implements" });
    const erf = madeUpErf({ graph });
    const out = outputFile();

    const finished = build(["--erf", erf.path, "--out", out]);

    expect(finished.status).toBe(1);
    expect(finished.stderr).toContain("oar-999-001-0001");
    expect(existsSync(out)).toBe(false);
  });

  it("stops and names the section when the statutes folder and the graph list different ORS sections", () => {
    // The graph lists ors-468.140 and the folder has no file for it.
    const erf = madeUpErf({ statuteFiles: ["ors-468.130.md", "ors-468a.010.md", "ors-409.711.md"] });
    const out = outputFile();

    const finished = build(["--erf", erf.path, "--out", out]);

    expect(finished.status).toBe(1);
    expect(finished.stderr).toContain("ors-468.140");
    expect(existsSync(out)).toBe(false);
  });
});

// --trim-to reads the committed 2025R1 fixture (test/fixtures/olis-2025R1): its documents and Measures say
// which ORS chapters and Agencies it touches. The ERF checkout is still made up. The fixture's own words are
// the oracle for what it touches (measures.txt and the spec): SB 69 adds to "ORS chapter 657B", amends ORS
// 659A.159 and 653.616 (the Statutes Affected Table, spec #1 case (b)); HB 3795 amends ORS 409.711 and
// 418.808; SB 69's Fiscal Impact Statement says "Government Unit(s) Affected: Bureau of Labor and
// Industries, Employment Department, Judicial Department, Department of Justice".
describe("the snapshot build script with --trim-to the 2025R1 fixture", () => {
  const fixture = "test/fixtures/olis-2025R1";

  function trimmedErf(): MadeUpErf {
    const sections = ["ors-653.616", "ors-659a.159", "ors-657b.010", "ors-409.711", "ors-418.808", "ors-999.001"];
    const graph: MadeUpGraph = {
      note: "MADE UP for a test.",
      nodes: [
        ...sections.map((id) => ({
          id,
          title: `Made up ${id}`,
          doc_type: "statute",
          status: "current",
          path: `statutes/${id}.md`,
        })),
        ...["oar-407-001-0010", "oar-998-001-0001"].map((id) => ({
          id,
          title: `Made up ${id}`,
          doc_type: "rule",
          status: "current",
          path: `rules/${id.split("-")[1] ?? ""}/001/${id}.md`,
        })),
      ],
      edges: [
        { from: "oar-407-001-0010", to: "ors-409.711", type: "implements" },
        // Chapter 999 is cited by nothing in the fixture, so the agency that implements it is not touched.
        { from: "oar-998-001-0001", to: "ors-999.001", type: "implements" },
      ],
    };
    const agenciesYaml = `organizations:
- slug: made-up-employment
  name: Employment Department
  oar_chapter: '471'
- slug: made-up-human-services
  name: Made-Up Human Services
  oar_chapter: '407'
- slug: made-up-decoy-board
  name: Made-Up Decoy Board
  oar_chapter: '998'
`;
    return madeUpErf({ graph, agenciesYaml });
  }

  it("keeps the ORS chapters the fixture cites and the Agencies it touches, drops the rest, and records why", () => {
    const erf = trimmedErf();
    const out = outputFile();
    const record = join(dirname(out), "trim.json");

    const finished = build(["--erf", erf.path, "--out", out, "--trim-to", fixture, "--trim-record", record]);

    expect(finished.status, finished.stderr).toBe(0);
    const trimmed = readJson(out) as Record<string, unknown>;
    // Chapters 409, 418, 653, 657B and 659A are cited; 999 is not. The decoy agency, whose only rule
    // implements chapter 999, is dropped. The Employment Department is named in SB 69's Fiscal Impact
    // Statement though no rule here implements a cited chapter; Made-Up Human Services implements 409.
    expect(trimmed["agencies"]).toEqual([
      {
        slug: "made-up-employment",
        name: "Employment Department",
        aliases: [],
        oarChapter: "471",
        dasAgencyNumber: null,
      },
      {
        slug: "made-up-human-services",
        name: "Made-Up Human Services",
        aliases: [],
        oarChapter: "407",
        dasAgencyNumber: null,
      },
    ]);
    expect(trimmed["orsSections"]).toEqual([
      "ors-409.711",
      "ors-418.808",
      "ors-653.616",
      "ors-657b.010",
      "ors-659a.159",
    ]);
    expect(trimmed["chapterAgencies"]).toEqual({ "ors-chapter-409": ["made-up-human-services"] });
    // The version is the checkout's, untouched by the trim.
    expect(trimmed["version"]).toMatchObject({ commit: erf.commit, commitDate: "2026-07-02T03:04:05-07:00" });

    const recorded = readJson(record) as Record<string, unknown>;
    expect(recorded["derivedFrom"]).toBe(fixture);
    expect(recorded["orsChaptersCited"]).toEqual(
      expect.arrayContaining([
        "ors-chapter-409",
        "ors-chapter-418",
        "ors-chapter-653",
        "ors-chapter-657b",
        "ors-chapter-659a",
      ]),
    );
    expect(recorded["orsChaptersCited"]).not.toContain("ors-chapter-999");
    // SB 69 cites ORS 192.245; this made-up checkout holds no section of chapter 192.
    expect(recorded["orsChaptersNotInSnapshot"]).toContain("ors-chapter-192");
    expect(recorded["orsChaptersNotInSnapshot"]).not.toContain("ors-chapter-409");
    expect(recorded["agenciesNamedInText"]).toEqual(["made-up-employment"]);
    expect(recorded["kept"]).toEqual({ agencies: 2, orsSections: 5, chaptersWithAgencies: 1 });
    expect(recorded["of"]).toEqual({ agencies: 3, orsSections: 6, chaptersWithAgencies: 2 });
    expect(recorded["snapshotSha256"]).toBe(createHash("sha256").update(readFileSync(out)).digest("hex"));
  }, 30_000);
});
