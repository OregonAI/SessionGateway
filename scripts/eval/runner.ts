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
import { parseSessionKey } from "#/packages/domain/index.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import { createSessionGatewayHandler, type SessionGatewayHandler } from "#/packages/mcp-server/handler.ts";
import { problemWith } from "./paths.ts";
import { loadQuestionSet, questionSetPath, type Question, type Step } from "./questions.ts";

export type EvaluationOptions = {
  /** The built database to read (the ingest worker's `DATABASE_PATH`). */
  databasePath: string;
  /** The Session the database holds and whose question set is run: 2025R1. */
  session: string;
  /**
   * What "since yesterday" means to the questions that say `$since`: an ISO 8601 date or time. The day before the
   * database's as-of time, in Pacific time, when it is not given.
   */
  since?: string;
  /** A question set to run instead of the Session's own (scripts/eval/questions/<session>.yml). */
  questions?: string;
  /** Embeds the questions that `search` is asked; the 2025R1 set asks none. */
  embedder: Embedder;
  /** The directory of the embedding model, which the server's configuration names. */
  modelPath: string;
};

export type QuestionResult = {
  id: string;
  title: string;
  passed: boolean;
  /** Why it failed, one line for each check or call that did not hold; empty when it passed. */
  reasons: string[];
};

export type EvaluationReport = {
  session: string;
  databasePath: string;
  /** When the database was last refreshed, in Pacific time with its UTC offset. */
  asOf: string;
  /** The time "since yesterday" meant in this run. */
  since: string;
  results: QuestionResult[];
  /** True when every question passed. */
  passed: boolean;
};

/** A clock that stands still, so a question about "the next meeting" is asked at the moment it names. */
const stoppedAt = (moment: Date): { now(): Date } => ({ now: () => new Date(moment) });

/** The day before the as-of time's day, as a date: the as-of time is already in Pacific time. */
function dayBefore(asOf: string): string {
  return Temporal.PlainDate.from(asOf.slice(0, 10)).subtract({ days: 1 }).toString();
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
  const session = parseSessionKey(options.session);
  if (session === undefined) throw new Error(`"${options.session}" is not an OLIS Session key such as 2025R1`);
  if (!existsSync(options.databasePath)) throw new Error(`There is no database at ${options.databasePath}`);
  const set = loadQuestionSet(options.questions ?? questionSetPath(options.session), options.session);

  const reader = openIndexReader(options.databasePath);
  let asOf: string | undefined;
  try {
    asOf = reader.asOf(session);
  } finally {
    reader.close();
  }
  if (asOf === undefined)
    throw new Error(`The database at ${options.databasePath} holds no completed full pull of ${session}`);
  const since = options.since ?? dayBefore(asOf);

  const config = (): ServerConfig =>
    loadServerConfig({
      SESSION_KEY: session,
      // The live lookup is refused below, so this address is never asked; the configuration needs one.
      OLIS_BASE_URL: "https://olis.invalid/odata/",
      DATABASE_PATH: options.databasePath,
      MODEL_PATH: options.modelPath,
      // The clock stands still, so the window never ends: the limit must not be reached by the questions.
      MCP_RATE_LIMIT: "1000000",
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
    const client = await connect(handler);
    connections.set(moment.getTime(), { client, handler });
    return client;
  };

  const results: QuestionResult[] = [];
  try {
    for (const question of set.questions) {
      results.push(await runQuestion(question, new Date(question.clock ?? asOf), connection, since));
    }
  } finally {
    shutdown.abort();
    for (const { client, handler } of connections.values()) {
      await client.close();
      await handler.close();
    }
  }
  return {
    session: options.session,
    databasePath: options.databasePath,
    asOf,
    since,
    results,
    passed: results.every((result) => result.passed),
  };
}

async function runQuestion(
  question: Question,
  moment: Date,
  connection: (moment: Date) => Promise<Client>,
  since: string,
): Promise<QuestionResult> {
  const reasons: string[] = [];
  try {
    const client = await connection(moment);
    for (const step of question.steps) reasons.push(...(await runStep(client, step, since)));
  } catch (error) {
    reasons.push(`the question could not be asked: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { id: question.id, title: question.title, passed: reasons.length === 0, reasons };
}

/** The report as the command prints it: one line for each question, the reasons under a failed one, and a total. */
export function formatReport(report: EvaluationReport): string {
  const lines = [
    `Evaluation of ${report.session} against ${report.databasePath}`,
    `The database is as of ${report.asOf}; "since yesterday" is ${report.since}.`,
    "",
  ];
  for (const result of report.results) {
    lines.push(`${result.passed ? "PASS" : "FAIL"} ${result.id}  ${result.title}`);
    for (const reason of result.reasons) lines.push(`       - ${reason}`);
  }
  const passed = report.results.filter((result) => result.passed).length;
  lines.push("", `${passed} of ${report.results.length} questions passed`);
  return lines.join("\n");
}
