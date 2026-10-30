// Seam 1 (test/CLAUDE.md): what get_measure shows of a Measure's digest and of its analysis documents
// (Fiscal Impact Statements, revenue impact statements, staff measure summaries, budget reports),
// with the whole system behind it. A fake OLIS serves the committed fixture and its documents, the
// ingest worker pulls them into a database, and an MCP client calls the tool in-process. One database
// serves every case in this file because none of them changes it; cases that need a feed row the
// fixture lacks, or that change a row between two pulls, are in get-measure-analysis-labels.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 278
  // documents, the analysis documents among them.
  system = await startSystem({ clockAt: "2026-08-01T17:00:00Z", documents: true });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("get_measure's digest for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Expected values are literals from outside the code: the digest is the feed row's MeasureSummary
  // as the fixture holds it (test/fixtures/olis-2025R1/feed/Measures.json), served as published, with
  // its tabs, its newlines and its markup (olis-odata.md gotcha 8).
  it("returns HB 3131's digest exactly as the feed publishes it", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["digest"]).toBe(
      "\tDigest: The Act gives money to a state agency for uses related to working lands. The Act goes into effect when the Governor signs it. (Flesch Readability Score: 71.2). \n" +
        "\tAppropriates moneys to the Oregon Watershed Enhancement Board, out of the General Fund, for deposit in the Oregon Agricultural Heritage Fund. \n" +
        "\tEstablishes a maximum limit for payment of expenses by the board from the Oregon Agricultural Heritage Fund. \n" +
        "\tDeclares an emergency, effective on passage.",
    );
  });

  it("keeps the feed's markup in SB 69's digest: <b> for new text and [<i>...</i>] for text deleted from the prior Version", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

    const digest = String(outcome.structured?.["digest"]);
    expect(
      digest.startsWith("\t<b>Digest: The Act makes changes to laws concerning job-protected time off from work."),
    ).toBe(true);
    expect(digest).toContain(
      "\n\t[<i>Digest: The Act tells OED to study issues related to job-protected time of from work.",
    );
    expect(digest.endsWith("\tTakes effect on the 91st day following adjournment sine die.</b>")).toBe(true);
  });
});
