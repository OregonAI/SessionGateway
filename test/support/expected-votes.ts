// The votes of SB 69 and HB 3795 as the fixture's feed rows have them, for the seam-1 tests that check
// what get_measure shows of them (get-measure-votes.test.ts, get-measure-live.test.ts). Expected values
// are literals from outside the code: the Legislator Codes, votes and dates are the fixture's
// CommitteeVotes and MeasureVotes rows (test/fixtures/olis-2025R1/feed/), the names are its Legislators
// rows, and the id form is the one GLOSSARY.md gives.
import type { ToolVote, VoteTuple } from "./votes.ts";

// SB 69's two committee votes, each a CommitteeVotes report (CommitteeReportId) in the fixture, and
// HB 3795's. Each entry is [Legislator Code, vote, Legislator id, name]: the vote is the row's
// `Meaning`, the name the Legislators row's FirstName and LastName (the Representative from Eugene
// is "Lesly Muñoz" in the feed and "Rep Munoz" in the code). "Sen Woods" has no Legislators row: the
// alias file names her as Aaron Woods, from the evidence it cites.
//   37391  SLB    2025-01-30T08:00:00   Senate Committee On Labor and Business, 5 rows
//   38730  HLWS   2025-04-28T15:00:00   House Committee On Labor and Workplace Standards, 7 rows
//   38179  HECHS  2025-04-03T08:00:00   House Committee On Early Childhood and Human Services, 9 rows
//   39106  SHS    2025-05-20T08:00:00   Senate Committee On Human Services, 5 rows
export const sb69Slb: VoteTuple[] = [
  ["Sen Bonham", "Aye", "legislator-2025r1-bonham", "Daniel Bonham"],
  ["Sen Hayden", "Aye", "legislator-2025r1-hayden", "Cedric Hayden"],
  ["Sen Pham", "Aye", "legislator-2025r1-pham", "Khanh Pham"],
  ["Sen Taylor", "Aye", "legislator-2025r1-taylor", "Kathleen Taylor"],
  ["Sen Woods", "Excused", "legislator-2025r1-woods", "Aaron Woods"],
];
export const sb69Hlws: VoteTuple[] = [
  ["Rep Boshart Davis", "Excused", "legislator-2025r1-boshart-davis", "Shelly Boshart Davis"],
  ["Rep Elmer", "Aye", "legislator-2025r1-elmer", "Lucetta Elmer"],
  ["Rep Fragala", "Aye", "legislator-2025r1-fragala", "Lisa Fragala"],
  ["Rep Grayber", "Aye", "legislator-2025r1-grayber", "Dacia Grayber"],
  ["Rep Munoz", "Aye", "legislator-2025r1-munoz", "Lesly Muñoz"],
  ["Rep Nelson", "Excused", "legislator-2025r1-nelson", "Travis Nelson"],
  ["Rep Scharf", "Aye", "legislator-2025r1-scharf", "Anna Scharf"],
];
export const hb3795Hechs: VoteTuple[] = [
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
export const hb3795Shs: VoteTuple[] = [
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
export type Roll = { ayes: number; others: Record<string, string[]> };

export function rollOf(votes: readonly ToolVote[]): Roll {
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
export const sb69FloorVotes = [
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
export const hb3795FloorVotes = [
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
