// Seam 1 (test/CLAUDE.md): the non-official notice an agent reads in a tool's result (ticket #120). A result with no
// source_url carries no clause telling the reader to use one; a result that holds at least one source_url keeps the
// full text (owner decision of 2026-11-05: per result, not per tool). So session_overview never has the clause, a
// search, a Measure's testimony or a range of meetings has it only when it holds a document, and get_measure has it.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates). Expected values are the notice's wording as ADR-0002 and spec #1 give it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const withoutSourceUrl =
  "Not the official record of the Oregon Legislature. This is an unofficial copy of public information from the Legislature's Open Data Service.";
const withSourceUrl =
  "Not the official record of the Oregon Legislature. This is an unofficial copy of public information from the Legislature's Open Data Service; use source_url for the Legislature's own page.";

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({ clockAt: "2025-01-18T02:00:00Z", documents: true });
});

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("the notice for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  it("of session_overview, which returns no document, has no source_url clause", async () => {
    const outcome = await callTool(connected, "session_overview", {});

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["notice"]).toBe(withoutSourceUrl);
  });

  it("of get_measure, which returns documents' source_urls, keeps the full text", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["notice"]).toBe(withSourceUrl);
  });

  it("of a search with hits keeps the full text", async () => {
    const outcome = await callTool(connected, "search", { query: "waive supplemental nutrition assistance" });

    expect(outcome.isError).toBe(false);
    expect((outcome.structured?.["results"] as unknown[]).length).toBeGreaterThan(0);
    expect(outcome.structured?.["notice"]).toBe(withSourceUrl);
  });

  it("of a search with no hit has no source_url clause", async () => {
    const outcome = await callTool(connected, "search", { query: "waive supplemental nutrition", kind: "floor_letter" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["results"]).toEqual([]);
    expect(outcome.structured?.["notice"]).toBe(withoutSourceUrl);
  });

  it("of testimony on a Measure with no rows has no source_url clause", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 69" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["total"]).toBe(0);
    expect(outcome.structured?.["notice"]).toBe(withoutSourceUrl);
  });

  it("of meetings over a range with none has no source_url clause", async () => {
    const outcome = await callTool(connected, "meetings", { from: "2024-01-01", to: "2024-01-02" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["meetings"]).toEqual([]);
    expect(outcome.structured?.["notice"]).toBe(withoutSourceUrl);
  });

  it("of meetings over a range with a meeting keeps the full text", async () => {
    const outcome = await callTool(connected, "meetings", { from: "2025-01-21", to: "2025-01-28" });

    expect(outcome.isError).toBe(false);
    expect((outcome.structured?.["meetings"] as unknown[]).length).toBeGreaterThan(0);
    expect(outcome.structured?.["notice"]).toBe(withSourceUrl);
  });
});
