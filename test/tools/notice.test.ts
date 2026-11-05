// Seam 1 (test/CLAUDE.md): the non-official notice an agent reads in a tool's result (ticket #120). A result with no
// document carries no source_url, so its notice does not tell the reader to use one; a result with documents keeps the
// full text. One tool of each kind is called: session_overview (no document) and get_measure (a document tool).
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
  system = await startCopiedSystem({ clockAt: "2025-01-29T17:00:00Z" });
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
});
