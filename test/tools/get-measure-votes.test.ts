// Seam 1 (test/CLAUDE.md): the committee and floor votes get_measure shows, as an agent sees them, with
// the whole system behind it. A fake OLIS serves the committed fixture, the ingest worker pulls it into
// a database, and an MCP client calls the tool in-process. One database serves every case here because
// none changes it; cases that change the feed are in get-measure-votes-feed.test.ts.
//
// Expected values are literals from outside the code: the Legislator Codes, votes and dates are the
// fixture's CommitteeVotes and MeasureVotes rows (test/fixtures/olis-2025R1/feed/), the names are its
// Legislators rows, and the id form is the one GLOSSARY.md gives.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import {
  hb3795Hechs,
  hb3795FloorVotes,
  hb3795Shs,
  rollOf,
  sb69FloorVotes,
  sb69Hlws,
  sb69Slb,
} from "../support/expected-votes.ts";
import { committeeVotesOf, floorVotesOf, tuplesOf } from "../support/votes.ts";

let system: System;

beforeAll(async () => {
  // 2025-12-15, after every row these Measures have was created: the fake OLIS hides a row created
  // after its clock, and the Legislators snapshot's newest row is from 2025-06-07.
  system = await startCopiedSystem({ clockAt: "2025-12-15T17:00:00Z" });
});

afterAll(async () => {
  await system.stop();
});

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

