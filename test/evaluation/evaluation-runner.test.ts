// Seam 3 (test/CLAUDE.md): the evaluation runner's report (ticket #23, spec #1 story 58). The runner takes a built
// database and a question set, calls the MCP tools in-process the way an agent would, and reports each question as
// pass or fail with the reason for a failure. The tools are the same ones seam 1 tests; what this file asserts is the
// report, not the tools' answers.
//
// The command is `npm run eval -- --database <path> [--session <key>] [--since <iso>]`. It runs the question set of the
// Session the database holds, or of `--session` (scripts/eval/questions/<session>.yml) against any built database,
// prints the report and exits 1 when any question fails (2 when it cannot run at all). It never runs in `npm test`: the
// cases below call the runner's function and, for the exit status, the script as a child process, against copies of the
// run's templates.
//
// Databases (test/CLAUDE.md, Database, Templates). Every case copies a template and only reads the copy, except three.
// The failing case changes the fake feed and pulls again so that one answer differs. The several-Sessions case pulls a
// second Session (2025S1) into its copy. The no-Session case copies nothing: it makes an empty database with
// `openIndexWriter`. The 2025R1 templates are the ones find-measures.test.ts and find-measures-since.test.ts already
// build for the same clocks and options, so a run that holds those files builds nothing more:
//   - 2026-08-05 10:00 Pacific, documents on: every row of the fixture exists, as in a database built after both
//     postings. The passing case (with no flags) and the exit-status cases.
//   - 2025-01-24 12:00 Pacific and 2025-01-31 12:00 Pacific: the days after SB 69's amendments were posted, and after
//     its Fiscal Impact Statement was. They show that a question fails when the database was built too early to hold
//     its posting. Each question names the moment it is asked at, so "since yesterday" does not come from these.
//   - 2026-08-05 10:00 Pacific, documents off, Session 2025S1: a copy of its own template, built once for the file. The
//     fake feed holds no rows for that Session, so the pull is complete and the database is empty, which is all the
//     cases for a Session that is not 2025R1 need (ticket #82). They are the one with a MADE UP question set, the one
//     with no question set, and the command case for a missing set.
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
import { halnrwEventId, halnrwSegments, madeUpTranscript } from "../support/made-up-transcript.ts";
import { createFakeEmbedder } from "../support/fake-embedder.ts";
import { modelPath } from "../support/real-embedder.ts";
import { openIndexWriter } from "#/packages/database/writer.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import { createTempDatabase } from "../support/temp-database.ts";

// The first case that needs a template builds it (about 10 seconds for the pull of the fixture's documents).
vi.setConfig({ testTimeout: 60_000 });

const started: System[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The options find-measures*.test.ts use for the same clocks, so the templates are shared. */
const optionsAt = (clockAt: string) => ({ clockAt, documents: true, serverEnv: { MCP_RATE_LIMIT: "1000" } });

/** Every row of the fixture exists by then, so the pull fetches all 314 documents. */
const augustOptions = optionsAt("2026-08-05T17:00:00Z");

async function start(clockAt: string): Promise<System> {
  const system = await startCopiedSystem(optionsAt(clockAt));
  started.push(system);
  return system;
}

/** No `session` unless a case gives one: the runner then runs the Session the database holds (ticket #82). */
async function evaluate(
  system: System,
  extra: {
    session?: string;
    since?: string;
    questions?: string;
    questionsFolder?: string;
    transcriptsPublished?: boolean;
  } = {},
): Promise<EvaluationReport> {
  return runEvaluation({
    databasePath: system.database.path,
    embedder: await createFakeEmbedder(),
    modelPath: modelPath(),
    ...extra,
  });
}

/** Writes a folder of question sets (MADE UP), each named for its Session as the runner's own folder is, and returns it. */
function writeFolder(sets: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), "session-gateway-question-sets-"));
  folders.push(folder);
  for (const [session, text] of Object.entries(sets)) writeFileSync(join(folder, `${session}.yml`), text);
  return folder;
}

