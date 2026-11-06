// Seam 1: what get_measure shows of a Measure's history and votes depends on what the feed said and
// when. Each case here builds its own system, because the rows the fake OLIS serves (or the time it
// serves them at, or the alias file the worker reads) are the thing under test. Cases that only read
// the committed fixture are in get-measure-location.test.ts and get-measure-votes.test.ts.
//
// A stray row is a row the test adds to what the fake OLIS serves; the committed fixture never changes
// (test/CLAUDE.md). Every stray row is made up for its case: it has the feed's shape (the builders in
// test/support/votes.ts and sponsors.ts), an id above every real id of its set (900000 or more; 9000000
// or more for MeasureVotes, whose real ids are in the millions) and a Legislator Code or text the case
// says. Where a case uses a real row of the fixture instead, it says so.
import { afterEach, describe, expect, it } from "vitest";
import { createTempAliasFile, type TempAliasFile } from "../support/alias-file.ts";
import { callTool, connectClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";
import { committeeVoteRow, committeeVotesOf, floorVoteRow, floorVotesOf, tuplesOf } from "../support/votes.ts";

const started: System[] = [];
const aliasFiles: TempAliasFile[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
  for (const aliasFile of aliasFiles.splice(0)) aliasFile.remove();
});

/** Builds one system and calls get_measure for each reference in it. */
async function getMeasures(options: SystemOptions, references: readonly string[]): Promise<ToolOutcome[]> {
  const system = await startSystem(options);
  started.push(system);
  const connected = await connectClient("2026-07-28", system.handler);
  try {
    const outcomes: ToolOutcome[] = [];
    for (const reference of references) outcomes.push(await callTool(connected, "get_measure", { measure: reference }));
    return outcomes;
  } finally {
    await connected.close();
  }
}

async function getMeasure(options: SystemOptions, reference: string): Promise<ToolOutcome> {
  return (await getMeasures(options, [reference]))[0] as ToolOutcome;
}

type ToolHistoryAction = { chamber: string; date: string; text: string };
const historyOf = (outcome: ToolOutcome): ToolHistoryAction[] | undefined =>
  outcome.structured?.["history"] as ToolHistoryAction[] | undefined;

// 2025-12-15, after the newest Legislators row was created (2025-06-07).
const afterTheSession = "2025-12-15T17:00:00Z";

describe("the history and votes as the feed stood", () => {
  // 2025-01-29, 09:00 in Oregon: the day before SLB heard SB 69. The fake OLIS has only the rows created
  // by then. SB 69's MeasureHistoryActions rows were created, in the fixture:
  //   615374  2025-01-13T09:07:45   "Introduction and first reading. Referred to President's desk."
  //   617641  2025-01-17T14:16:31   "Referred to Labor and Business."
  //   618812  2025-01-21T10:04:09   "Informational Meeting held."
  //   619383  2025-01-28T09:55:15   "Public Hearing held."
  //   619741  2025-01-30T10:18:24   "Public Hearing and Work Session held."   (the next day: not yet)
  // and its floor votes (MeasureVotes) on 2025-02-06 and 2025-05-05.
  it("shows the history the feed had that day, and no floor vote yet", async () => {
    const outcome = await getMeasure({ clockAt: "2025-01-29T17:00:00Z" }, "SB 69");

    expect(historyOf(outcome)?.map((action) => action.text)).toEqual([
      "Introduction and first reading. Referred to President's desk.",
      "Referred to Labor and Business.",
      "Informational Meeting held.",
      "Public Hearing held.",
    ]);
    expect(historyOf(outcome)?.at(-1)?.date).toBe("2025-01-28T08:01:00-08:00");
    expect(floorVotesOf(outcome)).toEqual([]);
    expect(outcome.structured).toMatchObject({ as_of: "2025-01-29T09:00:00-08:00" });
  });
});

