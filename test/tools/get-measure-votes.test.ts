// Seam 1 (test/CLAUDE.md): the committee and floor votes get_measure shows, as an agent sees them, with
// the whole system behind it. A fake OLIS serves the committed fixture, the ingest worker pulls it into
// a database, and an MCP client calls the tool in-process. One database serves every case here because
// none changes it; cases that change the feed are in get-measure-votes-feed.test.ts.
//
// Expected values are literals from outside the code: the Legislator Codes, votes and dates are the
// fixture's CommitteeVotes and MeasureVotes rows (test/fixtures/olis-2025R1/feed/), the names are its
// Legislators rows, and the id form is the one GLOSSARY.md gives.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";
import { committeeVotesOf, tuplesOf, type VoteTuple } from "../support/votes.ts";

let system: System;

beforeAll(async () => {
  // 2025-12-15, after every row these Measures have was created: the fake OLIS hides a row created
  // after its clock, and the Legislators snapshot's newest row is from 2025-06-07.
  system = await startSystem({ clockAt: "2025-12-15T17:00:00Z" });
});

afterAll(async () => {
  await system.stop();
});

// SB 69's two committee votes, each a CommitteeVotes report (CommitteeReportId) in the fixture, and
// HB 3795's. Each entry is [Legislator Code, vote, Legislator id, name]: the vote is the row's
// `Meaning`, the name the Legislators row's FirstName and LastName (the Representative from Eugene
// is "Lesly Muñoz" in the feed and "Rep Munoz" in the code). "Sen Woods" has no Legislators row: the
// alias file names her as Aaron Woods, from the evidence it cites.
//   37391  SLB    2025-01-30T08:00:00   Senate Committee On Labor and Business, 5 rows
//   38730  HLWS   2025-04-28T15:00:00   House Committee On Labor and Workplace Standards, 7 rows
//   38179  HECHS  2025-04-03T08:00:00   House Committee On Early Childhood and Human Services, 9 rows
//   39106  SHS    2025-05-20T08:00:00   Senate Committee On Human Services, 5 rows
const sb69Slb: VoteTuple[] = [
  ["Sen Bonham", "Aye", "legislator-2025r1-bonham", "Daniel Bonham"],
  ["Sen Hayden", "Aye", "legislator-2025r1-hayden", "Cedric Hayden"],
  ["Sen Pham", "Aye", "legislator-2025r1-pham", "Khanh Pham"],
  ["Sen Taylor", "Aye", "legislator-2025r1-taylor", "Kathleen Taylor"],
  ["Sen Woods", "Excused", "legislator-2025r1-woods", "Aaron Woods"],
];
const sb69Hlws: VoteTuple[] = [
  ["Rep Boshart Davis", "Excused", "legislator-2025r1-boshart-davis", "Shelly Boshart Davis"],
  ["Rep Elmer", "Aye", "legislator-2025r1-elmer", "Lucetta Elmer"],
  ["Rep Fragala", "Aye", "legislator-2025r1-fragala", "Lisa Fragala"],
  ["Rep Grayber", "Aye", "legislator-2025r1-grayber", "Dacia Grayber"],
  ["Rep Munoz", "Aye", "legislator-2025r1-munoz", "Lesly Muñoz"],
  ["Rep Nelson", "Excused", "legislator-2025r1-nelson", "Travis Nelson"],
  ["Rep Scharf", "Aye", "legislator-2025r1-scharf", "Anna Scharf"],
];
const hb3795Hechs: VoteTuple[] = [
  ["Rep Elmer", "Excused", "legislator-2025r1-elmer", "Lucetta Elmer"],
  ["Rep Hartman", "Aye", "legislator-2025r1-hartman", "Annessa Hartman"],
  ["Rep Javadi", "Aye", "legislator-2025r1-javadi", "Cyrus Javadi"],
  ["Rep McIntire", "Aye", "legislator-2025r1-mcintire", "Emily McIntire"],
  ["Rep Nguyen H", "Aye", "legislator-2025r1-nguyen-h", "Hoa Nguyen"],
  ["Rep Nosse", "Aye", "legislator-2025r1-nosse", "Rob Nosse"],
  ["Rep Ruiz", "Aye", "legislator-2025r1-ruiz", "Ricki Ruiz"],
  ["Rep Scharf", "Excused", "legislator-2025r1-scharf", "Anna Scharf"],
  ["Rep Walters", "Aye", "legislator-2025r1-walters", "Jules Walters"],
];
const hb3795Shs: VoteTuple[] = [
  ["Sen Gelser Blouin", "Aye", "legislator-2025r1-gelser-blouin", "Sara Gelser Blouin"],
  ["Sen Linthicum", "Nay", "legislator-2025r1-linthicum", "Diane Linthicum"],
  ["Sen Nash", "Aye", "legislator-2025r1-nash", "Todd Nash"],
  ["Sen Prozanski", "Aye", "legislator-2025r1-prozanski", "Floyd Prozanski"],
  ["Sen Reynolds", "Aye", "legislator-2025r1-reynolds", "Lisa Reynolds"],
];

describe.for(eras)("get_measure committee votes for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  it("lists each member's vote in SB 69's two committee votes, in the order the committees met", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

    expect(outcome.isError).toBe(false);
    const listed = committeeVotesOf(outcome)?.map((vote) => [
      vote.committee_code,
      vote.meeting_date,
      tuplesOf(vote.votes),
    ]);
    expect(listed).toEqual([
      ["SLB", "2025-01-30T08:00:00-08:00", sb69Slb],
      ["HLWS", "2025-04-28T15:00:00-07:00", sb69Hlws],
    ]);
  });

  it("lists each member's vote in HB 3795's two committee votes, one in each chamber", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3795" });

    const listed = committeeVotesOf(outcome)?.map((vote) => [
      vote.committee_code,
      vote.meeting_date,
      tuplesOf(vote.votes),
    ]);
    expect(listed).toEqual([
      ["HECHS", "2025-04-03T08:00:00-07:00", hb3795Hechs],
      ["SHS", "2025-05-20T08:00:00-07:00", hb3795Shs],
    ]);
  });

  it("gives a Measure only its own committee votes: HB 3131's one vote, of nine members", async () => {
    // The fixture holds report 37512 (HALNRW, 2025-02-12T08:00:00, nine rows) for HB 3131, and the
    // other Measures' reports are other CommitteeReportIds (SB 921's is 37825, SB 64's 37413).
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

    expect(committeeVotesOf(outcome)?.map((vote) => [vote.committee_code, vote.votes.length])).toEqual([["HALNRW", 9]]);
  });
});