/** Writes a question set (MADE UP, not a Session's) and returns its path. */
function writeSet(text: string): string {
  const folder = mkdtempSync(join(tmpdir(), "session-gateway-questions-"));
  folders.push(folder);
  const path = join(folder, "set.yml");
  writeFileSync(path, text);
  return path;
}

const ids = (report: EvaluationReport): string[] => report.results.map((result) => result.id);
const resultOf = (report: EvaluationReport, id: string): EvaluationReport["results"][number] => {
  const found = report.results.find((result) => result.id === id);
  if (found === undefined) throw new Error(`The report has no question ${id}: ${ids(report).join(", ")}`);
  return found;
};

const questionIds = ["a-statutes", "a-fiscal", "b-amendment", "c-meeting", "d-testimony", "e-analysis", "f-status"];

describe("the report of the 2025R1 question set", () => {
  // The database of 2026-08-05 was built after both postings (SB 69's amendments on 2025-01-23, its Fiscal Impact
  // Statement on 2025-01-30) and holds the whole fixture. Each question carries its own moment, so "since yesterday" does
  // not depend on the day the database was pulled and no flag is needed (ticket #23, review P1).
  it("passes every question with no flags on a database built after both postings", async () => {
    const system = await start("2026-08-05T17:00:00Z");

    const report = await evaluate(system);

    expect(report.session).toBe("2025R1");
    expect(ids(report)).toEqual(questionIds);
    expect(report.results.map((result) => [result.id, result.passed, result.reasons])).toEqual(
      questionIds.map((id) => [id, true, []]),
    );
    expect(report.passed).toBe(true);
    expect(formatReport(report)).toContain("7 of 7 questions passed");
  });

  // (a) is asked on the day after each posting (spec #1 stories 1 and 2): the amendments of 2025-01-23 on 2025-01-24, the
  // Fiscal Impact Statement of 2025-01-30 (analysis 85414) on 2025-01-31.
  it("asks (a) on the day after each posting, so 'since yesterday' is the day before that moment", async () => {
    const system = await start("2026-08-05T17:00:00Z");

    const report = await evaluate(system);

    expect(resultOf(report, "a-statutes")).toMatchObject({ moment: "2025-01-24T12:00:00-08:00", since: "2025-01-23" });
    expect(resultOf(report, "a-fiscal")).toMatchObject({ moment: "2025-01-31T12:00:00-08:00", since: "2025-01-30" });
    expect(resultOf(report, "b-amendment").since).toBeUndefined();
    expect(resultOf(report, "b-amendment").moment).toBe(report.asOf);
  });

  // A database built the day after the first posting does not hold the second yet: the report says (a)'s second question
  // fails, and the first still holds. One built the day after the second holds both.
  it("fails a question whose posting the database was built too early to hold", async () => {
    const system = await start("2025-01-24T20:00:00Z");

    const report = await evaluate(system);

    expect(report.asOf).toBe("2025-01-24T12:00:00-08:00");
    expect(resultOf(report, "a-statutes")).toMatchObject({ passed: true, reasons: [] });
    expect(resultOf(report, "a-fiscal").passed).toBe(false);
  });

  it("passes both halves of (a) on a database built the day after the Fiscal Impact Statement", async () => {
    const system = await start("2025-01-31T20:00:00Z");

    const report = await evaluate(system);

    expect(resultOf(report, "a-statutes")).toMatchObject({ passed: true, reasons: [] });
    expect(resultOf(report, "a-fiscal")).toMatchObject({ passed: true, reasons: [] });
  });

  it("uses the time it is given instead of yesterday, for every question that asks for it", async () => {
    const system = await start("2026-08-05T17:00:00Z");

    const report = await evaluate(system, { since: "2025-01-24" });

    expect(report.since).toBe("2025-01-24");
    expect(report.results.filter((result) => result.since !== undefined).map((result) => result.since)).toEqual([
      "2025-01-24",
      "2025-01-24",
    ]);
    const statutes = resultOf(report, "a-statutes");
    expect(statutes.passed).toBe(false);
    expect(statutes.reasons.join("\n")).toContain("amendment-2025r1-sb69-2");
  });

  it("refuses a time it cannot read", async () => {
    const system = await start("2026-08-05T17:00:00Z");

    await expect(evaluate(system, { since: "yesterday" })).rejects.toThrow(/"yesterday" is not a time/);
  });
});