describe("a committee roll the feed lists before its meeting", () => {
  // The same day, 2025-01-29 09:00 in Oregon. SB 69's SLB roll (CommitteeVotes 324937 to 324941, report 37391)
  // was created 2025-01-23T07:44:41 and last modified 2025-01-29T09:14:12, for the meeting of 2025-01-30T08:00:00,
  // so the fake OLIS has it a day early, with the answers the rows carry. The history's last line is still
  // "Public Hearing held.": the work session has not happened. The server counts the roll from the start of its meeting
  // (ticket #153, the owner's decision of 2026-11-05): until then it is not listed, and from the meeting on it is,
  // with a meeting_date later than the as_of of the pull that read it (the clock moves on, the database does not).
  it("is not listed until its meeting has started, and then is, with a meeting_date later than as_of", async () => {
    const system = await startSystem({ clockAt: "2025-01-29T17:00:00Z" });
    started.push(system);
    const connected = await connectClient("2026-07-28", system.handler);
    try {
      const before = await callTool(connected, "get_measure", { measure: "SB 69" });
      expect(before.structured).toMatchObject({ as_of: "2025-01-29T09:00:00-08:00" });
      expect(historyOf(before)?.at(-1)?.text).toBe("Public Hearing held.");
      expect(committeeVotesOf(before)).toEqual([]);

      system.clock.set("2025-01-30T07:59:59-08:00");
      expect(committeeVotesOf(await callTool(connected, "get_measure", { measure: "SB 69" }))).toEqual([]);

      system.clock.set("2025-01-30T08:00:00-08:00");
      const at = await callTool(connected, "get_measure", { measure: "SB 69" });
      expect(at.structured).toMatchObject({ as_of: "2025-01-29T09:00:00-08:00" });
      expect(
        committeeVotesOf(at)?.map((vote) => [vote.committee_code, vote.meeting_date, tuplesOf(vote.votes)]),
      ).toEqual([
        [
          "SLB",
          "2025-01-30T08:00:00-08:00",
          [
            ["Sen Bonham", "Aye", "legislator-2025r1-bonham", "Daniel Bonham"],
            ["Sen Hayden", "Aye", "legislator-2025r1-hayden", "Cedric Hayden"],
            ["Sen Pham", "Aye", "legislator-2025r1-pham", "Khanh Pham"],
            ["Sen Taylor", "Aye", "legislator-2025r1-taylor", "Kathleen Taylor"],
            ["Sen Woods", "Excused", "legislator-2025r1-woods", "Aaron Woods"],
          ],
        ],
      ]);
    } finally {
      await connected.close();
    }
  });
});

describe("a Measure with no history and no vote", () => {
  // A Measure row made up for the case: HB 9001, created on 2025-02-01 and in no other set.
  const measure = {
    SessionKey: "2025R1",
    MeasurePrefix: "HB",
    MeasureNumber: 9001,
    CatchLine: "A Measure that nothing has happened to.",
    CurrentLocation: "In House Committee",
    CurrentCommitteeCode: "HALNRW",
    CreatedDate: "2025-02-01T10:00:00",
    ModifiedDate: null,
  };

  it("shows empty lists, not missing fields", async () => {
    const outcome = await getMeasure(
      { clockAt: afterTheSession, olis: { strayRows: { Measures: [measure] } } },
      "HB 9001",
    );

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({ history: [], floor_votes: [], committee_votes: [] });
  });
});

describe("a committee code that does not follow the location", () => {
  // The feed's two fields are shown as it gives them. The cache has the pair both ways round (olis-votes.md
  // section 6): SB 310 "At Presidents Desk Upon Adjournment" with CurrentCommitteeCode "SED", and HB 3029
  // "In House Committee" with none. The Measure rows here are made up (HB 9002 and HB 9003) around those
  // two pairs of location fields.
  const measureAt = (number: number, location: string, committeeCode: string | null) => ({
    SessionKey: "2025R1",
    MeasurePrefix: "HB",
    MeasureNumber: number,
    CatchLine: "A Measure whose location fields are the cache's.",
    CurrentLocation: location,
    CurrentCommitteeCode: committeeCode,
    CreatedDate: "2025-02-01T10:00:00",
    ModifiedDate: null,
  });

  it("shows a code beside a location that is no committee, and none beside In House Committee", async () => {
    const outcomes = await getMeasures(
      {
        clockAt: afterTheSession,
        olis: {
          strayRows: {
            Measures: [
              measureAt(9002, "At Presidents Desk Upon Adjournment", "SED"),
              measureAt(9003, "In House Committee", null),
            ],
          },
        },
      },
      ["HB 9002", "HB 9003"],
    );

    expect(outcomes.map((outcome) => outcome.structured?.["location"])).toEqual([
      { current: "At Presidents Desk Upon Adjournment", committee_code: "SED" },
      { current: "In House Committee", committee_code: null },
    ]);
  });
});

