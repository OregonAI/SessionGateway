// Seam 4 (test/CLAUDE.md): the tool result envelope's entry point (ticket #98), called directly with its real
// collaborators: an Index that package entry points arrange in a WAL database in a temp directory of its own, the
// config schema's own object, and a made-up tool. There is no fake OLIS, no worker and no MCP client. It covers the
// envelope's own cases, fast; test/tools/index-without-as-of.test.ts is the seam-1 check that every tool goes through it,
// and the seam-1 files of the rate limit, the Staleness warning, As of and each tool's errors stay as they are.
//
// The made-up tool greets a name. The Index is empty of Measures and documents: the envelope reads only its As of and
// when its latest Full pull began (`recordFullPull` and `recordIncrement` store both from a record with no rows).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { loadServerConfig, type ServerConfig } from "#/packages/config/index.ts";
import { openIndexReader } from "#/packages/database/reader.ts";
import { openIndexWriter, type FullPullRecord, type IndexWriter } from "#/packages/database/writer.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";
import { createEnvelope, type Envelope, type Tool } from "../envelope.ts";

/** A full pull that read nothing: it still gives the Index an As of and a latest Full pull. */
const readNothing: FullPullRecord = {
  Measures: [],
  Legislators: [],
  MeasureSponsors: [],
  MeasureHistoryActions: [],
  MeasureVotes: [],
  CommitteeVotes: [],
  Committees: [],
  CommitteeMeetings: [],
  CommitteeAgendaItems: [],
  MeasureDocuments: [],
  MeasureAnalysisDocuments: [],
  CommitteeMeetingDocuments: [],
  CommitteeProposedAmendments: [],
  CommitteePublicTestimonies: [],
  CommitteeMembers: [],
  ConveneTimes: [],
  LegislativeSessions: undefined,
  FloorLetters: [],
  legislators: [],
  legislatorCodes: [],
};

const greetingInput = z.object({ name: z.string() });
const greetingOutput = z.object({ greeting: z.string().describe("What the tool says.") });
type GreetingFault = { kind: "stranger"; name: string };
type Greeter = Tool<typeof greetingInput, typeof greetingOutput, GreetingFault>;

/** A tool that greets anyone but Mallory, and writes down the As of it was given. */
function greeter(seen: Timestamp[] = [], carriesSourceUrl = true): Greeter {
  return {
    carriesSourceUrl: () => carriesSourceUrl,
    name: "greet",
    title: "Greet",
    description: "Greets a name.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    input: greetingInput,
    output: greetingOutput,
    run: (input, asOf) => {
      seen.push(asOf);
      return input.name === "Mallory"
        ? { kind: "fault", fault: { kind: "stranger", name: input.name } }
        : { kind: "answer", answer: { greeting: `Hello, ${input.name}` } };
    },
    faultMessage: (fault) => `Nobody called ${fault.name} is known here.`,
  };
}

/** The text of each block of a result, in order. */
function texts(result: CallToolResult): string[] {
  return result.content.map((block) => (block.type === "text" ? block.text : ""));
}

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

type Arranged = {
  envelope: Envelope;
  config: ServerConfig;
  /** The worker's side of the Index, still open: the server serves while the worker writes (ADR-0007). */
  writer: IndexWriter;
  moveClockTo: (instant: string) => void;
};

/**
 * An envelope over an Index whose Full pull began at `pulledAt` (none when it is undefined) and whose Increment, when
 * given, began at `incrementedAt`. The clock stands at `now`, which is the Full pull's time unless given. The writer
 * that arranged it stays open beside the reader, as the worker does beside the server, so that a case can write while
 * the envelope serves.
 */