describe("a question's own moment", () => {
  // MADE UP sets. The clock "2025-01-24T02:00:00Z" is 18:00 on 2025-01-23 in Pacific time, so the day before it, in
  // Pacific time, is 2025-01-22 (and not 2025-01-23, the day before its UTC date).
  it("makes 'since yesterday' the Pacific day before the question's moment", async () => {
    const system = await start("2026-08-05T17:00:00Z");
    const questions = writeSet(`
session: 2025R1
questions:
  - id: made-up-evening
    title: MADE UP, asked at 18:00 Pacific on 2025-01-23
    clock: "2025-01-24T02:00:00Z"
    steps:
      - tool: find_measures
        arguments: { agency: bureau-of-labor-and-industries, since: $since }
        expect:
          - { path: query.since, equals: "2025-01-22T00:00:00-08:00" }
`);

    const report = await evaluate(system, { questions });

    expect(
      report.results.map(({ id, moment, since, passed, reasons }) => ({ id, moment, since, passed, reasons })),
    ).toEqual([
      { id: "made-up-evening", moment: "2025-01-23T18:00:00-08:00", since: "2025-01-22", passed: true, reasons: [] },
    ]);
  });

  it("refuses a question that says $since and names no moment", async () => {
    const system = await start("2026-08-05T17:00:00Z");
    const questions = writeSet(`
session: 2025R1
questions:
  - id: made-up-no-moment
    title: MADE UP, asks since yesterday and says when yesterday is not
    steps:
      - tool: find_measures
        arguments: { agency: bureau-of-labor-and-industries, since: $since }
        expect:
          - { path: query.since, present: true }
`);

    await expect(evaluate(system, { questions })).rejects.toThrow(/made-up-no-moment.*clock/);
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

    const report = await evaluate(system);

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

  // Ticket #129: a check on one element of a list picked by `[key=value]` cannot say the whole text of a long value (a
  // player link whose event ID the stored text does not hold), so `includesText` says some of the text of an element
  // that is text: it holds when any text the path finds contains the words.
  it("checks that a text the path finds contains words (includesText), and says what it found when none does", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);
    const questions = writeSet(`
session: 2025R1
questions:
  - id: made-up-text-holds
    title: MADE UP, a position's text contains the words
    steps:
      - tool: testimony
        arguments: { measure: HB 3131 }
        expect:
          - { path: "positions[*].position", includesText: [uppo, rt] }
  - id: made-up-text-missing
    title: MADE UP, no position's text contains the words
    steps:
      - tool: testimony
        arguments: { measure: HB 3131 }
        expect:
          - { path: "positions[*].position", includesText: [uppo, unheard-of] }
          - { path: measure_id, includesText: nothing-like-this }
`);

    const report = await evaluate(system, { questions });

    expect(report.results.map((result) => [result.id, result.passed])).toEqual([
      ["made-up-text-holds", true],
      ["made-up-text-missing", false],
    ]);
    expect(resultOf(report, "made-up-text-missing").reasons).toEqual([
      'testimony {"measure":"HB 3131"}: positions[*].position should have a text that includes "unheard-of", and it is ["support","oppose"]',
      expect.stringMatching(
        /^testimony \{"measure":"HB 3131"\}: measure_id should have a text that includes "nothing-like-this", and it is "measure-/,
      ),
    ]);
  });

  // Ticket #129 (review): the words must all be in ONE text, and a word that ends in a digit must not run on into another
  // digit, so that "&startStreamAt=70" is not found in "&startStreamAt=708".
  it("wants all the words in one text, and a word ending in a digit not followed by another digit (includesText)", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);
    const questions = writeSet(`
session: 2025R1
questions:
  - id: made-up-across-texts
    title: MADE UP, the words are in two different positions
    steps:
      - tool: testimony
        arguments: { measure: HB 3131 }
        expect:
          - { path: "positions[*].position", includesText: [uppo, ppos] }
  - id: made-up-digit-prefix
    title: MADE UP, a word ending in a digit that is the start of a longer number
    steps:
      - tool: testimony
        arguments: { measure: HB 3131 }
        expect:
          - { path: "measure_id", includesText: ["measure-", "hb313"] }
  - id: made-up-digit-whole
    title: MADE UP, a word ending in a digit that is the whole number
    steps:
      - tool: testimony
        arguments: { measure: HB 3131 }
        expect:
          - { path: "measure_id", includesText: ["measure-", "hb3131"] }
`);

    const report = await evaluate(system, { questions });

    expect(report.results.map((result) => [result.id, result.passed])).toEqual([
      ["made-up-across-texts", false],
      ["made-up-digit-prefix", false],
      ["made-up-digit-whole", true],
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

describe("the Session it runs", () => {
  // Ticket #82. With no session given the runner reads the Session the database holds (the reader's `sessionsHeld`) and
  // runs scripts/eval/questions/<that Session>.yml. The made-up Session is 2025S1, pulled from the fake OLIS, which
  // holds no rows of it: a complete pull of a Session with nothing in it. Its question set is MADE UP.
  const special = (title: string): string => `
session: 2025S1
questions:
  - id: made-up-special
    title: ${title}
    steps:
      - tool: session_overview
        arguments: {}
        expect:
          - { path: session, equals: 2025S1 }
`;

  async function startSpecial(): Promise<System> {
    const system = await startCopiedSystem({ clockAt: "2026-08-05T17:00:00Z", sessionKey: "2025S1" });
    started.push(system);
    return system;
  }

  it("runs the fixture build's own Session with no session given", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);

    const report = await runEvaluation({
      databasePath: system.database.path,
      embedder: await createFakeEmbedder(),
      modelPath: modelPath(),
    });

    expect(report.session).toBe("2025R1");
    expect(ids(report)).toEqual(questionIds);
    expect(report.passed).toBe(true);
  });

  it("runs the question set named for a Session that is not 2025R1, with the server configured for it", async () => {
    const system = await startSpecial();
    const questionsFolder = writeFolder({ "2025S1": special("MADE UP, the Session is the database's own") });

    const report = await evaluate(system, { questionsFolder });

    expect(report.session).toBe("2025S1");
    expect(report.results.map((result) => [result.id, result.passed, result.reasons])).toEqual([
      ["made-up-special", true, []],
    ]);
  });

  it("refuses an explicit session the database does not hold, naming both", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);

    const refusal = evaluate(system, { session: "2026R1" });

    await expect(refusal).rejects.toThrow(/2026R1/);
    await expect(refusal).rejects.toThrow(/holds 2025R1/);
  });

  it("refuses a Session that has no question set, naming the missing file", async () => {
    const system = await startSpecial();
    const questionsFolder = writeFolder({});

    const refusal = evaluate(system, { questionsFolder });

    await expect(refusal).rejects.toThrow(/no question set for 2025S1/);
    await expect(refusal).rejects.toThrow(join(questionsFolder, "2025S1.yml"));
  });

  it("refuses a database that holds more than one Session unless one is named, and runs the one that is", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);
    await system.pullAnotherSession("2025S1");
    const questionsFolder = writeFolder({ "2025S1": special("MADE UP, named by --session") });

    const unnamed = evaluate(system, { questionsFolder });
    await expect(unnamed).rejects.toThrow(/2025R1 and 2025S1/);
    await expect(unnamed).rejects.toThrow(/--session/);

    const named = await evaluate(system, { questionsFolder, session: "2025S1" });
    expect(named.session).toBe("2025S1");
    expect(named.passed).toBe(true);
    const fixture = await evaluate(system, { session: "2025R1" });
    expect(fixture.session).toBe("2025R1");
    expect(fixture.passed).toBe(true);
  });

  it("refuses a database that holds no completed full pull of any Session", async () => {
    const database = createTempDatabase();
    try {
      openIndexWriter(database.path).close();

      await expect(
        runEvaluation({ databasePath: database.path, embedder: await createFakeEmbedder(), modelPath: modelPath() }),
      ).rejects.toThrow(/holds no completed full pull of any Session/);
    } finally {
      database.remove();
    }
  });
});

