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
import { sponsorsOf } from "../support/sponsors.ts";
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

// HB 3131's sponsors in print order. The order is OLIS's own: its overview page for the Measure (the
// cache's video-research/pages/hb3131.html, in the page's `Srv.ChiefSponsors` and `Srv.RegularSponsors`
// arrays) lists the six chief sponsors, then the regular sponsors, Representatives and then Senators.
// Sponsors who share a PrintOrder (the three chiefs at 10, the regulars at 20) are in alphabetical
// order within their chamber, whenever the feed added them: Hartman (added 2025-02-12) is among the
// chiefs at 10, Fragala (2025-01-15) and McDonald (2025-01-23) among the regulars at 20. The fixture's
// Introduced.pdf prints the sponsors it was introduced with the same way ("Representatives BOICE,
// BOWMAN, CHAICHI, EVANS, GAMBA, ... Senators ANDERSON, FREDERICK, ..."). The page and the document
// are the oracle; the order the feed created the rows in (their MeasureSponsorId) is not.
//
// The fixture has 38 MeasureSponsors rows for HB 3131: one Presession row, which names no Legislator,
// and 37 Member rows. Each entry is [Legislator Code, level, id, name]: the name is the fixture's
// Legislators row for that code (the feed writes the last name of "Rep McDonald" as "McDonald ", with
// a trailing space), except that "Rep Neron" has none and is Courtney Neron Misslin by the alias file
// (src/packages/legislators/data/legislator-aliases.json), whose id is the one the alias file's code
// makes: legislator-2025r1-neron.
const hb3131Sponsors = [
  ["Rep Owens", "chief", "legislator-2025r1-owens", "Mark Owens"],
  ["Rep Helm", "chief", "legislator-2025r1-helm", "Ken Helm"],
  ["Rep Levy B", "chief", "legislator-2025r1-levy-b", "Bobby Levy"],
  ["Rep Hartman", "chief", "legislator-2025r1-hartman", "Annessa Hartman"],
  ["Rep Neron", "chief", "legislator-2025r1-neron", "Courtney Neron Misslin"],
  ["Rep Smith G", "chief", "legislator-2025r1-smith-g", "Gregory Smith"],
  ["Rep Boice", "regular", "legislator-2025r1-boice", "Court Boice"],
  ["Rep Bowman", "regular", "legislator-2025r1-bowman", "Ben Bowman"],
  ["Rep Chaichi", "regular", "legislator-2025r1-chaichi", "Farrah Chaichi"],
  ["Rep Evans", "regular", "legislator-2025r1-evans", "Paul Evans"],
  ["Rep Fragala", "regular", "legislator-2025r1-fragala", "Lisa Fragala"],
  ["Rep Gamba", "regular", "legislator-2025r1-gamba", "Mark Gamba"],
  ["Rep Gomberg", "regular", "legislator-2025r1-gomberg", "David Gomberg"],
  ["Rep Levy E", "regular", "legislator-2025r1-levy-e", "Emerson Levy"],
  ["Rep Lively", "regular", "legislator-2025r1-lively", "John Lively"],
  ["Rep Mannix", "regular", "legislator-2025r1-mannix", "Kevin Mannix"],
  ["Rep Marsh", "regular", "legislator-2025r1-marsh", "Pam Marsh"],
  ["Rep McDonald", "regular", "legislator-2025r1-mcdonald", "Sarah McDonald"],
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
] as const;

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

  // The rows of MeasureSponsors that name no Legislator, from the fixture, and what the documents print
  // of them. A Committee row (SponsorType "Committee") names the committee by its CommitteeCode:
  // HB 3795's row 151277 is HECHS, and its Introduced.pdf opens "Sponsored by COMMITTEE ON EARLY
  // CHILDHOOD AND HUMAN SERVICES"; SB 983's row 149379 is SED, and its Introduced.pdf opens "Sponsored
  // by COMMITTEE ON EDUCATION". A Presession row's PresessionFiledMessage is the line the document
  // prints: HB 3131's row 146503 is "(Presession filed.)", which its Introduced.pdf prints after the
  // sponsors; SB 69's row 142256 is the Senate Interim Rule 213.28 notice its Introduced.pdf opens with
  // (the document breaks "presession" across a line as "pre-session").
  it.for([
    ["HB 3795", "HECHS"],
    ["SB 983", "SED"],
  ] as const)(
    "shows %s as sponsored by the committee %s, with no Legislator among its sponsors",
    async ([measure, code]) => {
      const outcome = await callTool(connected, "get_measure", { measure });

      expect(outcome.isError).toBe(false);
      expect(sponsorsOf(outcome)).toEqual([]);
      expect(outcome.structured?.["committee_sponsors"]).toEqual([{ committee_code: code }]);
      expect(outcome.structured?.["presession_messages"]).toEqual([]);
    },
  );

  it.for([
    [
      "SB 69",
      "Printed pursuant to Senate Interim Rule 213.28 by order of the President of the Senate in conformance with presession filing rules, indicating neither advocacy nor opposition on the part of the President.",
    ],
    ["HB 3131", "(Presession filed.)"],
    ["SB 64", "(Presession filed.)"],
  ] as const)("gives %s's presession message as the feed publishes it", async ([measure, message]) => {
    const outcome = await callTool(connected, "get_measure", { measure });

    expect(outcome.structured?.["presession_messages"]).toEqual([message]);
    expect(outcome.structured?.["committee_sponsors"]).toEqual([]);
  });

  it("shows SB 921, which a Legislator sponsors and which has no other sponsor row, with neither a committee nor a message", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "SB 921" });

    expect(sponsorsOf(outcome)?.map((sponsor) => sponsor.legislator_code)).toEqual(["Sen Smith DB", "Sen Anderson"]);
    expect(outcome.structured?.["committee_sponsors"]).toEqual([]);
    expect(outcome.structured?.["presession_messages"]).toEqual([]);
  });
});