function arrange(
  state: { pulledAt?: string; incrementedAt?: string; now?: string; env?: Record<string, string> } = {},
): Arranged {
  const directory = mkdtempSync(join(tmpdir(), "session-gateway-envelope-"));
  const databasePath = join(directory, "index.db");
  const config = loadServerConfig({
    SESSION_KEY: "2025R1",
    OLIS_BASE_URL: "http://olis.invalid/",
    DATABASE_PATH: databasePath,
    MODEL_PATH: "/nowhere",
    ...state.env,
  });
  const writer = openIndexWriter(databasePath);
  if (state.pulledAt !== undefined) {
    writer.recordFullPull(config.session, formatPacific(new Date(state.pulledAt)), readNothing);
  }
  if (state.incrementedAt !== undefined) {
    writer.recordIncrement(config.session, formatPacific(new Date(state.incrementedAt)), readNothing);
  }
  const reader = openIndexReader(databasePath);
  disposers.push(() => {
    reader.close();
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let now = new Date(state.now ?? state.pulledAt ?? "2026-08-01T17:00:00Z");
  const clock: Clock = { now: () => new Date(now) };
  return {
    envelope: createEnvelope({ reader, config, clock }),
    config,
    writer,
    moveClockTo: (instant) => {
      now = new Date(instant);
    },
  };
}

describe("an answer", () => {
  it("is the tool's answer with the As of and the notice, as the JSON text and as the structured content", async () => {
    const { envelope } = arrange({ pulledAt: "2026-08-01T17:00:00Z" });

    const result = await envelope.answer(greeter(), { name: "Ada" });

    const answer = {
      greeting: "Hello, Ada",
      as_of: "2026-08-01T10:00:00-07:00",
      notice:
        "Not the official record of the Oregon Legislature. This is an unofficial copy of public information from the Legislature's Open Data Service; use source_url for the Legislature's own page.",
    };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(answer);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(answer) }]);
  });

  it("of a result that holds no source_url leaves out the clause that tells the reader to use one (ticket #120)", async () => {
    const { envelope } = arrange({ pulledAt: "2026-08-01T17:00:00Z" });

    const result = await envelope.answer(greeter([], false), { name: "Ada" });

    const answer = {
      greeting: "Hello, Ada",
      as_of: "2026-08-01T10:00:00-07:00",
      notice:
        "Not the official record of the Oregon Legislature. This is an unofficial copy of public information from the Legislature's Open Data Service.",
    };
    expect(result.structuredContent).toEqual(answer);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(answer) }]);
  });

  it("of one tool is decided by each result: the same tool's results with and without a source_url differ in the clause (ticket #120)", async () => {
    const { envelope } = arrange({ pulledAt: "2026-08-01T17:00:00Z" });
    const tool: Greeter = { ...greeter(), carriesSourceUrl: (answer) => answer.greeting !== "Hello, nobody" };

    const held = await envelope.answer(tool, { name: "Ada" });
    const none = await envelope.answer(tool, { name: "nobody" });

    expect(held.structuredContent).toMatchObject({
      notice:
        "Not the official record of the Oregon Legislature. This is an unofficial copy of public information from the Legislature's Open Data Service; use source_url for the Legislature's own page.",
    });
    expect(none.structuredContent).toMatchObject({
      notice:
        "Not the official record of the Oregon Legislature. This is an unofficial copy of public information from the Legislature's Open Data Service.",
    });
  });

  it("is dated by the Index's As of: a later Increment's, and the tool is given the same", async () => {
    const { envelope } = arrange({ pulledAt: "2026-08-01T17:00:00Z", incrementedAt: "2026-08-01T17:45:00Z" });
    const seen: Timestamp[] = [];

    const result = await envelope.answer(greeter(seen), { name: "Ada" });

    expect(result.structuredContent).toMatchObject({ as_of: "2026-08-01T10:45:00-07:00" });
    expect(seen).toEqual(["2026-08-01T10:45:00-07:00"]);
  });
});

describe("a fault", () => {
  it("is a tool error that says what the tool says of it, with no structured content", async () => {
    const { envelope } = arrange({ pulledAt: "2026-08-01T17:00:00Z" });

    const result = await envelope.answer(greeter(), { name: "Mallory" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "Nobody called Mallory is known here." }]);
  });
});

