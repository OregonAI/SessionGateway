// Seam 1 (test/CLAUDE.md): `search` over the whole committed fixture, as the feed stood on 2026-08-01, when
// every row of it exists. Citations, the size of an answer and the hits' ids need the Measures and
// Proposed Amendments that come late in the Session, and the whole fixture holds SB 64's Testimony 117281
// (395,000 characters), which the real model would take half a minute to embed. None of these cases is about
// how well a meaning ranks, so the embedder is the fake (test/support/fake-embedder.ts); the cases that are
// use the real model on an early clock (search.test.ts, search-keyword-only.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;
let connected: ConnectedClient;

beforeAll(async () => {
  system = await startSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    // About sixty calls are made on the one simulated clock: the default ceiling is 120 a minute.
    serverEnv: { MCP_RATE_LIMIT: "100000" },
  });
  connected = await connectClient("2026-07-28", system.handler);
}, 120_000);

afterAll(async () => {
  await connected.close();
  await system.stop();
});

type Hit = {
  id: string;
  document_id: string;
  kind: string;
  title: string;
  measure: string | null;
  date: string | null;
  snippet: string;
  source_url: string;
  found_by: string[];
};
const hitsOf = (outcome: { structured: Record<string, unknown> | undefined }): Hit[] =>
  outcome.structured?.["results"] as Hit[];

describe("an exact citation", () => {
  // SB 69's -2 was posted to SLB's meetings of 2025-01-28 (CommitteeProposedAmendments row 26286, Proposed) and
  // 2025-01-30 (row 26288, Adopted), a file for each. It is one node, whose text is the later posting's.
  it("of a Proposed Amendment puts the amendment first, once, however many meetings it was posted to", async () => {
    const outcome = await callTool(connected, "search", { query: "SB 69-2" });

    expect(hitsOf(outcome)[0]).toMatchObject({
      id: "amendment-2025r1-sb69-2",
      document_id: "posting-2025r1-26288",
      kind: "proposed_amendment",
      title: "SB 69-2",
      measure: "measure-2025r1-sb69",
    });
    expect(hitsOf(outcome).filter((hit) => hit.id === "amendment-2025r1-sb69-2")).toHaveLength(1);
    expect(hitsOf(outcome).filter((hit) => hit.id.startsWith("posting-"))).toEqual([]);
  });

  // HB 3795's MeasureDocuments rows: Introduced (created 2025-02-26), A-Engrossed (04-07), B-Engrossed (05-27) and
  // Enrolled (06-16), and Printed Amendments "House Amendments to Introduced" and "Senate Amendments to
  // A-Engrossed", which are not Versions.
  it("of a Measure puts its Versions first, from Introduced to Enrolled", async () => {
    const outcome = await callTool(connected, "search", { query: "HB 3795" });

    expect(
      hitsOf(outcome)
        .map((hit) => hit.id)
        .slice(0, 4),
    ).toEqual([
      "version-2025r1-hb3795-introduced",
      "version-2025r1-hb3795-a-engrossed",
      "version-2025r1-hb3795-b-engrossed",
      "version-2025r1-hb3795-enrolled",
    ]);
  });

  // `pdftotext -raw` finds "ORS 418.808" (and not a longer number) in these documents of the fixture: HB 3795's
  // B-Engrossed and Enrolled Versions and its Printed Amendment "Senate Amendments to A-Engrossed", Staff Measure
  // Summary 92329, Exhibits 305864 and 306030, the three postings of Proposed Amendment -A3 (28997, 29108 and
  // 29109: one node) and Testimony 209256 and 209569. The Statutes Affected Table holds "418.808" with no "ORS"
  // before it, and is linked by no feed row.
  const holding = [
    "amendment-2025r1-hb3795-a3",
    "analysis-2025r1-92329",
    "exhibit-2025r1-305864",
    "exhibit-2025r1-306030",
    "printed-amendment-2025r1-hb3795-senate-amendments-to-a-engrossed",
    "version-2025r1-hb3795-b-engrossed",
    "version-2025r1-hb3795-enrolled",
  ];

  it("of an ORS section puts the documents whose text holds it first, and leaves Testimony for those who ask", async () => {
    const general = await callTool(connected, "search", { query: "ORS 418.808" });
    const withLetters = await callTool(connected, "search", { query: "ORS 418.808", include_testimony: true });

    expect(
      hitsOf(general)
        .slice(0, holding.length)
        .map((hit) => hit.id)
        .toSorted(),
    ).toEqual(holding);
    expect(
      hitsOf(general)
        .slice(0, holding.length)
        .every((hit) => hit.found_by.includes("citation")),
    ).toBe(true);
    expect(
      hitsOf(withLetters)
        .slice(0, holding.length + 2)
        .map((hit) => hit.id)
        .toSorted(),
    ).toEqual([...holding, "testimony-2025r1-209256", "testimony-2025r1-209569"].toSorted());
  });
});

describe("the size and the contents of an answer", () => {
  it("is twenty hits unless the call asks for fewer or more, and fifty at most", async () => {
    const standard = await callTool(connected, "search", { query: "committee" });
    const few = await callTool(connected, "search", { query: "committee", limit: 3 });
    const many = await callTool(connected, "search", { query: "committee", limit: 50 });

    expect(hitsOf(standard)).toHaveLength(20);
    expect(hitsOf(few)).toHaveLength(3);
    expect(hitsOf(many)).toHaveLength(50);
    const tooMany = await callTool(connected, "search", { query: "committee", limit: 51 });
    expect(tooMany.isError).toBe(true);
    expect(tooMany.text).toContain("limit");
  });

  it("gives every hit what an agent needs to cite it, and an id that get_document resolves", async () => {
    const outcome = await callTool(connected, "search", { query: "Department of Human Services", limit: 50 });

    const hits = hitsOf(outcome);
    expect(hits.length).toBeGreaterThan(20);
    expect(outcome.structured?.["as_of"]).toBe("2026-08-01T10:00:00-07:00");
    expect(outcome.structured?.["notice"]).toMatch(/not the official record/i);
    for (const hit of hits) {
      expect(hit.title, hit.id).not.toBe("");
      expect(hit.source_url, hit.id).toMatch(/^https:\/\/olis\.oregonlegislature\.gov\/liz\/2025R1\/Downloads\//);
      expect(hit.snippet.length, hit.id).toBeLessThanOrEqual(310);
      const document = await callTool(connected, "get_document", { id: hit.id });
      expect(document.isError, hit.id).toBe(false);
      expect(document.structured, hit.id).toMatchObject({ id: hit.id, kind: hit.kind });
      // A Proposed Amendment is served as its latest posting, which can be another file than the one that matched.
      if (hit.kind !== "proposed_amendment") expect(document.structured?.["source_url"], hit.id).toBe(hit.source_url);
    }
  }, 60_000);

  it("is an empty list, not an error, for a query with no words to look for", async () => {
    const outcome = await callTool(connected, "search", { query: "what is the" });

    expect(outcome.isError).toBe(false);
    expect(hitsOf(outcome)).toEqual([]);
  });
});
