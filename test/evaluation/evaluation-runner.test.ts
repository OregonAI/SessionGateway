// Seam 3 (test/CLAUDE.md): the evaluation runner's report (ticket #23, spec #1 story 58). The runner takes a built
// database and a question set, calls the MCP tools in-process the way an agent would, and reports each question as
// pass or fail with the reason for a failure. The tools are the same ones seam 1 tests; what this file asserts is the
// report, not the tools' answers.
//
// The command is `npm run eval -- --database <path> [--session 2025R1] [--since <iso>]`. It runs the question set of the
// Session (scripts/eval/questions/<session>.yml) against any built database, prints the report and exits 1 when any
// question fails (2 when it cannot run at all). It never runs in `npm test`: the cases below call the runner's function
// and, for the exit status, the script as a child process, against copies of the run's templates.
//
// Databases (test/CLAUDE.md, Database, Templates). Every case copies a template and only reads it, except the failing
// case, which changes the fake feed and pulls again so that one answer differs. The templates are the ones
// find-measures.test.ts and find-measures-since.test.ts already build for the same clocks and options, so a run that
// holds those files builds nothing more:
//   - 2026-08-01 10:00 Pacific, documents on: every row of the fixture exists. The passing case and the exit-status cases.
//   - 2025-01-24 12:00 Pacific and 2025-01-31 12:00 Pacific: the days after SB 69's amendments were posted, and after
//     its Fiscal Impact Statement was. They show "since yesterday" measured from the database's own as-of time.
// The embedder is the fake one (test/CLAUDE.md, "The embedder"): no question of the 2025R1 set searches.
//
// A question set made up by a case (written to a temp folder and labelled MADE UP) shows that a Session's questions are
// data: it needs no code, and a reason names the question, the call and the check that failed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatReport, runEvaluation, type EvaluationReport } from "../../scripts/eval/runner.ts";
import { createFakeEmbedder } from "../support/fake-embedder.ts";
import { modelPath } from "../support/real-embedder.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

// The first case that needs a template builds it (about 10 seconds for the pull of the fixture's documents).
vi.setConfig({ testTimeout: 60_000 });

const started: System[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** Every row of the fixture exists by then, so the pull fetches all 278 documents. */
const augustOptions = { clockAt: "2026-08-01T17:00:00Z", documents: true, serverEnv: { MCP_RATE_LIMIT: "1000" } };

async function start(clockAt: string): Promise<System> {
  const system = await startCopiedSystem({ clockAt, documents: true, serverEnv: { MCP_RATE_LIMIT: "1000" } });
  started.push(system);
  return system;
}

async function evaluate(system: System, extra: { since?: string; questions?: string } = {}): Promise<EvaluationReport> {
  return runEvaluation({
    databasePath: system.database.path,
    session: "2025R1",
    embedder: await createFakeEmbedder(),
    modelPath: modelPath(),
    ...extra,
  });
}

const ids = (report: EvaluationReport): string[] => report.results.map((result) => result.id);
const resultOf = (report: EvaluationReport, id: string): EvaluationReport["results"][number] => {
  const found = report.results.find((result) => result.id === id);
  if (found === undefined) throw new Error(`The report has no question ${id}: ${ids(report).join(", ")}`);
  return found;
};

const questionIds = ["a-statutes", "a-fiscal", "b-amendment", "c-meeting", "d-testimony", "e-analysis", "f-status"];

describe("the report of the 2025R1 question set", () => {
  // The database of 2026-08-01 holds the whole fixture, so "since yesterday" would be 2026-07-31 and name nothing; the
  // operator of a full local build gives the day the question is about (spec #1: "the evaluation run" uses the full
  // cache), here the day before SB 69's amendments were posted.
  it("lists every question of the set as passed against the fixture build", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);

    const report = await evaluate(system, { since: "2025-01-23" });

    expect(report.session).toBe("2025R1");
    expect(ids(report)).toEqual(questionIds);
    expect(report.results.map((result) => [result.id, result.passed, result.reasons])).toEqual(
      questionIds.map((id) => [id, true, []]),
    );
    expect(report.passed).toBe(true);
    expect(formatReport(report)).toContain("7 of 7 questions passed");
  });

  // SB 69's amendments -1 and -2 were posted on 2025-01-23 (feed/CommitteeProposedAmendments.json), so on 2025-01-24
  // "since yesterday" is 2025-01-23 and question (a) finds them. Its Fiscal Impact Statement (analysis 85414, 2025-01-30)
  // is not there yet, and the report says that question fails, for that reason.
  it("measures 'since yesterday' from the database's own as-of time when no time is given", async () => {
    const system = await start("2025-01-24T20:00:00Z");

    const report = await evaluate(system);

    expect(report.asOf).toBe("2025-01-24T12:00:00-08:00");
    expect(report.since).toBe("2025-01-23");
    expect(resultOf(report, "a-statutes")).toMatchObject({ passed: true, reasons: [] });
    expect(resultOf(report, "a-fiscal").passed).toBe(false);
  });

  it("finds the Fiscal Impact Statement posted yesterday on the day after it", async () => {
    const system = await start("2025-01-31T20:00:00Z");

    const report = await evaluate(system);

    expect(report.since).toBe("2025-01-30");
    expect(resultOf(report, "a-fiscal")).toMatchObject({ passed: true, reasons: [] });
  });

  it("uses the time it is given instead of yesterday", async () => {
    const system = await start("2025-01-24T20:00:00Z");

    const report = await evaluate(system, { since: "2025-01-24" });

    expect(report.since).toBe("2025-01-24");
    const statutes = resultOf(report, "a-statutes");
    expect(statutes.passed).toBe(false);
    expect(statutes.reasons.join("\n")).toContain("amendment-2025r1-sb69-2");
  });
});

