// Seam 1 (test/CLAUDE.md): get_document as an agent sees it, with the whole system behind it. A fake
// OLIS serves the committed fixture and its 278 documents as the feed stood in August 2026, the ingest
// worker pulls them into a database, and an MCP client calls the tool in-process. One database serves
// every case in this file because none of them changes it; cases that build their own are in
// get-document-pull.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then (the newest Exhibit row was
  // created on 2026-07-27), so the pull fetches all 278 documents.
  system = await startSystem({ clockAt: "2026-08-01T17:00:00Z", documents: true });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("get_document for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Expected values are literals from outside the code. The text is SB 69's Introduced Version as
  // `pdftotext -raw` prints it (test/fixtures/olis-2025R1/documents/measure-documents/SB69/Introduced.pdf);
  // the hash is the manifest's sha256 of those bytes; the URL is the feed row's DocumentUrl
  // (feed/MeasureDocuments.json); the retrieval time is the simulated clock's.
  it("returns SB 69's Introduced Version exactly as published, with where and when it came from", async () => {
    const outcome = await callTool(connected, "get_document", { id: "version-2025r1-sb69-introduced" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({
      id: "version-2025r1-sb69-introduced",
      kind: "version",
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
      retrieved_at: "2026-08-01T10:00:00-07:00",
      content_hash: "a306d6c6bf7d1a16814d60bc731f7ef6d1be4dfd3198edcfab27feca14f34f99",
      has_text_layer: true,
      part: 1,
      part_count: 1,
    });
    const text = String(outcome.structured?.["text"]);
    expect(text).toContain(
      "SECTION 1. The Employment Department shall study issues related to laws concerning\n" +
        "job-protected leave from work. The department shall submit a report in the manner provided\n" +
        "by ORS 192.245, and may include recommendations for legislation, to the interim committees\n" +
        "of the Legislative Assembly related to business and labor no later than September 15, 2026.\n" +
        "SECTION 2. Section 1 of this 2025 Act is repealed on January 2, 2027.",
    );
    expect.soft(outcome.structured?.["notice"]).toMatch(/not the official record/i);
    expect.soft(outcome.structured?.["as_of"]).toBe("2026-08-01T10:00:00-07:00");
    expect(outcome.structured?.["related"]).toContainEqual(
      expect.objectContaining({ id: "measure-2025r1-sb69", relation: "measure" }),
    );
  });
});
