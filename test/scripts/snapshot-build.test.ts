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
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMadeUpErf, madeUpGraph, type MadeUpErf } from "../support/made-up-erf.ts";

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