describe("a question that fails", () => {
  // HB 3131's Testimony row 117368 (David Wall, Newberg) is the one oppose row of its 42 (feed/
  // CommitteePublicTestimonies.json: PositionOnMeasureId 3982). The feed now says 3983, support, and the database is
  // pulled again: question (d) expects 41 support and 1 oppose (spec #1, case (d)) and sees 42 support, and no other
  // question reads that row.
  it("is named in the report with the reason, and the questions that still hold pass", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);
    system.olis.amendRows("CommitteePublicTestimonies", (row) => row["CommTestId"] === 117368, {
      PositionOnMeasureId: 3983,
    });
    await system.pullAgain();

    const report = await evaluate(system, { since: "2025-01-23" });

    expect(report.passed).toBe(false);
    expect(report.results.filter((result) => !result.passed).map((result) => result.id)).toEqual(["d-testimony"]);
    const reason = resultOf(report, "d-testimony").reasons.join("\n");
    expect(reason).toContain("testimony");
    expect(reason).toContain("HB 3131");
    expect(reason).toContain("position_counts[position=oppose].count should equal [1]");
    const text = formatReport(report);
    expect(text).toContain("FAIL d-testimony");
    expect(text).toContain("PASS e-analysis");
    expect(text).toContain("6 of 7 questions passed");
  });
});

describe("a question set made up for a case", () => {
  /** Writes a question set (MADE UP, not a Session's) and returns its path. */
  function writeSet(text: string): string {
    const folder = mkdtempSync(join(tmpdir(), "session-gateway-questions-"));
    folders.push(folder);
    const path = join(folder, "set.yml");
    writeFileSync(path, text);
    return path;
  }

  // The tool and the arguments are the question's data. Each check names a path into what the tool returned: `[*]`
  // takes every element of a list, `[key=value]` the elements whose key has that value.
  it("is run without code: each question reports the call and the check that failed", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);
    const questions = writeSet(`
session: 2025R1
questions:
  - id: made-up-holds
    title: MADE UP, the Session is the one asked for
    steps:
      - tool: session_overview
        arguments: {}
        expect:
          - { path: session, equals: 2025R1 }
          - { path: counts.measures, atLeast: 1 }
          - { path: notice, present: true }
  - id: made-up-wrong-value
    title: MADE UP, expects a Session the database does not hold
    steps:
      - tool: session_overview
        arguments: {}
        expect:
          - { path: session, equals: 2027R1 }
  - id: made-up-wrong-list
    title: MADE UP, expects a Measure the Session has not got
    steps:
      - tool: testimony
        arguments: { measure: HB 3131 }
        expect:
          - { path: "positions[*].position", includes: [support, unheard-of] }
          - { path: "positions[*].position", length: 5 }
  - id: made-up-tool-error
    title: MADE UP, asks for a Measure that does not exist
    steps:
      - tool: get_measure
        arguments: { measure: SB 99999 }
        expect:
          - { path: id, present: true }
`);

    const report = await evaluate(system, { questions });

    expect(report.results.map((result) => [result.id, result.passed])).toEqual([
      ["made-up-holds", true],
      ["made-up-wrong-value", false],
      ["made-up-wrong-list", false],
      ["made-up-tool-error", false],
    ]);
    expect(resultOf(report, "made-up-wrong-value").reasons).toEqual([
      'session_overview {}: session should equal "2027R1", and it is "2025R1"',
    ]);
    expect(resultOf(report, "made-up-wrong-list").reasons).toEqual([
      'testimony {"measure":"HB 3131"}: positions[*].position should include "unheard-of", and it is ["support","oppose"]',
      'testimony {"measure":"HB 3131"}: positions[*].position should have 5 items, and it has 2',
    ]);
    expect(resultOf(report, "made-up-tool-error").reasons).toEqual([
      expect.stringMatching(/^get_measure \{"measure":"SB 99999"\}: the tool answered with an error: .*SB 99999/),
    ]);
  });

  it("refuses a set whose Session is not the one asked for", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);
    const questions = writeSet(`
session: 2027R1
questions:
  - id: made-up
    title: MADE UP
    steps:
      - tool: session_overview
        arguments: {}
        expect:
          - { path: session, present: true }
`);

    await expect(evaluate(system, { questions })).rejects.toThrow(/2027R1.*2025R1|2025R1.*2027R1/);
  });
});

describe("the command", () => {
  const script = join(import.meta.dirname, "..", "..", "scripts", "eval", "run.ts");

  function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync("node", [script, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("prints the report and exits 0 when every question passes", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);

    const outcome = run(["--database", system.database.path, "--since", "2025-01-23"]);

    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("PASS a-statutes");
    expect(outcome.stdout).toContain("7 of 7 questions passed");
  }, 60_000);

  it("exits 1 and names the question when one fails", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);

    // Without --since, "yesterday" of a database as of 2026-08-01 is 2026-07-31: nothing was posted then.
    const outcome = run(["--database", system.database.path]);

    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("FAIL a-statutes");
    expect(outcome.stdout).toContain("PASS d-testimony");
  }, 60_000);

  it("exits 2 with a message when it cannot run: no database named, or none at the path", () => {
    const missing = run([]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("--database");

    const absent = run(["--database", join(tmpdir(), "session-gateway-no-such-database.db")]);
    expect(absent.status).toBe(2);
    expect(absent.stderr).toContain("session-gateway-no-such-database.db");
  }, 60_000);
});