describe("an Index with no As of", () => {
  // The As of is when the latest complete Full pull, or a later Increment, began (GLOSSARY.md), so before the first
  // complete Full pull there is none, and no tool has anything to date its answer by.
  it("is a tool error, worded by what the As of is, and the tool is not run", async () => {
    const { envelope } = arrange();
    const seen: Timestamp[] = [];

    const result = await envelope.answer(greeter(seen), { name: "Ada" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: "text",
        text: "The index of the 2025R1 Session has no as-of time: no full pull has completed yet, and the as-of time is when the latest complete full pull, or a later increment, began. Ask again once the first full pull has finished.",
      },
    ]);
    expect(seen).toEqual([]);
  });

  it("is answered the same for a call the tool would have found a fault in", async () => {
    const { envelope } = arrange();

    const result = await envelope.answer(greeter(), { name: "Mallory" });

    expect(texts(result)).toHaveLength(1);
    expect(texts(result)[0]).toContain("has no as-of time");
  });
});

describe("the rate limit", () => {
  // The MCP specification says a server must rate-limit tool calls (src/CLAUDE.md, "MCP"). The limit counts every call
  // the envelope sees, over all tools and callers together, and the window runs by the injected clock.
  const limitedTo = (calls: string) => ({ MCP_RATE_LIMIT: calls, MCP_RATE_WINDOW_SECONDS: "60" });

  it("refuses the call after the limit with a message that says when to try again, and does not run the tool", async () => {
    const { envelope } = arrange({ pulledAt: "2026-08-01T17:00:00Z", env: limitedTo("2") });
    const seen: Timestamp[] = [];
    const tool = greeter(seen);

    // A fault is a call too.
    await envelope.answer(tool, { name: "Ada" });
    await envelope.answer(tool, { name: "Mallory" });
    const refused = await envelope.answer(tool, { name: "Ada" });

    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toBeUndefined();
    expect(refused.content).toEqual([
      {
        type: "text",
        text: "Rate limit reached: this server answers at most 2 tool calls every 60 seconds. Try again in 60 seconds.",
      },
    ]);
    expect(seen).toHaveLength(2);
  });

  it("answers again once the window has passed", async () => {
    const { envelope, moveClockTo } = arrange({ pulledAt: "2026-08-01T17:00:00Z", env: limitedTo("1") });
    await envelope.answer(greeter(), { name: "Ada" });

    moveClockTo("2026-08-01T17:00:30Z");
    const midway = await envelope.answer(greeter(), { name: "Ada" });
    moveClockTo("2026-08-01T17:01:01Z");
    const later = await envelope.answer(greeter(), { name: "Ada" });

    expect(midway.isError).toBe(true);
    expect(texts(midway)[0]).toContain("Try again in 30 seconds.");
    expect(later.isError).toBeUndefined();
  });

  it("counts a call that finds no As of, and refuses before it says the Index has none", async () => {
    const { envelope } = arrange({ env: limitedTo("1") });

    const first = await envelope.answer(greeter(), { name: "Ada" });
    const second = await envelope.answer(greeter(), { name: "Ada" });

    expect(texts(first)[0]).toContain("has no as-of time");
    expect(texts(second)[0]).toContain("Rate limit reached");
  });
});

