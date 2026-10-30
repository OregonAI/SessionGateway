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
import { committeeVotesOf, floorVotesOf, tuplesOf, type ToolVote, type VoteTuple } from "../support/votes.ts";

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

// A floor vote's roll is long (30 Senators, 60 Representatives), so a case states it the way OLIS's own
// tally does: how many voted Aye, and who did not. The tally is the `VoteText` of the floor vote's
// MeasureHistoryActions row, a different entity set from the MeasureVotes rows the tool shows, so it
// is an independent oracle. OLIS writes the names it prints without the chamber word, in alphabetical
// order ("Ayes, 24; Nays, 5--Girod, Linthicum, Robinson, Smith DB, Thatcher; Excused, 1--Starr."); the
// literals below add the chamber word to make the Legislator Codes, and are compared sorted.
type Roll = { ayes: number; others: Record<string, string[]> };

function rollOf(votes: readonly ToolVote[]): Roll {
  const others: Record<string, string[]> = {};
  for (const cast of votes) {
    if (cast.vote !== "Aye") (others[cast.vote] ??= []).push(cast.legislator_code);
  }
  for (const codes of Object.values(others)) codes.sort();
  return { ayes: votes.filter((cast) => cast.vote === "Aye").length, others };
}

//   SB 69, MeasureHistoryId 620916 (Senate, 2025-02-06T11:21:32):
//     "Ayes, 24; Nays, 5--Girod, Linthicum, Robinson, Smith DB, Thatcher; Excused, 1--Starr."
//   SB 69, MeasureHistoryId 644481 (House, 2025-05-05T11:30:33):
//     "Ayes, 42; Nays, 10--Boice, Cate, Diehl, Edwards, Harbick, Lewis, Osborne, Skarlatos, Wright,
//      Yunker; Excused, 7--Drazan, Hartman, Nguyen H, Ruiz, Sosa, Tran, Wallan; Excused for Business
//      of the House, 1--Speaker Fahey."
const sb69FloorVotes = [
  {
    chamber: "senate",
    date: "2025-02-06T11:21:32-08:00",
    action: "Third reading.  Carried by Bonham.  Passed.",
    roll: {
      ayes: 24,
      others: {
        Nay: ["Sen Girod", "Sen Linthicum", "Sen Robinson", "Sen Smith DB", "Sen Thatcher"],
        Excused: ["Sen Starr"],
      },
    },
  },
  {
    chamber: "house",
    date: "2025-05-05T11:30:33-07:00",
    action: "Third reading. Carried by Grayber. Passed.",
    roll: {
      ayes: 42,
      others: {
        Nay: [
          "Rep Boice",
          "Rep Cate",
          "Rep Diehl",
          "Rep Edwards",
          "Rep Harbick",
          "Rep Lewis",
          "Rep Osborne",
          "Rep Skarlatos",
          "Rep Wright",
          "Rep Yunker",
        ],
        Excused: ["Rep Drazan", "Rep Hartman", "Rep Nguyen H", "Rep Ruiz", "Rep Sosa", "Rep Tran", "Rep Wallan"],
        "Excused for Business": ["Rep Speaker Fahey"],
      },
    },
  },
];

//   HB 3795, MeasureHistoryId 640320 (House, 2025-04-14T14:20:19):
//     "Ayes, 44; Nays, 11--Boice, Boshart Davis, Diehl, Elmer, Harbick, Lewis, Osborne, Reschke, Scharf,
//      Skarlatos, Yunker; Excused, 4--Cate, Evans, Nguyen H, Walters; Excused for Business of the
//      House, 1--Drazan."
//   HB 3795, MeasureHistoryId 653537 (Senate, 2025-06-11T11:29:13):
//     "Ayes, 26; Nays, 3--Bonham, Linthicum, Robinson; Excused, 1--Nash."
//   HB 3795, MeasureHistoryId 654707 (House, 2025-06-16T11:56:31), the House agreeing to the Senate's
//   amendments:
//     "Ayes, 47; Nays, 5--Cate, Diehl, Harbick, Skarlatos, Yunker; Excused, 5--Boshart Davis, Chaichi,
//      Nguyen H, Osborne, Wallan; Excused for Business of the House, 3--Helfrich, McLain, Reschke."
const hb3795FloorVotes = [
  {
    chamber: "house",
    date: "2025-04-14T14:20:19-07:00",
    action: "Third reading. Carried by Ruiz. Passed.",
    roll: {
      ayes: 44,
      others: {
        Nay: [
          "Rep Boice",
          "Rep Boshart Davis",
          "Rep Diehl",
          "Rep Elmer",
          "Rep Harbick",
          "Rep Lewis",
          "Rep Osborne",
          "Rep Reschke",
          "Rep Scharf",
          "Rep Skarlatos",
          "Rep Yunker",
        ],
        Excused: ["Rep Cate", "Rep Evans", "Rep Nguyen H", "Rep Walters"],
        "Excused for Business": ["Rep Drazan"],
      },
    },
  },
  {
    chamber: "senate",
    date: "2025-06-11T11:29:13-07:00",
    action: "Third reading.  Carried by Gelser Blouin.  Passed.",
    roll: {
      ayes: 26,
      others: { Nay: ["Sen Bonham", "Sen Linthicum", "Sen Robinson"], Excused: ["Sen Nash"] },
    },
  },
  {
    chamber: "house",
    date: "2025-06-16T11:56:31-07:00",
    action: "House concurred in Senate amendments and repassed bill.",
    roll: {
      ayes: 47,
      others: {
        Nay: ["Rep Cate", "Rep Diehl", "Rep Harbick", "Rep Skarlatos", "Rep Yunker"],
        Excused: ["Rep Boshart Davis", "Rep Chaichi", "Rep Nguyen H", "Rep Osborne", "Rep Wallan"],
        "Excused for Business": ["Rep Helfrich", "Rep McLain", "Rep Reschke"],
      },
    },
  },
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
