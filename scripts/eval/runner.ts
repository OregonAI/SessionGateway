// The evaluation runner (ticket #23, spec #1 story 58): runs a Session's question set against a built database and
// reports each question as passed or failed, with the reason for each failure. It calls the MCP tools in-process through
// an MCP client, the way an agent would and the way src/bin/server.ts wires the handler, so what a question checks is what
// an agent sees. It opens the database read-only (the server's reader) and never asks OLIS: the live lookup of
// `get_measure` is given a `fetch` that refuses, so that block says the lookup failed, which is a normal result.
//
// It is a script and not a package (src/packages/README.md): it is development tooling that the service does not ship,
// it needs the MCP client, a devDependency that nothing under src/ may import, and nothing in src/ calls it. It reaches
// the production code only through the entry points of packages, like any other app code.
import { existsSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { loadServerConfig, type ServerConfig } from "#/packages/config/index.ts";
import { openIndexReader } from "#/packages/database/reader.ts";
import { parseSessionKey, type SessionKey } from "#/packages/domain/index.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import { createSessionGatewayHandler, type SessionGatewayHandler } from "#/packages/mcp-server/handler.ts";
import { systemClock } from "#/packages/time/clock.ts";
import { problemWith } from "./paths.ts";
import { pacificTimestampOf, readTimestamp } from "#/packages/time/pacific.ts";
import { loadQuestionSet, questionAsksSince, questionSetPath, type Question, type Step } from "./questions.ts";

export type EvaluationOptions = {
  /** The built database to read (the ingest worker's `DATABASE_PATH`). */
  databasePath: string;
  /**
   * The Session whose question set is run. Not given, the Session the database holds; given, it must be one the
   * database holds. A database that holds more than one needs it, and one that holds none cannot be run (ticket #82).
   */
  session?: string;
  /**
   * What "since yesterday" means to every question that says `$since`: an ISO 8601 date or time. When it is not given,
   * each question's own: the Pacific day before the moment the question is asked at (its `clock`).
   */
  since?: string;
  /** A question set to run instead of the Session's own (scripts/eval/questions/<session>.yml). */
  questions?: string;
  /** The folder of question sets named for their Sessions, instead of scripts/eval/questions/. */
  questionsFolder?: string;
  /**
   * The server's publication gate for machine transcripts (TRANSCRIPTS_PUBLISHED, ADR-0055, ticket #136). Off unless given.
   * A step that says `requires: transcripts-published` runs only with it on; with it off the step is not run and the
   * report counts it.
   */
  transcriptsPublished?: boolean;
  /** Embeds the questions that `search` is asked; the 2025R1 set asks none. */
  embedder: Embedder;
  /** The directory of the embedding model, which the server's configuration names. */
  modelPath: string;
};

export type QuestionResult = {
  id: string;
  title: string;
  /** The moment the question was asked at, in Pacific time: its clock, or the database's as-of time. */
  moment: string;
  /** What "since yesterday" meant to it; undefined when the question does not say `$since`. */
  since?: string;
  passed: boolean;
  /** How many of its steps were not run because they require the transcripts to be published and the gate is off. */
  skippedSteps: number;
  /** Why it failed, one line for each check or call that did not hold; empty when it passed. */
  reasons: string[];
};

export type EvaluationReport = {
  session: string;
  databasePath: string;
  /** When the database was last refreshed, in Pacific time with its UTC offset. */
  asOf: string;
  /** The `since` the run was given, which overrides each question's own "since yesterday"; undefined when none was. */
  since?: string;
  /** Whether the run had the server's transcript gate on. */
  transcriptsPublished: boolean;
  results: QuestionResult[];
  /** True when every question passed. */
  passed: boolean;
};

/**
 * The Session to run: the one asked for, which the database must hold, or else the one the database holds. A database
 * that holds none, more than one with none asked for, or not the one asked for, cannot be run (ticket #82).
 */
function chooseSession(databasePath: string, held: SessionKey[], asked: SessionKey | undefined): SessionKey {
  if (held.length === 0) {
    throw new Error(`The database at ${databasePath} holds no completed full pull of any Session`);
  }
  if (asked !== undefined) {
    if (!held.includes(asked)) {
      throw new Error(`The database at ${databasePath} holds ${held.join(" and ")}, not ${asked}`);
    }
    return asked;
  }
  const [only, ...others] = held;
  if (only === undefined || others.length > 0) {
    throw new Error(`The database at ${databasePath} holds ${held.join(" and ")}: name the one to run with --session`);
  }
  return only;
}

/** A clock that stands still, so a question about "the next meeting" is asked at the moment it names. */
const stoppedAt = (moment: Date): { now(): Date } => ({ now: () => new Date(moment) });

/** The Pacific day before the day a moment falls in, as a date. */
function dayBefore(moment: Date): string {
  return Temporal.Instant.fromEpochMilliseconds(moment.getTime())
    .toZonedDateTimeISO("America/Los_Angeles")
    .toPlainDate()
    .subtract({ days: 1 })
    .toString();
}

/** The arguments of a call with each "$since" replaced by the run's time. */
function withSince(value: unknown, since: string): unknown {
  if (value === "$since") return since;
  if (Array.isArray(value)) return (value as unknown[]).map((item) => withSince(item, since));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withSince(item, since)]));
  }
  return value;
}

