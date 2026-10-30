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

/**
 * The description of a property of a JSON schema, found by the names of its properties from the root
 * ("[]" steps into the items of an array).
 */
function describedAs(schema: unknown, path: readonly string[]): string {
  let node = schema as { properties?: Record<string, unknown>; items?: unknown; description?: unknown } | undefined;
  for (const name of path) node = (name === "[]" ? node?.items : node?.properties?.[name]) as typeof node;
  return typeof node?.description === "string" ? node.description : "";
}

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

  // The cache's Measures rows keep a CurrentCommitteeCode on some Measures whose CurrentLocation says they are
  // at the President's desk and give none for one that is "In House Committee" (docs/research/olis-votes.md
  // section 6), so the code says nothing about where the Measure is by itself.
  it("tells an agent that the committee code is the feed's and can be set where the Measure is no longer in committee", async () => {
    const { tools } = await connected.client.listTools();

    const description = describedAs(tools[0]?.outputSchema, ["location", "committee_code"]);
    expect(description).toContain("At Presidents Desk Upon Adjournment");
    expect(description).not.toMatch(/the committee the Measure is in/i);
  });

  it("tells an agent that a committee vote's meeting can be later than as_of, with answers already listed", async () => {
    const { tools } = await connected.client.listTools();

    const description = describedAs(tools[0]?.outputSchema, ["committee_votes"]);
    expect(description).toContain("meeting_date is later than as_of");
    expect(description).toContain("the feed does not say whether that vote has been taken");
  });

  it.for([["floor_votes"], ["committee_votes"]])(
    "says that the votes of a roll in %s come in the order of the ids the feed gives the entries",
    async ([votes]) => {
      const { tools } = await connected.client.listTools();

      const description = describedAs(tools[0]?.outputSchema, [votes as string, "[]", "votes"]);
      expect(description).toContain("in the order of the ids the feed gives the entries");
    },
  );

  it("advertises get_measure as the one read-only tool, with an output schema", async () => {
    const { tools } = await connected.client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["get_measure"]);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.outputSchema).toBeDefined();
  });
});
