// The tool result envelope (ticket #98): what every tool result carries and every tool call goes through, so that a
// tool is only its own answer. The envelope reads the Index's As of once for each call, and puts it and the notice
// beside the tool's answer.
import type { CallToolResult, McpServer, RegisteredTool, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ServerConfig } from "#/packages/config/index.ts";
import type { IndexReader } from "#/packages/database/reader.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import type { Outcome } from "./lib/outcome.ts";
import { createRateLimiter, rateLimitMessage } from "./lib/rate-limit.ts";
import { stalenessWarning } from "./lib/staleness.ts";

/** The two fields the envelope adds to every tool's output schema, beside the tool's own. */
const envelopeFields = {
  as_of: z
    .string()
    .describe(
      "When the index was last refreshed, in Pacific time with its UTC offset: the start of the latest complete full pull or of a later increment.",
    ),
  notice: z.string().describe("A reminder that this is not the official record."),
};

/** The output schemas folded with the envelope's fields, by the tool's own. A server is built for each request, a schema is not. */
const foldedSchemas = new WeakMap<z.ZodObject, StandardSchemaWithJSON>();

/** The tool's output schema with `as_of` and `notice` added, made once for each schema. */
function withEnvelopeFields(output: z.ZodObject): StandardSchemaWithJSON {
  const known = foldedSchemas.get(output);
  if (known !== undefined) return known;
  const folded: StandardSchemaWithJSON = output.extend(envelopeFields);
  foldedSchemas.set(output, folded);
  return folded;
}

/**
 * The stem of the notice: its text up to, and not including, the full stop or the clause that follows it. It is not a
 * notice by itself; `noticeOf` finishes it.
 */
const NOTICE_STEM =
  "Not the official record of the Oregon Legislature. This is an unofficial copy of public information from the Legislature's Open Data Service";

/** The notice for a result (ADR-0002, spec #1): the full text when the result holds a source_url, else without the clause (ticket #120). */
function noticeOf(holdsSourceUrl: boolean): string {
  return holdsSourceUrl ? `${NOTICE_STEM}; use source_url for the Legislature's own page.` : `${NOTICE_STEM}.`;
}

/** The MCP annotations a tool is registered with. */
type Annotations = { readOnlyHint: true; openWorldHint: boolean };

/**
 * What a tool supplies to the envelope. `output` holds the tool's own fields; the envelope adds `as_of` and `notice`
 * to it, so the schema stays the single source of the tool's `outputSchema`.
 */
export type Tool<Input extends z.ZodObject, Output extends z.ZodObject, Fault> = {
  name: string;
  title: string;
  description: string;
  annotations: Annotations;
  /**
   * Whether this answer holds at least one `source_url` (ticket #120, owner decision of 2026-11-05: the clause is
   * decided for each result, not for each tool). The tool knows it from its own typed answer (a count of its hits, its
   * meetings or its rows), so the envelope does not scan a payload. A result with none, such as session_overview's or
   * an empty search's, gets a notice without the clause that tells the reader to use a source_url.
   */
  carriesSourceUrl(answer: z.infer<Output>): boolean;
  input: Input;
  output: Output;
  /** Answers a call, given the As of the envelope read for it. */
  run(
    input: z.infer<Input>,
    asOf: Timestamp,
  ): Outcome<z.infer<Output>, Fault> | Promise<Outcome<z.infer<Output>, Fault>>;
  /** What an agent is told of a fault, so it can correct the call. */
  faultMessage(fault: Fault): string;
};

export type EnvelopeDeps = {
  reader: IndexReader;
  config: ServerConfig;
  clock: Clock;
};

export type Envelope = {
  /**
   * Registers the tool on the server. The tool's output schema is registered with `as_of` and `notice` added, and each
   * call is answered by `answer`.
   */
  register<Input extends z.ZodObject, Output extends z.ZodObject, Fault>(
    server: McpServer,
    tool: Tool<Input, Output, Fault>,
  ): RegisteredTool;
  /** Answers one call of a tool, as the server sends it. */
  answer<Input extends z.ZodObject, Output extends z.ZodObject, Fault>(
    tool: Tool<Input, Output, Fault>,
    input: z.infer<Input>,
  ): Promise<CallToolResult>;
};

/**
 * What an agent is told while the Index has no As of. The As of is when the latest complete Full pull, or a later
 * Increment, began (GLOSSARY.md), so an Index that has had no complete Full pull has none. That is a state a deployment
 * is in between its start and its first pull, not a bug.
 */
function noAsOfMessage(session: SessionKey): string {
  return `The index of the ${session} Session has no as-of time: no full pull has completed yet, and the as-of time is when the latest complete full pull, or a later increment, began. Ask again once the first full pull has finished.`;
}

/** A tool error: the agent reads the text and can act on it. */
function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

export function createEnvelope(deps: EnvelopeDeps): Envelope {
  // One limiter for the process: the stateless handler builds a server for each request, but not an envelope.
  const limiter = createRateLimiter({
    limit: deps.config.rateLimit,
    windowSeconds: deps.config.rateWindowSeconds,
    clock: deps.clock,
  });
  /** The result of one call, before the Staleness warning. */
  async function resultOf<Input extends z.ZodObject, Output extends z.ZodObject, Fault>(
    tool: Tool<Input, Output, Fault>,
    input: z.infer<Input>,
    asOf: Timestamp | undefined,
  ): Promise<CallToolResult> {
    const turn = limiter.take();
    if (!turn.allowed) {
      return errorResult(
        rateLimitMessage(deps.config.rateLimit, deps.config.rateWindowSeconds, turn.retryAfterSeconds),
      );
    }
    if (asOf === undefined) return errorResult(noAsOfMessage(deps.config.session));
    const outcome = await tool.run(input, asOf);
    switch (outcome.kind) {
      case "answer": {
        const stamped = { ...outcome.answer, as_of: asOf, notice: noticeOf(tool.carriesSourceUrl(outcome.answer)) };
        return { content: [{ type: "text", text: JSON.stringify(stamped) }], structuredContent: stamped };
      }
      case "fault":
        return errorResult(tool.faultMessage(outcome.fault));
      default:
        return outcome satisfies never;
    }
  }

  async function answer<Input extends z.ZodObject, Output extends z.ZodObject, Fault>(
    tool: Tool<Input, Output, Fault>,
    input: z.infer<Input>,
  ): Promise<CallToolResult> {
    // The As of is read once for the call: the answer carries it, and the warning is about it.
    const asOf = deps.reader.asOf(deps.config.session);
    const result = await resultOf(tool, input, asOf);
    // Every result carries the warning, when there is one (ADR-0039): one more block of text after the tool's own, so no
    // tool's output schema changes. An Index with no As of is not old, it is empty.
    const warning = asOf === undefined ? undefined : stalenessWarning(deps.reader, deps.config, deps.clock, asOf);
    return warning === undefined
      ? result
      : { ...result, content: [...result.content, { type: "text", text: warning }] };
  }

  function register<Input extends z.ZodObject, Output extends z.ZodObject, Fault>(
    server: McpServer,
    tool: Tool<Input, Output, Fault>,
  ): RegisteredTool {
    // Typed as the SDK's schema interface, which a zod object satisfies: the SDK then types the arguments as a plain
    // record, and the SDK has parsed them with this very schema, so they are what `z.infer` says.
    const inputSchema: StandardSchemaWithJSON = tool.input;
    const outputSchema = withEnvelopeFields(tool.output);
    return server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema,
        outputSchema,
        annotations: tool.annotations,
      },
      (input) => answer(tool, input as z.infer<Input>),
    );
  }

  return { register, answer };
}