type Connection = { client: Client; handler: SessionGatewayHandler };

/** Connects an MCP client of the current protocol to a handler in-process: no port, no socket. */
async function connect(handler: SessionGatewayHandler): Promise<Client> {
  const client = new Client(
    { name: "session-gateway-evaluation", version: "0.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://session-gateway.evaluation/mcp"), {
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    }),
  );
  // The client validates each result's structured content against the tool's output schema once it knows the tools.
  await client.listTools();
  return client;
}

type Answer = { isError: boolean; structured: unknown; text: string };

async function call(client: Client, tool: string, args: Record<string, unknown>): Promise<Answer> {
  const result = await client.callTool({ name: tool, arguments: args });
  return {
    isError: result.isError === true,
    structured: result.structuredContent,
    text: result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"),
  };
}

/** Runs one step: the reasons it fails, none when it holds. */
async function runStep(client: Client, step: Step, since: string): Promise<string[]> {
  const args = withSince(step.arguments, since) as Record<string, unknown>;
  const label = `${step.tool} ${JSON.stringify(args)}`;
  let answer: Answer;
  try {
    answer = await call(client, step.tool, args);
  } catch (error) {
    return [`${label}: the call failed: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (answer.isError) return [`${label}: the tool answered with an error: ${answer.text}`];
  const reasons: string[] = [];
  for (const check of step.expect) {
    let problem: string | undefined;
    try {
      problem = problemWith(answer.structured, check);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (problem !== undefined) reasons.push(`${label}: ${problem}`);
  }
  return reasons;
}

/**
 * Runs the Session's question set against the database and reports each question. A question whose call is refused or
 * whose answer differs from what it must hold fails with the reason; a database that cannot be read, or a question set
 * that is not valid, throws, because there is nothing to report.
 */
export async function runEvaluation(options: EvaluationOptions): Promise<EvaluationReport> {
  const given = options.session === undefined ? undefined : parseSessionKey(options.session);
  if (options.session !== undefined && given === undefined) {
    throw new Error(`"${options.session}" is not an OLIS Session key such as 2025R1`);
  }
  if (options.since !== undefined && readTimestamp(options.since) === undefined) {
    throw new Error(
      `"${options.since}" is not a time. Give a date such as 2025-01-23 or a time such as 2025-01-23T16:00:00 (Pacific) or 2025-01-24T00:00:00Z.`,
    );
  }
  if (!existsSync(options.databasePath)) throw new Error(`There is no database at ${options.databasePath}`);

  const reader = openIndexReader(options.databasePath, systemClock);
  let session: SessionKey;
  let asOf: string | undefined;
  try {
    session = chooseSession(options.databasePath, reader.sessionsHeld(), given);
    asOf = reader.asOf(session);
  } finally {
    reader.close();
  }
  // Cannot happen: a held Session has an index_state row, and that is what asOf reads. It narrows the type.
  if (asOf === undefined) throw new Error(`The database at ${options.databasePath} has no as-of time for ${session}`);
  const set = loadQuestionSet(options.questions ?? questionSetPath(session, options.questionsFolder), session);

  const config = (): ServerConfig =>
    loadServerConfig({
      SESSION_KEY: session,
      // The live lookup is refused below, so this address is never asked; the configuration needs one.
      OLIS_BASE_URL: "https://olis.invalid/odata/",
      DATABASE_PATH: options.databasePath,
      MODEL_PATH: options.modelPath,
      // The clock stands still, so the window never ends: the limit must not be reached by the questions.
      MCP_RATE_LIMIT: "1000000",
      TRANSCRIPTS_PUBLISHED: options.transcriptsPublished === true ? "true" : "false",
    });
  const shutdown = new AbortController();
  const connections = new Map<number, Connection>();
  const connection = async (moment: Date): Promise<Client> => {
    const known = connections.get(moment.getTime());
    if (known !== undefined) return known.client;
    const handler = createSessionGatewayHandler(config(), {
      clock: stoppedAt(moment),
      embedder: options.embedder,
      fetch: () => Promise.reject(new Error("The evaluation does not ask OLIS")),
      signal: shutdown.signal,
      onLiveLookupFailed: () => {},
    });
    let client: Client;
    try {
      client = await connect(handler);
    } catch (error) {
      await handler.close();
      throw error;
    }
    connections.set(moment.getTime(), { client, handler });
    return client;
  };

  const results: QuestionResult[] = [];
  try {
    for (const question of set.questions) {
      results.push(
        await runQuestion(
          question,
          new Date(question.clock ?? asOf),
          connection,
          options.since,
          options.transcriptsPublished === true,
        ),
      );
    }
  } finally {
    shutdown.abort();
    // One close that throws must not leave the others open.
    await Promise.allSettled(
      [...connections.values()].map(async ({ client, handler }) => {
        try {
          await client.close();
        } finally {
          await handler.close();
        }
      }),
    );
  }
  return {
    session,
    databasePath: options.databasePath,
    asOf,
    ...(options.since === undefined ? {} : { since: options.since }),
    transcriptsPublished: options.transcriptsPublished === true,
    results,
    passed: results.every((result) => result.passed),
  };
}

async function runQuestion(
  question: Question,
  moment: Date,
  connection: (moment: Date) => Promise<Client>,
  given: string | undefined,
  transcriptsPublished: boolean,
): Promise<QuestionResult> {
  const reasons: string[] = [];
  let skippedSteps = 0;
  const since = questionAsksSince(question) ? (given ?? dayBefore(moment)) : undefined;
  try {
    const client = await connection(moment);
    for (const step of question.steps) {
      if (step.requires === "transcripts-published" && !transcriptsPublished) {
        skippedSteps += 1;
        continue;
      }
      reasons.push(...(await runStep(client, step, since ?? "")));
    }
  } catch (error) {
    reasons.push(`the question could not be asked: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    id: question.id,
    title: question.title,
    moment: pacificTimestampOf(Temporal.Instant.fromEpochMilliseconds(moment.getTime())),
    ...(since === undefined ? {} : { since }),
    passed: reasons.length === 0,
    skippedSteps,
    reasons,
  };
}

/** "1 step that needs the transcripts published was not run", or the plural of it. */
function notRun(count: number): string {
  return count === 1
    ? "1 step that needs the transcripts published was not run"
    : `${String(count)} steps that need the transcripts published were not run`;
}

/** The report as the command prints it: one line for each question, the reasons under a failed one, and a total. */
export function formatReport(report: EvaluationReport): string {
  const lines = [
    `Evaluation of ${report.session} against ${report.databasePath}`,
    report.since === undefined
      ? `The database is as of ${report.asOf}. Each question is asked at its own moment, and "since yesterday" is the day before it.`
      : `The database is as of ${report.asOf}. "Since yesterday" is ${report.since} for every question that asks for it.`,
    ...(report.transcriptsPublished
      ? ["Machine transcripts are published (the gate is on): the steps that require it ran."]
      : []),
    "",
  ];
  for (const result of report.results) {
    const asked = result.since === undefined ? "" : `  [asked ${result.moment}, since ${result.since}]`;
    lines.push(`${result.passed ? "PASS" : "FAIL"} ${result.id}  ${result.title}${asked}`);
    for (const reason of result.reasons) lines.push(`       - ${reason}`);
    if (result.skippedSteps > 0) lines.push(`       (${notRun(result.skippedSteps)}: the gate is off)`);
  }
  const passed = report.results.filter((result) => result.passed).length;
  lines.push("", `${passed} of ${report.results.length} questions passed`);
  const skipped = report.results.reduce((total, result) => total + result.skippedSteps, 0);
  if (skipped > 0) lines.push(`${notRun(skipped)} in all: run with --transcripts-published`);
  return lines.join("\n");
}