describe("history the feed sends out of order", () => {
  // SB 69's first real row is 615374 at 2025-01-13T09:07:30. Three rows are added after all the others:
  //   900001 at 2025-01-02T10:00:00, earlier than every real row
  //   900003 and 900002 at 2025-01-13T09:07:30, the real first row's own time, sent highest id first
  const action = (id: number, date: string, text: string) => ({
    MeasureHistoryId: id,
    SessionKey: "2025R1",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    Chamber: "S",
    ActionDate: date,
    ActionText: text,
    VoteText: null,
    CreatedDate: "2025-01-02T10:00:05",
    ModifiedDate: null,
    PublicNotification: false,
  });

  it("orders it by the time of each action, then by the feed's id, whatever order the feed sends it in", async () => {
    const outcome = await getMeasure(
      {
        clockAt: afterTheSession,
        olis: {
          strayRows: {
            MeasureHistoryActions: [
              action(900001, "2025-01-02T10:00:00", "An earlier action."),
              action(900003, "2025-01-13T09:07:30", "A tie, third."),
              action(900002, "2025-01-13T09:07:30", "A tie, second."),
            ],
          },
        },
      },
      "SB 69",
    );

    expect(
      historyOf(outcome)
        ?.slice(0, 4)
        .map((entry) => entry.text),
    ).toEqual([
      "An earlier action.",
      "Introduction and first reading. Referred to President's desk.",
      "A tie, second.",
      "A tie, third.",
    ]);
  });
});

describe("votes the feed sends out of order", () => {
  // Two floor entries for SB 69 sent highest id first, on a date before every real floor vote
  // (2025-01-03) though their ids are above the real ones: entries are listed by the feed's id, so "Sen
  // Hayden" (9000011) comes before "Sen Pham" (9000012).
  const floorEntries = [
    floorVoteRow(9000012, "Sen Pham", "Nay", { historyId: 900001, actionDate: "2025-01-03T10:00:00" }),
    floorVoteRow(9000011, "Sen Hayden", "Aye", { historyId: 900001, actionDate: "2025-01-03T10:00:00" }),
  ];

  it("lists floor votes by when they were taken and entries in the feed's id order", async () => {
    const outcome = await getMeasure(
      { clockAt: afterTheSession, olis: { strayRows: { MeasureVotes: floorEntries } } },
      "SB 69",
    );

    const first = floorVotesOf(outcome)?.[0];
    expect(first?.date).toBe("2025-01-03T10:00:00-08:00");
    expect(first && tuplesOf(first.votes)).toEqual([
      ["Sen Hayden", "Aye", "legislator-2025r1-hayden", "Cedric Hayden"],
      ["Sen Pham", "Nay", "legislator-2025r1-pham", "Khanh Pham"],
    ]);
  });
});

describe("committee votes that share a meeting", () => {
  // SB 69's real SLB vote is CommitteeAgendaItemId 202165, CommitteeReportId 37391: five rows, all created
  // 2025-01-23T07:44:41. Both cases add rows for the same agenda item under a report of their own (900002).
  const slbRollAgain = [
    committeeVoteRow(900021, "Sen Bonham", "Aye", slbAgain()),
    committeeVoteRow(900022, "Sen Hayden", "Aye", slbAgain()),
    committeeVoteRow(900023, "Sen Pham", "Aye", slbAgain()),
    committeeVoteRow(900024, "Sen Taylor", "Aye", slbAgain()),
    committeeVoteRow(900025, "Sen Woods", "Excused", slbAgain()),
  ];
  const slbAnotherRoll = [
    committeeVoteRow(900032, "Sen Taylor", "Nay", slbAgain()),
    committeeVoteRow(900031, "Sen Bonham", "Aye", slbAgain()),
  ];

  function slbAgain() {
    return {
      reportId: 900002,
      agendaItemId: 202165,
      meetingDate: "2025-01-30T08:00:00",
      createdDate: "2025-01-23T07:44:41",
    };
  }

  const slbVote = [
    ["Sen Bonham", "Aye"],
    ["Sen Hayden", "Aye"],
    ["Sen Pham", "Aye"],
    ["Sen Taylor", "Aye"],
    ["Sen Woods", "Excused"],
  ];

  function listedOf(outcome: ToolOutcome): unknown {
    return committeeVotesOf(outcome)?.map((vote) => [
      vote.committee_code,
      vote.meeting_date,
      vote.votes.map((cast) => [cast.legislator_code, cast.vote]),
    ]);
  }

  // Where the feed gives an agenda item two reports, the two hold one and the same roll, created together, and
  // the committee is a joint or conference one (docs/research/olis-votes.md section 3, for every such item of
  // the cache). HB 2232's JCT item 204180 (reports 37557 and 37689) is twelve Aye rows twice, all created
  // 2025-02-10T15:02:49. The fixture holds no such item, so this case gives SB 69's SLB roll a second report
  // of the same shape.
  it("lists a roll the feed reports under two reports once", async () => {
    const outcome = await getMeasure(
      { clockAt: afterTheSession, olis: { strayRows: { CommitteeVotes: slbRollAgain } } },
      "SB 69",
    );

    expect(listedOf(outcome)).toEqual([
      ["SLB", "2025-01-30T08:00:00-08:00", slbVote],
      [
        "HLWS",
        "2025-04-28T15:00:00-07:00",
        [
          ["Rep Boshart Davis", "Excused"],
          ["Rep Elmer", "Aye"],
          ["Rep Fragala", "Aye"],
          ["Rep Grayber", "Aye"],
          ["Rep Munoz", "Aye"],
          ["Rep Nelson", "Excused"],
          ["Rep Scharf", "Aye"],
        ],
      ],
    ]);
  });

  // No such case is in the cache (section 3 of the same file: no item has two different rolls). The case is made up to show
  // that two rolls that differ are never merged into one and none of a report's rows is dropped.
  it("keeps two different rolls of one committee at one meeting as two votes, so no member votes twice in one", async () => {
    const outcome = await getMeasure(
      { clockAt: afterTheSession, olis: { strayRows: { CommitteeVotes: slbAnotherRoll } } },
      "SB 69",
    );

    expect((listedOf(outcome) as unknown[]).slice(0, 2)).toEqual([
      ["SLB", "2025-01-30T08:00:00-08:00", slbVote],
      [
        "SLB",
        "2025-01-30T08:00:00-08:00",
        [
          ["Sen Bonham", "Aye"],
          ["Sen Taylor", "Nay"],
        ],
      ],
    ]);
    expect(committeeVotesOf(outcome)).toHaveLength(3);
  });
});