describe.for(eras)("get_measure floor votes for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  it.for([
    ["SB 69", sb69FloorVotes],
    ["HB 3795", hb3795FloorVotes],
  ] as const)(
    "lists %s's floor votes in the order they were taken, who did not vote Aye in each",
    async ([measure, expected]) => {
      const outcome = await callTool(connected, "get_measure", { measure });

      expect(outcome.isError).toBe(false);
      const listed = floorVotesOf(outcome)?.map((vote) => ({
        chamber: vote.chamber,
        date: vote.date,
        action: vote.action,
        roll: rollOf(vote.votes),
      }));
      expect(listed).toEqual(expected);
    },
  );

  it("gives every voter of SB 69's and HB 3795's floor votes as the one Legislator their code names", async () => {
    const sb69 = await callTool(connected, "get_measure", { measure: "SB 69" });
    const hb3795 = await callTool(connected, "get_measure", { measure: "HB 3795" });

    const rolls = [...(floorVotesOf(sb69) ?? []), ...(floorVotesOf(hb3795) ?? [])];
    expect(rolls).toHaveLength(5);
    for (const roll of rolls) {
      expect(roll.votes.filter((cast) => cast.legislator === null)).toEqual([]);
      // One person, one vote in a roll: the 30 Senators and 60 Representatives are 30 and 60 people.
      const ids = new Set(roll.votes.map((cast) => cast.legislator?.id));
      expect(ids.size).toBe(roll.votes.length);
    }
    expect(rolls.map((roll) => roll.votes.length)).toEqual([30, 60, 60, 30, 60]);
  });

  it("names the Legislator behind a code that carries an office: the President and the Speaker", async () => {
    // "Sen President Wagner" is the first row of every Senate roll, and "Rep Speaker Fahey" is among the
    // House's (excused for the business of the House on SB 69, above). The Legislators rows give Rob
    // Wagner and Julie Fahey; the ids leave the office out (GLOSSARY.md, "Legislator").
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

    const [senate, house] = floorVotesOf(outcome) ?? [];
    expect(senate?.votes[0]).toEqual({
      legislator_code: "Sen President Wagner",
      legislator: { id: "legislator-2025r1-wagner", name: "Rob Wagner" },
      vote: "Aye",
    });
    expect(house?.votes.find((cast) => cast.legislator_code === "Rep Speaker Fahey")).toEqual({
      legislator_code: "Rep Speaker Fahey",
      legislator: { id: "legislator-2025r1-fahey", name: "Julie Fahey" },
      vote: "Excused for Business",
    });
  });

  // Courtney Neron was "Rep Neron" until she moved to the Senate in May 2025, and is "Sen Neron Misslin"
  // since (the Legislators set lists only the second code). The fixture's votes hold both:
  //   MeasureVoteId 1468790  SB 69    House   2025-05-05T11:30:33  "Rep Neron"         Aye
  //   MeasureVoteId 1475890  SB 983   Senate  2025-05-15T11:50:00  "Sen Neron Misslin" Aye
  //   MeasureVoteId 1456830  HB 3795  House   2025-04-14T14:20:19  "Rep Neron"         Aye
  //   MeasureVoteId 1494348  HB 3795  Senate  2025-06-11T11:29:13  "Sen Neron Misslin" Aye
  // One person has one Legislator id: the one the alias file's code, "Rep Neron", makes. The name is
  // the Legislators row's.
  const neron = { id: "legislator-2025r1-neron", name: "Courtney Neron Misslin" };

  it("is one Legislator in SB 69's House vote as Rep Neron and in SB 983's Senate vote as Sen Neron Misslin", async () => {
    const sb69 = await callTool(connected, "get_measure", { measure: "SB 69" });
    const sb983 = await callTool(connected, "get_measure", { measure: "SB 983" });

    const inTheHouse = floorVotesOf(sb69)
      ?.find((vote) => vote.chamber === "house")
      ?.votes.find((cast) => cast.legislator_code === "Rep Neron");
    const inTheSenate = floorVotesOf(sb983)
      ?.find((vote) => vote.date === "2025-05-15T11:50:00-07:00")
      ?.votes.find((cast) => cast.legislator_code === "Sen Neron Misslin");
    expect(inTheHouse).toEqual({ legislator_code: "Rep Neron", legislator: neron, vote: "Aye" });
    expect(inTheSenate).toEqual({ legislator_code: "Sen Neron Misslin", legislator: neron, vote: "Aye" });
  });

  it("is one Legislator across HB 3795's House and Senate votes, whichever of her two codes the roll uses", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3795" });

    const castsOfHers = (floorVotesOf(outcome) ?? []).flatMap((vote) =>
      vote.votes
        .filter((cast) => cast.legislator_code === "Rep Neron" || cast.legislator_code === "Sen Neron Misslin")
        .map((cast) => [vote.chamber, vote.date, cast.legislator_code, cast.legislator?.id, cast.vote]),
    );
    expect(castsOfHers).toEqual([
      ["house", "2025-04-14T14:20:19-07:00", "Rep Neron", neron.id, "Aye"],
      ["senate", "2025-06-11T11:29:13-07:00", "Sen Neron Misslin", neron.id, "Aye"],
      // She is in neither code in the third floor vote, the House agreeing to the Senate's amendments
      // (2025-06-16): a Senator by then, she did not vote in the House.
    ]);
  });

  // "Sen Woods" has no Legislators row at all. The alias file names her as Aaron Woods from the feed's
  // own evidence (committee minutes, a sponsor row, the Measure HB 3592's catchline), so she is a
  // Legislator in the votes too: in SB 69's Senate roll (MeasureVoteId 1437980, Aye) and in its SLB
  // committee vote (CommitteeVoteId 324941, Excused).
  it("names Sen Woods, who has no Legislators row, as the Legislator the alias file says she is", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

    const woods = { id: "legislator-2025r1-woods", name: "Aaron Woods" };
    const floor = floorVotesOf(outcome)?.[0]?.votes.find((cast) => cast.legislator_code === "Sen Woods");
    const committee = committeeVotesOf(outcome)?.[0]?.votes.find((cast) => cast.legislator_code === "Sen Woods");
    expect(floor).toEqual({ legislator_code: "Sen Woods", legislator: woods, vote: "Aye" });
    expect(committee).toEqual({ legislator_code: "Sen Woods", legislator: woods, vote: "Excused" });
  });
});
