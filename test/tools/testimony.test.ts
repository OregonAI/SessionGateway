// Seam 1 (test/CLAUDE.md): `testimony` as an agent sees it, with the whole system behind it. A fake OLIS
// serves the committed fixture and its documents as the feed stands on 2025-07-15 (after the last
// Testimony row of the fixture was created, on 2025-06-05), the ingest worker pulls them into a database,
// and an MCP client calls the tool in-process. One database serves every case in this file because none
// of them changes it. The cases that need rows the fixture lacks are in testimony-made-up.test.ts and
// testimony-large.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  system = await startSystem({ clockAt: "2025-07-15T17:00:00Z", documents: true });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type PositionCount = { position_id: number; position: string; count: number };

describe.for(eras)("testimony for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Spec #1 case (d) and the ticket's first box: "HB 3131 returns 42 rows: 41 support, 1 oppose". The rows are
  // the 42 CommitteePublicTestimonies rows of HB 3131 in test/fixtures/olis-2025R1/feed/ (41 with
  // PositionOnMeasureId 3983, and CommTestId 117368, David Wall of Newberg, with 3982). No row has 3981 or 4022.
  it("returns HB 3131's 42 rows: 41 support and 1 oppose, and none neutral or unknown", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "HB 3131" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({ measure_id: "measure-2025r1-hb3131", total: 42 });
    expect(outcome.structured?.["position_counts"] as PositionCount[]).toEqual([
      { position_id: 3983, position: "support", count: 41 },
      { position_id: 3982, position: "oppose", count: 1 },
      { position_id: 3981, position: "neutral", count: 0 },
      { position_id: 4022, position: "unknown", count: 0 },
    ]);
  });
});
