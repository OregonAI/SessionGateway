// Seam 1 (test/CLAUDE.md): `search` filtered by Agency (ticket #16, spec #1 story 10), over the whole committed
// fixture as the feed stood on 2026-08-01. The filter keeps the hits whose Measure has an Agency Link to the Agency, of
// any evidence (ADR-0028). It does not depend on how a meaning ranks, so the embedder is the fake
// (test/support/fake-embedder.ts), as in search-whole-session.test.ts; the filter is applied to both sides of the
// search, the words and the vectors, and the fake's vectors are what the meaning side scans.
//
// The Bureau of Labor and Industries has Agency Links to two Measures of the fixture: SB 69 (its Fiscal Impact Statement,
// its text, Testimony 196915 and the sections it amends) and HB 3027, whose Versions add a section to ORS 345.010 to
// 345.340, a chapter the snapshot gives to the Bureau (among others). No other Measure of the fixture names the Bureau in
// a statement or its text, submits Testimony as it, or changes a section in a chapter it implements.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  system = await startSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "100000" },
  });
}, 120_000);

afterAll(async () => {
  await system.stop();
});

type Hit = { id: string; measure: string | null; kind: string };

describe.for(eras)("search by Agency for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  const boli = "bureau-of-labor-and-industries";
  const measuresOf = (hits: Hit[]): string[] => [...new Set(hits.map((hit) => hit.measure ?? "none"))].toSorted();

  async function search(args: Record<string, unknown>): Promise<{ hits: Hit[]; notes: string[] }> {
    const outcome = await callTool(connected, "search", args);
    expect(outcome.isError, outcome.text).toBe(false);
    return {
      hits: outcome.structured?.["results"] as Hit[],
      notes: outcome.structured?.["notes"] as string[],
    };
  }

  it("keeps the hits of the Measures the Agency has a link to, and no others", async () => {
    const filtered = await search({ query: "sick time paid leave", agency: boli, limit: 50 });
    const unfiltered = await search({ query: "sick time paid leave", limit: 50 });

    expect(filtered.hits.length).toBeGreaterThan(0);
    expect(
      measuresOf(filtered.hits).every((measure) => ["measure-2025r1-hb3027", "measure-2025r1-sb69"].includes(measure)),
    ).toBe(true);
    // Without the filter the same question reaches other Measures, so the filter is what removed them.
    expect(measuresOf(unfiltered.hits).length).toBeGreaterThan(2);
  });

  it("counts a link of any evidence: HB 3027 has only a link derived through a Statute Link", async () => {
    const { hits } = await search({ query: "injunction private career school", agency: boli, limit: 50 });

    expect(hits.some((hit) => hit.measure === "measure-2025r1-hb3027")).toBe(true);
  });

  it("filters the words as well as the meaning: an exact citation of a Measure the Agency has no link to finds nothing", async () => {
    const { hits } = await search({ query: "HB 3131", agency: boli });

    expect(hits.filter((hit) => hit.measure === "measure-2025r1-hb3131")).toEqual([]);
  });

  it("keeps an exact citation of a Measure the Agency has a link to first", async () => {
    const { hits } = await search({ query: "SB 69", agency: boli });

    expect(hits[0]).toMatchObject({ id: "version-2025r1-sb69-introduced", measure: "measure-2025r1-sb69" });
  });

  it("says so when the index holds no Agency Link to the slug, and finds nothing", async () => {
    const { hits, notes } = await search({ query: "sick time", agency: "no-such-agency" });

    expect(hits).toEqual([]);
    expect(notes).toEqual([
      "The index holds no Agency Link to no-such-agency, so no hit has a Measure with one. Check the slug against the OregonAI agency registry.",
    ]);
  });

  // #16 F11: search's `agency` is parsed at the edge, as find_measures' is, so the same input is the same tool error in
  // both tools. A name is not a registry slug; a slug the index holds no link to is a normal answer with a note (above).
  it("refuses a name where a slug is wanted, with the message find_measures gives", async () => {
    const message =
      '"Bureau of Labor and Industries" is not an Agency id. Give an OregonAI agency registry slug such as bureau-of-labor-and-industries.';

    const searched = await callTool(connected, "search", {
      query: "sick time",
      agency: "Bureau of Labor and Industries",
    });
    const found = await callTool(connected, "find_measures", { agency: "Bureau of Labor and Industries" });

    expect(searched.isError).toBe(true);
    expect(searched.text).toBe(message);
    expect(found.isError).toBe(true);
    expect(found.text).toBe(message);
  });
});