describe("the command", () => {
  const script = join(import.meta.dirname, "..", "..", "scripts", "eval", "run.ts");

  function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync("node", [script, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("prints the report and exits 0 when every question passes, with no flags", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);

    const outcome = run(["--database", system.database.path]);

    expect(outcome.stderr).toBe("");
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("PASS a-statutes");
    expect(outcome.stdout).toContain("7 of 7 questions passed");
  });

  // Ticket #82: the default is the database's Session, not 2025R1. A 2025S1 database has no committed question set.
  it("exits 2 and names the missing question set when the database's Session has none", async () => {
    const system = await startCopiedSystem({ clockAt: "2026-08-05T17:00:00Z", sessionKey: "2025S1" });
    started.push(system);

    const outcome = run(["--database", system.database.path]);

    expect(outcome.status).toBe(2);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain(join("questions", "2025S1.yml"));
  });

  it("exits 2 and names both Sessions when --session is not the one the database holds", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);

    const outcome = run(["--database", system.database.path, "--session", "2026R1"]);

    expect(outcome.status).toBe(2);
    expect(outcome.stderr).toContain("2026R1");
    expect(outcome.stderr).toContain("holds 2025R1");
  });

  it("exits 1 and names the question when one fails", async () => {
    const system = await startCopiedSystem(augustOptions);
    started.push(system);

    // --since 2025-01-24 is after the amendments of 2025-01-23: nothing was posted since.
    const outcome = run(["--database", system.database.path, "--since", "2025-01-24"]);

    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("FAIL a-statutes");
    expect(outcome.stdout).toContain("PASS d-testimony");
  });

  it("exits 2 with a message when it cannot run: no database named, none at the path, or a time it cannot read", async () => {
    const missing = run([]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("--database");

    const absent = run(["--database", join(tmpdir(), "session-gateway-no-such-database.db")]);
    expect(absent.status).toBe(2);
    expect(absent.stderr).toContain("session-gateway-no-such-database.db");

    const system = await startCopiedSystem(augustOptions);
    started.push(system);
    const unreadable = run(["--database", system.database.path, "--since", "yesterday"]);
    expect(unreadable.status).toBe(2);
    expect(unreadable.stderr).toContain('"yesterday" is not a time');
    expect(unreadable.stdout).toBe("");
  });
});

