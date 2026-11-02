// Seam 1 (test/CLAUDE.md): what an agent sees from every tool while the Index holds no As of, that is, before the first
// complete Full pull (ticket #98, GLOSSARY.md "As of"), and the output schemas the tools advertise with it.
//
// Why seam 1 and not seam 4. The rule "every tool fails with the same error" is held by the tool result envelope, and
// seam 4 would call the envelope with one made-up tool, which is the quickest way to show the envelope's own cases
// (src/packages/mcp-server/tests/envelope.test.ts does). But the box says every tool, and which tools go through the
// envelope is decided by how handler.ts registers them: only a call to each registered tool shows that all eight do.
// The machinery this needs is small: no fake OLIS and no worker, because there is nothing to pull. The database is an
// empty file the writer created and closed (the state a deployment is in between its start and its first complete
// pull, since the server serves while the worker pulls, ADR-0007), the handler is built over it the way startSystem
// builds it, and an MCP client calls the tools. One handler serves every case: none of them changes the database.
//
// What the tools did before the envelope (read on 2026-11-02, the commit before this file): get_measure,
// compare_amendment, get_document and testimony looked their reference up first and answered "No Measure ..." (an
// unknown id), so an agent on an index that had not been pulled yet was told its id was wrong; meetings with a
// date range, search, find_measures and session_overview read the As of and threw "The index holds no completed full
// pull ...", each in its own wording, which the SDK turned into the same kind of result (isError true, the message as
// text, no structured content).
//
// The expected wording is the glossary's: the As of is the moment the latest complete Full pull, or a later
// Increment, began, so an index with no complete Full pull has none.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadServerConfig } from "#/packages/config/index.ts";
import { openIndexWriter } from "#/packages/database/writer.ts";
import { createSessionGatewayHandler, type SessionGatewayHandler } from "#/packages/mcp-server/handler.ts";
import { createSimulatedClock } from "../support/clock.ts";
import { createFakeEmbedder } from "../support/fake-embedder.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { modelPath } from "../support/real-embedder.ts";
import { createTempDatabase, type TempDatabase } from "../support/temp-database.ts";

let database: TempDatabase;
let handler: SessionGatewayHandler;
const shutdown = new AbortController();

beforeAll(async () => {
  database = createTempDatabase();
  openIndexWriter(database.path).close();
  handler = createSessionGatewayHandler(
    loadServerConfig({
      SESSION_KEY: "2025R1",
      OLIS_BASE_URL: "http://olis.invalid/",
      DATABASE_PATH: database.path,
      MODEL_PATH: modelPath(),
    }),
    {
      clock: createSimulatedClock("2026-08-01T17:00:00Z"),
      // Nothing is asked of OLIS: a lookup that did would fail on this address.
      fetch,
      signal: shutdown.signal,
      onLiveLookupFailed: () => {},
      embedder: await createFakeEmbedder(),
    },
  );
});

afterAll(async () => {
  shutdown.abort();
  await handler.close();
  database.remove();
});

/** One valid call of each tool. The ids are ones the fixture holds, but this index holds nothing at all. */
const calls: [tool: string, args: Record<string, unknown>][] = [
  ["get_measure", { measure: "SB 69" }],
  ["compare_amendment", { amendment: "SB 69-2" }],
  ["get_document", { id: "version-2025r1-sb69-introduced" }],
  ["meetings", { from: "2025-01-21" }],
  ["testimony", { measure: "SB 69" }],
  ["find_measures", { agency: "bureau-of-labor-and-industries" }],
  ["search", { query: "leave" }],
  ["session_overview", {}],
];

describe.for(eras)("an index with no As of, for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  it("fails every tool with one error that says the index has no As of because no Full pull has completed", async () => {
    const outcomes = [];
    for (const [tool, args] of calls) outcomes.push({ tool, ...(await callTool(connected, tool, args)) });

    expect(outcomes.map((outcome) => [outcome.tool, outcome.isError])).toEqual(calls.map(([tool]) => [tool, true]));
    expect(outcomes.map((outcome) => outcome.structured)).toEqual(calls.map(() => undefined));
    // The same words from all eight tools: the first text stands for each of them.
    const [first] = outcomes;
    expect(outcomes.map((outcome) => [outcome.tool, outcome.text])).toEqual(calls.map(([tool]) => [tool, first?.text]));
    expect(first?.text).toContain("2025R1");
    expect(first?.text).toContain("no as-of time");
    expect(first?.text).toContain("no full pull has completed");
    expect(first?.text).toContain("the latest complete full pull, or a later increment, began");
  });
});

// The clients' listTools() validation (connectClient calls it first) checks each result's structured content against the
// schema, whose objects allow no other property: a tool whose schema left out as_of or notice would fail every seam-1
// test. This reads the schemas themselves.
describe.for(eras)("the output schemas the tools advertise to a %s client", (era) => {
  it("list as_of and notice as required properties of all eight tools", async () => {
    const connected = await connectClient(era, handler);
    const { tools } = await connected.client.listTools();
    await connected.close();

    expect(tools.map((tool) => tool.name).toSorted()).toEqual(calls.map(([tool]) => tool).toSorted());
    for (const tool of tools) {
      const schema = tool.outputSchema as { properties: Record<string, { type: string }>; required: string[] };
      expect(schema.properties["as_of"], tool.name).toMatchObject({ type: "string" });
      expect(schema.properties["notice"], tool.name).toMatchObject({ type: "string" });
      expect(schema.required, tool.name).toEqual(expect.arrayContaining(["as_of", "notice"]));
    }
  });
});