describe("a Legislator whose code changed, in committee votes", () => {
  // The fixture's CommitteeVotes hold no row for either of Courtney Neron's codes (its floor votes do: see
  // get-measure-votes.test.ts). Two rows are added to SB 69, each in a committee vote of its own (reports
  // 900011 and 900012), one under the code she had in the House and one under the code she has had in the
  // Senate since May 2025. The committee votes are made up; the two codes and the person are the committed
  // alias file's.
  const stray = [
    committeeVoteRow(900011, "Rep Neron", "Aye", {
      reportId: 900011,
      committeeCode: "HLWS",
      meetingDate: "2025-04-30T15:00:00",
    }),
    committeeVoteRow(900012, "Sen Neron Misslin", "Nay", {
      reportId: 900012,
      committeeCode: "SLB",
      meetingDate: "2025-05-21T08:00:00",
    }),
  ];

  it("is one Legislator whichever of her two codes the committee vote uses", async () => {
    const outcome = await getMeasure(
      { clockAt: afterTheSession, olis: { strayRows: { CommitteeVotes: stray } } },
      "SB 69",
    );

    const castsOfHers = (committeeVotesOf(outcome) ?? []).flatMap((vote) =>
      vote.votes
        .filter((cast) => cast.legislator_code === "Rep Neron" || cast.legislator_code === "Sen Neron Misslin")
        .map((cast) => [vote.committee_code, cast.legislator_code, cast.legislator, cast.vote]),
    );
    const neron = { id: "legislator-2025r1-neron", name: "Courtney Neron Misslin" };
    expect(castsOfHers).toEqual([
      ["HLWS", "Rep Neron", neron, "Aye"],
      ["SLB", "Sen Neron Misslin", neron, "Nay"],
    ]);
  });
});

describe("a timestamp the feed does not send", () => {
  // As for Measures (get-measure-feed.test.ts): the feed's times carry no offset, so one that does is
  // refused instead of having its clock digits read as Pacific time.
  it.for([
    [
      "MeasureHistoryActions",
      "ActionDate",
      {
        MeasureHistoryId: 900101,
        SessionKey: "2025R1",
        MeasurePrefix: "SB",
        MeasureNumber: 69,
        Chamber: "S",
        ActionText: "An action with an offset.",
        ActionDate: "2025-01-01T10:00:00+05:00",
      },
    ],
    [
      "MeasureVotes",
      "ActionDate",
      { ...floorVoteRow(900102, "Sen Hayden", "Aye"), ActionDate: "2025-01-01T10:00:00Z" },
    ],
    [
      "CommitteeVotes",
      "MeetingDate",
      { ...committeeVoteRow(900103, "Sen Hayden", "Aye"), MeetingDate: "2025-01-01T10:00:00-08:00" },
    ],
  ] as const)("refuses the pull when a %s row's %s carries an offset", async ([entitySet, property, row]) => {
    const pull = startSystem({ clockAt: afterTheSession, olis: { strayRows: { [entitySet]: [row] } } });

    await expect(pull).rejects.toThrow(new RegExp(`${entitySet}.*${property}`));
  });
});