describe("the Staleness warning", () => {
  // ADR-0039: one more block of text after the tool's own, when the Index is too old for the rhythm the deployment
  // configured (the defaults: a nightly increment, a weekly full pull). The rule is the ingest package's, and the
  // seam-1 file staleness.test.ts has its cases; these are the envelope's: where the block goes, and on which results.
  const pulledAt = "2026-08-01T17:00:00Z";
  const nineteenDaysLater = "2026-08-20T17:00:00Z";
  const lead = "Warning: this index may be out of date.";

  it("comes after the tool's own block on an answer, and says when the Index was last updated", async () => {
    const { envelope } = arrange({ pulledAt, now: nineteenDaysLater });

    const result = await envelope.answer(greeter(), { name: "Ada" });

    expect(result.isError).toBeUndefined();
    const [answer, warning, ...rest] = texts(result);
    expect(answer).toContain("Hello, Ada");
    expect(warning).toContain(lead);
    expect(warning).toContain("It was last updated at 2026-08-01T10:00:00-07:00");
    expect(rest).toEqual([]);
    // The warning is outside the output schema (ADR-0039): the structured content holds the tool's fields only.
    expect(Object.keys(result.structuredContent ?? {})).toEqual(["greeting", "as_of", "notice"]);
  });

  it("comes after the message of a fault and after a rate-limit refusal", async () => {
    const { envelope } = arrange({ pulledAt, now: nineteenDaysLater, env: { MCP_RATE_LIMIT: "1" } });

    const fault = await envelope.answer(greeter(), { name: "Mallory" });
    const refused = await envelope.answer(greeter(), { name: "Ada" });

    expect(fault.isError).toBe(true);
    expect(texts(fault)).toHaveLength(2);
    expect(texts(fault)[0]).toBe("Nobody called Mallory is known here.");
    expect(texts(fault)[1]).toContain(lead);
    expect(refused.isError).toBe(true);
    expect(texts(refused)).toHaveLength(2);
    expect(texts(refused)[0]).toContain("Rate limit reached");
    expect(texts(refused)[1]).toContain(lead);
  });

  it("is not added while the Index is fresh", async () => {
    const { envelope } = arrange({ pulledAt });

    const result = await envelope.answer(greeter(), { name: "Ada" });

    expect(texts(result)).toHaveLength(1);
  });

  it("is not added when the Index has no As of to be old by", async () => {
    const { envelope } = arrange({ now: nineteenDaysLater });

    const result = await envelope.answer(greeter(), { name: "Ada" });

    expect(texts(result)).toHaveLength(1);
  });

  it("speaks of the As of the answer carries, though an Increment lands while the tool is running", async () => {
    const { envelope, writer, config } = arrange({ pulledAt, now: nineteenDaysLater });
    // The Index's As of is the Full pull's until the worker's Increment lands, which it does while the tool runs. The
    // Increment is the newer As of, and the 18 days since it make no warning: the answer must keep to the older one.
    const tool: Greeter = {
      ...greeter(),
      run: () => {
        writer.recordIncrement(config.session, formatPacific(new Date("2026-08-19T17:00:00Z")), readNothing);
        return { kind: "answer", answer: { greeting: "Hello" } };
      },
    };

    const result = await envelope.answer(tool, { name: "Ada" });

    expect(result.structuredContent).toMatchObject({ as_of: "2026-08-01T10:00:00-07:00" });
    expect(texts(result)[1]).toContain("It was last updated at 2026-08-01T10:00:00-07:00");
    // The next call reads the Increment's As of: the Index did change while the tool ran.
    const next = await envelope.answer(greeter(), { name: "Ada" });
    expect(next.structuredContent).toMatchObject({ as_of: "2026-08-19T10:00:00-07:00" });
  });
});

describe("registering a tool", () => {
  // The output schema is the single source of what the tool advertises (src/CLAUDE.md, "Parse at the boundary"), so the
  // envelope's fields are folded into the tool's own schema; the SDK validates every answer's structured content
  // against it, and the clients do again.
  it("advertises the tool as it supplies it, with an output schema that adds as_of and notice to the tool's fields", () => {
    const { envelope } = arrange({ pulledAt: "2026-08-01T17:00:00Z" });

    const registered = envelope.register(new McpServer({ name: "test", version: "0.0.0" }), greeter());

    expect(registered).toMatchObject({
      title: "Greet",
      description: "Greets a name.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    });
    const advertised = registered.outputSchema?.["~standard"].jsonSchema.output({ target: "draft-2020-12" }) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(advertised.properties).toEqual({
      greeting: { type: "string", description: "What the tool says." },
      as_of: {
        type: "string",
        description:
          "When the index was last refreshed, in Pacific time with its UTC offset: the start of the latest complete full pull or of a later increment.",
      },
      notice: { type: "string", description: "A reminder that this is not the official record." },
    });
    expect(advertised.required).toEqual(["greeting", "as_of", "notice"]);
    // The tool's own schema is not changed: the next registration of it starts from the same fields.
    expect(Object.keys(greetingOutput.shape)).toEqual(["greeting"]);
  });

  it("folds the fields into the output schema once, however many servers register the tool", () => {
    // The stateless handler builds a server for every request, and each registers every tool again.
    const { envelope } = arrange({ pulledAt: "2026-08-01T17:00:00Z" });

    const first = envelope.register(new McpServer({ name: "test", version: "0.0.0" }), greeter());
    const second = envelope.register(new McpServer({ name: "test", version: "0.0.0" }), greeter());

    expect(second.outputSchema).toBe(first.outputSchema);
  });
});
