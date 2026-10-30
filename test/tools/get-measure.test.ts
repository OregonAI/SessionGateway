// Seam 1 (test/CLAUDE.md): get_measure as an agent sees it, with the whole system behind it. A fake
// OLIS serves the committed fixture as the feed stood on 2025-01-29, the ingest worker pulls it into
// a database, and an MCP client calls the tool in-process. One database serves every case in this
// file because none of them changes it; cases that build their own are in get-measure-feed.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

// Expected values are literals from outside the code: the CatchLine is the feed row's as the fixture
// holds it (test/fixtures/olis-2025R1/feed/Measures.json, SB 69), the id form is spec #1's, and the
// page is the Measure's OLIS page (docs/research/olis-odata.md section 2, "OLIS measure pages").
const sb69Catchline =
  "Specifies that the Bureau of Labor and Industries is responsible for certain administrative and regulatory oversight regarding certain provisions under the laws governing paid family and medical leave that relate to retaliation and discrimination.";

let system: System;

beforeAll(async () => {
  // 2025-01-29 09:00 in Oregon, the day before SLB heard SB 69 (spec #1, case (c)).
  system = await startSystem({ clockAt: "2025-01-29T17:00:00Z" });
});

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("get_measure for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  it("returns SB 69 with its id, catchline, source_url, as-of time and the non-official notice", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({
      id: "measure-2025r1-sb69",
      catchline: sb69Catchline,
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Measures/Overview/SB69",
      as_of: "2025-01-29T09:00:00-08:00",
    });
    expect.soft(outcome.structured?.["notice"]).toMatch(/not the official record/i);
  });

  it.for([
    ["a citation", "SB 69", "measure-2025r1-sb69"],
    ["a citation without the space, in lower case", "sb69", "measure-2025r1-sb69"],
    ["an id", "measure-2025r1-sb69", "measure-2025r1-sb69"],
    ["another Measure's citation", "HB 3131", "measure-2025r1-hb3131"],
    ["another Measure's id", "measure-2025r1-hb3131", "measure-2025r1-hb3131"],
  ])("finds the Measure from %s (%s)", async ([, reference, id]) => {
    const outcome = await callTool(connected, "get_measure", { measure: reference });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({ id });
  });

  it.for([
    ["a Measure the Session does not have", "SB 9999"],
    ["an id the Session does not have", "measure-2025r1-hb9999"],
    ["an id from another Session", "measure-2025s1-sb69"],
    ["words that are neither", "the paid leave bill"],
  ])("reports %s as a tool error, not as a result", async ([, reference]) => {
    const outcome = await callTool(connected, "get_measure", { measure: reference });

    expect(outcome.isError).toBe(true);
    expect(outcome.structured).toBeUndefined();
    expect(outcome.text).toContain(reference);
    expect(outcome.text).toContain("2025R1");
    // The message teaches the agent the id form (spec #1's), so it can correct the call.
    expect(outcome.text).toContain("measure-2025r1-sb69");
  });

  it("teaches, in a tool error, the same id form that a found Measure carries", async () => {
    const found = await callTool(connected, "get_measure", { measure: "SB 69" });
    const unknown = await callTool(connected, "get_measure", { measure: "SB 9999" });

    expect(unknown.text).toContain(String(found.structured?.["id"]));
  });

  it("advertises every tool as read-only, with an output schema, get_measure among them", async () => {
    const { tools } = await connected.client.listTools();

    expect(tools.map((tool) => tool.name)).toContain("get_measure");
    for (const tool of tools) {
      expect.soft(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect.soft(tool.outputSchema, tool.name).toBeDefined();
    }
  });
});