describe("rows of another Session", () => {
  // Measure numbers and history ids mean different things in each Session (2025S1 is the special
  // session of the same year). Rows for SB 69 of 2025S1 in every set the tool reads are taken for none
  // of SB 69's.
  const otherSession = { SessionKey: "2025S1" };

  it("are in neither the history nor a vote of the deployment's SB 69", async () => {
    const outcome = await getMeasure(
      {
        clockAt: afterTheSession,
        olis: {
          strayRows: {
            MeasureHistoryActions: [
              {
                MeasureHistoryId: 900201,
                MeasurePrefix: "SB",
                MeasureNumber: 69,
                Chamber: "S",
                ActionDate: "2025-08-29T09:00:00",
                ActionText: "A special-session action.",
                CreatedDate: "2025-08-29T09:00:05",
                ...otherSession,
              },
            ],
            MeasureVotes: [{ ...floorVoteRow(900202, "Sen Hayden", "Aye"), ...otherSession }],
            CommitteeVotes: [{ ...committeeVoteRow(900203, "Sen Hayden", "Aye"), ...otherSession }],
          },
        },
      },
      "SB 69",
    );

    expect(historyOf(outcome)).toHaveLength(20);
    expect(floorVotesOf(outcome)).toHaveLength(2);
    expect(committeeVotesOf(outcome)).toHaveLength(2);
  });
});

describe("a Legislator Code that no row and no alias names", () => {
  // The alias file with only Rep Neron in it (the committed file's entry, cut down to the one row that
  // matters): "Sen Woods" is then in no Legislators row and no alias. The fixture's rows that use the
  // code are real: MeasureVotes 1437980 (SB 69) and 1438100 (SB 64), and CommitteeVotes 324941 (SB 69's
  // SLB vote) and 327885 (SB 921's).
  const neronOnly = {
    about: "A test's alias file.",
    aliases: [
      {
        session: "2025R1",
        code: "Rep Neron",
        same_person_as: "Sen Neron Misslin",
        evidence: [
          {
            entity_set: "MeasureVotes (fixture)",
            row: "MeasureVoteId 1468790 and 1475890",
            says: "SB 69, Rep Neron, House, 2025-05-05; SB 983, Sen Neron Misslin, Senate, 2025-05-15.",
          },
        ],
      },
    ],
  };

  function aliasFileOf(content: unknown): string {
    const aliasFile = createTempAliasFile(content);
    aliasFiles.push(aliasFile);
    return aliasFile.path;
  }

  it("shows the voter under the code with no Legislator, and does not guess one", async () => {
    const outcome = await getMeasure(
      { clockAt: afterTheSession, legislatorAliasesPath: aliasFileOf(neronOnly) },
      "SB 69",
    );

    const woods = floorVotesOf(outcome)?.[0]?.votes.find((cast) => cast.legislator_code === "Sen Woods");
    expect(woods).toEqual({ legislator_code: "Sen Woods", legislator: null, vote: "Aye" });
    const inCommittee = committeeVotesOf(outcome)?.[0]?.votes.find((cast) => cast.legislator_code === "Sen Woods");
    expect(inCommittee).toEqual({ legislator_code: "Sen Woods", legislator: null, vote: "Excused" });
  });

  // This case reads the worker's build report (the `unresolvedLegislatorCodes` of its result), not a tool, and so
  // departs from "assert only what get_measure returns". Spec #1 story 54 wants the build to list the codes it
  // could not resolve, no tool shows that list, and the report is the ingest entry point's own result, not a
  // table, SQL or an internal type (test/CLAUDE.md, "Seam-1 tests read state back through the tools"). The
  // sponsor cases of #8 read it the same way (get-measure-sponsors-feed.test.ts), and `pullAgain()` is the
  // harness's way to get it (test/CLAUDE.md, "One system"). What an agent sees of the same codes is the case above.
  it("is listed in the build report, with how many floor and committee vote rows name it", async () => {
    const system = await startSystem({
      clockAt: afterTheSession,
      legislatorAliasesPath: aliasFileOf(neronOnly),
    });
    started.push(system);

    const pull = await system.pullAgain();

    expect(
      pull.unresolvedLegislatorCodes.map((entry) => ({
        ...entry,
        references: [...entry.references].sort((a, b) => a.source.localeCompare(b.source)),
      })),
    ).toEqual([
      {
        code: "Sen Woods",
        references: [
          { source: "CommitteeVotes", count: 2 },
          { source: "MeasureVotes", count: 2 },
        ],
      },
    ]);
  });
});