// Ticket #136: the evaluation with the publication gate on (ADR-0055). The runner builds the server's configuration itself, so
// it takes the gate as an option (`transcriptsPublished`, the command's `--transcripts-published`), and a step of a question
// may say `requires: transcripts-published`: it runs only with the gate on, and with the gate off it is not run and the
// report says how many were not. The gate is the server's setting and not part of the template's key, so one database
// serves both runs.
//
// Database: a copy of the template for the 2026-08-05 clock, documents on, and one MADE UP transcript file (never said at any
// hearing, timed to the real turns of HALNRW 2025-01-22's log 288741, test/support/made-up-transcript.ts). The words of the
// expectations are those made-up words: "Good morning members the quokka laboratory tests samples", from 169.5 s, in the turn
// at 00:02:49 (Kurt Williams). The notice is ADR-0055's sentence.
describe("the evaluation with the transcripts published (ticket #136)", () => {
  const withTranscript = {
    ...augustOptions,
    transcripts: {
      [`${halnrwEventId}.transcript.json`]: madeUpTranscript({ eventId: halnrwEventId, segments: halnrwSegments }),
    },
  };
  const NOTICE = "This result includes a machine transcript of the official recording, not an official record.";
  const setWith = (words: string): string => `
session: 2025R1
questions:
  - id: made-up-quote
    title: MADE UP, a turn's words with the notice
    steps:
      - tool: get_document
        arguments: { id: recording-log-2025r1-288741 }
        expect:
          - { path: kind, equals: recording_log }
      - tool: get_document
        requires: transcripts-published
        arguments: { id: recording-log-2025r1-288741 }
        expect:
          - { path: "speaker_turns.turns[timecode=00:02:49].transcript[*].text", includesText: ${JSON.stringify(words)} }
          - { path: notice, includesText: ${JSON.stringify(NOTICE)} }
`;

  it("with the gate off runs no step that requires it, passes, and says how many it did not run", async () => {
    const system = await startCopiedSystem(withTranscript);
    started.push(system);

    // With the gate off the words are not in the answer, so a step that ran would fail: the question passes only if it did not.
    const report = await evaluate(system, { questions: writeSet(setWith("quokka laboratory tests samples")) });

    expect(resultOf(report, "made-up-quote")).toMatchObject({ passed: true, reasons: [], skippedSteps: 1 });
    expect(formatReport(report)).toContain("1 step that needs the transcripts published was not run");
    expect(formatReport(report)).not.toContain("Machine transcripts are published");
  });

  it("with the gate off says 'need' and 'were' for two steps, and totals the steps not run under the questions", async () => {
    const system = await startCopiedSystem(withTranscript);
    started.push(system);
    const two = setWith("quokka").replace(
      "  - id: made-up-quote",
      `  - id: made-up-two
    title: MADE UP, two steps that require the gate
    steps:
      - tool: get_document
        requires: transcripts-published
        arguments: { id: recording-log-2025r1-288741 }
        expect:
          - { path: notice, includesText: nothing }
      - tool: get_document
        requires: transcripts-published
        arguments: { id: recording-log-2025r1-288741 }
        expect:
          - { path: notice, includesText: nothing }
  - id: made-up-quote`,
    );

    const text = formatReport(await evaluate(system, { questions: writeSet(two) }));

    expect(text).toContain("(2 steps that need the transcripts published were not run: the gate is off)");
    expect(text).toContain(
      "3 steps that need the transcripts published were not run in all: run with --transcripts-published",
    );
  });

  it("with the gate on runs the step: the words of the turn and the notice are found, and the report says the gate is on", async () => {
    const system = await startCopiedSystem(withTranscript);
    started.push(system);

    const report = await evaluate(system, {
      questions: writeSet(setWith("quokka laboratory tests samples")),
      transcriptsPublished: true,
    });

    expect(resultOf(report, "made-up-quote")).toMatchObject({ passed: true, reasons: [], skippedSteps: 0 });
    expect(formatReport(report)).toContain("Machine transcripts are published (the gate is on)");
  });

  it("with the gate on fails a quote the transcript does not hold, and says what the turn's words are", async () => {
    const system = await startCopiedSystem(withTranscript);
    started.push(system);

    const report = await evaluate(system, {
      questions: writeSet(setWith("an unheard-of sentence")),
      transcriptsPublished: true,
    });

    expect(resultOf(report, "made-up-quote").passed).toBe(false);
    expect(resultOf(report, "made-up-quote").reasons).toEqual([
      expect.stringContaining('transcript[*].text should have a text that includes "an unheard-of sentence"'),
    ]);
  });

  it("the command takes --transcripts-published", async () => {
    const system = await startCopiedSystem(withTranscript);
    started.push(system);
    const script = join(import.meta.dirname, "..", "..", "scripts", "eval", "run.ts");

    const result = spawnSync("node", [script, "--database", system.database.path, "--transcripts-published"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Machine transcripts are published (the gate is on)");
    expect(result.stdout).toContain("7 of 7 questions passed");
  });
});
