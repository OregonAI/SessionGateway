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

// HB 3131's MeasureSponsors rows in the fixture (38 rows: one Presession row, which names no
// Legislator, and 37 Member rows), in the order of their PrintOrder (1, 2, 3, 10, 10, 10, then 20 for
// every regular sponsor); rows with the same PrintOrder follow in MeasureSponsorId order, the order
// the feed created them in. Each row is [Legislator Code, level, id, name]: the name is the
// fixture's Legislators row for that code (the feed writes the last name of "Rep McDonald" as
// "McDonald ", with a trailing space), except that "Rep Neron" has none and is Courtney Neron
// Misslin by the alias file (src/packages/legislators/data/legislator-aliases.json).
const hb3131Sponsors = [
  ["Rep Owens", "chief", "legislator-2025r1-owens", "Mark Owens"],
  ["Rep Helm", "chief", "legislator-2025r1-helm", "Ken Helm"],
  ["Rep Levy B", "chief", "legislator-2025r1-levy-b", "Bobby Levy"],
  ["Rep Neron", "chief", "legislator-2025r1-neron-misslin", "Courtney Neron Misslin"],
  ["Rep Smith G", "chief", "legislator-2025r1-smith-g", "Gregory Smith"],
  ["Rep Hartman", "chief", "legislator-2025r1-hartman", "Annessa Hartman"],
  ["Rep Boice", "regular", "legislator-2025r1-boice", "Court Boice"],
  ["Rep Bowman", "regular", "legislator-2025r1-bowman", "Ben Bowman"],
  ["Rep Chaichi", "regular", "legislator-2025r1-chaichi", "Farrah Chaichi"],
  ["Rep Evans", "regular", "legislator-2025r1-evans", "Paul Evans"],
  ["Rep Gamba", "regular", "legislator-2025r1-gamba", "Mark Gamba"],
  ["Rep Gomberg", "regular", "legislator-2025r1-gomberg", "David Gomberg"],
  ["Rep Levy E", "regular", "legislator-2025r1-levy-e", "Emerson Levy"],
  ["Rep Lively", "regular", "legislator-2025r1-lively", "John Lively"],
  ["Rep Mannix", "regular", "legislator-2025r1-mannix", "Kevin Mannix"],
  ["Rep Marsh", "regular", "legislator-2025r1-marsh", "Pam Marsh"],
  ["Rep McIntire", "regular", "legislator-2025r1-mcintire", "Emily McIntire"],
  ["Rep McLain", "regular", "legislator-2025r1-mclain", "Susan McLain"],
  ["Rep Nelson", "regular", "legislator-2025r1-nelson", "Travis Nelson"],
  ["Rep Nosse", "regular", "legislator-2025r1-nosse", "Rob Nosse"],
  ["Rep Pham H", "regular", "legislator-2025r1-pham-h", "Hai Pham"],
  ["Rep Ruiz", "regular", "legislator-2025r1-ruiz", "Ricki Ruiz"],
  ["Rep Tran", "regular", "legislator-2025r1-tran", "Thuy Tran"],
  ["Rep Walters", "regular", "legislator-2025r1-walters", "Jules Walters"],
  ["Rep Wright", "regular", "legislator-2025r1-wright", "Boomer Wright"],
  ["Sen Anderson", "regular", "legislator-2025r1-anderson", "Dick Anderson"],
  ["Sen Frederick", "regular", "legislator-2025r1-frederick", "Lew Frederick"],
  ["Sen Golden", "regular", "legislator-2025r1-golden", "Jeff Golden"],
  ["Sen Linthicum", "regular", "legislator-2025r1-linthicum", "Diane Linthicum"],
  ["Sen Meek", "regular", "legislator-2025r1-meek", "Mark Meek"],
  ["Sen Prozanski", "regular", "legislator-2025r1-prozanski", "Floyd Prozanski"],
  ["Sen Smith DB", "regular", "legislator-2025r1-smith-db", "David Brock Smith"],
  ["Sen Sollman", "regular", "legislator-2025r1-sollman", "Janeen Sollman"],
  ["Sen Taylor", "regular", "legislator-2025r1-taylor", "Kathleen Taylor"],
  ["Sen Weber", "regular", "legislator-2025r1-weber", "Suzanne Weber"],
  ["Rep Fragala", "regular", "legislator-2025r1-fragala", "Lisa Fragala"],
  ["Rep McDonald", "regular", "legislator-2025r1-mcdonald", "Sarah McDonald"],
] as const;

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

  it("lists HB 3131's 37 sponsors who are Legislators in print order, chief sponsors first", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

    const listed = sponsorsOf(outcome)?.map((sponsor) => [
      sponsor.legislator_code,
      sponsor.level,
      sponsor.legislator?.id,
      sponsor.legislator?.name,
    ]);
    expect(listed).toEqual(hb3131Sponsors);
  });

  it("tells Legislators who share a last name apart by the initials in their codes", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

    const levys = sponsorsOf(outcome)?.filter((sponsor) => sponsor.legislator_code.startsWith("Rep Levy"));
    expect(levys?.map((sponsor) => sponsor.legislator)).toEqual([
      { id: "legislator-2025r1-levy-b", name: "Bobby Levy" },
      { id: "legislator-2025r1-levy-e", name: "Emerson Levy" },
    ]);
  });

  it("shows no sponsors for SB 69, whose one sponsor row is a presession filing and not a Legislator", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

    expect(outcome.isError).toBe(false);
    expect(sponsorsOf(outcome)).toEqual([]);
  });
});
