// Seam 1 (test/CLAUDE.md): the sponsors get_measure shows, as an agent sees them, with the whole
// system behind it. A fake OLIS serves the committed fixture, the ingest worker pulls it into a
// database, and an MCP client calls the tool in-process. One database serves every case here because
// none changes it; cases that change the feed build their own system in get-measure-sponsors-feed.test.ts.
//
// Expected values are literals from outside the code: the Legislator Codes, sponsor levels and print
// orders are the fixture's MeasureSponsors rows for HB 3131, the names are the fixture's Legislators
// rows (test/fixtures/olis-2025R1/feed/), and the id form is the one GLOSSARY.md gives.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2025-12-15, after the Legislators snapshot's newest row (2025-06-07) was created: the fake OLIS
  // hides a row created after the clock, and every Legislators row must be there.
  system = await startSystem({ clockAt: "2025-12-15T17:00:00Z" });
});

afterAll(async () => {
  await system.stop();
});

type Sponsor = {
  level: string;
  legislator_code: string;
  legislator: { id: string; name: string } | null;
};

function sponsorsOf(outcome: { structured: Record<string, unknown> | undefined }): Sponsor[] | undefined {
  return outcome.structured?.["sponsors"] as Sponsor[] | undefined;
}

describe.for(eras)("get_measure sponsors for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  it("shows HB 3131's first two chief sponsors as the Legislators their codes name", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

    expect(outcome.isError).toBe(false);
    expect(sponsorsOf(outcome)?.slice(0, 2)).toEqual([
      {
        level: "chief",
        legislator_code: "Rep Owens",
        legislator: { id: "legislator-2025r1-owens", name: "Mark Owens" },
      },
      {
        level: "chief",
        legislator_code: "Rep Helm",
        legislator: { id: "legislator-2025r1-helm", name: "Ken Helm" },
      },
    ]);
  });
});
