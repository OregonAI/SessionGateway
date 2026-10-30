// Seam 1: what get_measure shows of a Measure's sponsors depends on what the feed said. Each case
// here builds its own system, because the rows the fake OLIS serves (or the time it serves them at)
// are the thing under test. Cases that only read the committed fixture are in
// get-measure-sponsors.test.ts.
//
// A stray row is a MeasureSponsors row the test adds to what the fake OLIS serves; the committed
// fixture never changes (test/CLAUDE.md). Each one is a real row of the cached 2025R1 feed, pointed
// at SB 69 so that the fixture holds the Measure it names.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
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

/** A Member row of MeasureSponsors in the feed's own shape, on SB 69. */
function sb69MemberRow(id: string, code: string, level: "Chief" | "Regular", printOrder: string) {
  return {
    MeasureSponsorId: id,
    SessionKey: "2025R1",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    SponsorType: "Member",
    LegislatoreCode: code,
    CommitteeCode: null,
    SponsorLevel: level,
    PrintOrder: printOrder,
    PresessionFiledMessage: null,
    CreatedDate: "2024-12-30T16:16:37",
    ModifiedDate: null,
  };
}

// 2025-12-15, after the newest Legislators row was created (2025-06-07).
const afterTheSession = "2025-12-15T17:00:00Z";

/** A Legislators row in the feed's own shape. */
function legislatorRow(session: string, code: string, firstName: string, lastName: string) {
  return {
    SessionKey: session,
    LegislatorCode: code,
    FirstName: firstName,
    LastName: lastName,
    Title: "Representative",
    Chamber: "H",
    CreatedDate: "2024-11-06T11:52:47",
    ModifiedDate: null,
  };
}

type Sponsor = { level: string; legislator_code: string; legislator: { id: string; name: string } | null };

describe("Legislator Codes that carry a leadership title", () => {
  // The codes are the cache's own: "Rep Speaker Fahey" is the chief sponsor of HB 2010 (MeasureSponsorId
  // 143197) and "Sen President Wagner" a sponsor of SB 223 (143036). Each has a Legislators row with
  // that code (Title "Speaker" and "President"), whose name is Julie Fahey and Rob Wagner.
  it.for([
    ["Speaker", "Rep Speaker Fahey", "legislator-2025r1-fahey", "Julie Fahey"],
    ["President", "Sen President Wagner", "legislator-2025r1-wagner", "Rob Wagner"],
  ])(
    "resolves the code of the %s (%s) to the Legislator, named for the person and not the office",
    async ([, code, id, name]) => {
      const outcome = await getMeasure(
        {
          clockAt: afterTheSession,
          olis: { strayRows: { MeasureSponsors: [sb69MemberRow("143197", code as string, "Chief", "1")] } },
        },
        "SB 69",
      );

      expect((outcome.structured?.["sponsors"] as Sponsor[])[0]).toEqual({
        level: "chief",
        legislator_code: code,
        legislator: { id, name },
      });
    },
  );
});

describe("a Legislator Code that has no Legislators row and no alias", () => {
  // "Rep Fahey" is the code a Legislators row would carry if the Speaker's title were not in it: the
  // snapshot's row for her is "Rep Speaker Fahey" (Julie Fahey). A resolver that guessed from the look
  // of a code would name her here. The feed gives no reason to, so the code stays unresolved.
  const strayRows = [
    sb69MemberRow("900001", "Rep Fahey", "Chief", "1"),
    sb69MemberRow("900002", "Rep Fahey", "Regular", "20"),
  ];

  it("shows the sponsor under its code with no Legislator, and does not guess one", async () => {
    const outcome = await getMeasure(
      { clockAt: afterTheSession, olis: { strayRows: { MeasureSponsors: strayRows } } },
      "SB 69",
    );

    expect(outcome.structured?.["sponsors"]).toEqual([
      { level: "chief", legislator_code: "Rep Fahey", legislator: null },
      { level: "regular", legislator_code: "Rep Fahey", legislator: null },
    ]);
  });

  it("is listed in the build report, with how many sponsor rows name it", async () => {
    const system = await startSystem({
      clockAt: afterTheSession,
      olis: { strayRows: { MeasureSponsors: strayRows } },
    });
    started.push(system);

    const pull = await system.pullAgain();

    expect(pull.unresolvedLegislatorCodes).toEqual([
      { code: "Rep Fahey", references: [{ source: "MeasureSponsors", count: 2 }] },
    ]);
  });

  it("leaves the build report empty when every sponsor code in the fixture resolves", async () => {
    // The fixture's one sponsor code without a Legislators row, "Rep Neron", is in the alias file.
    const system = await startSystem({ clockAt: afterTheSession });
    started.push(system);

    const pull = await system.pullAgain();

    expect(pull.unresolvedLegislatorCodes).toEqual([]);
  });
});

describe("a Legislator Code that has no Legislators row", () => {
  it("resolves through the alias file to the person it names, who has no Legislators row at all", async () => {
    // "Sen Woods" is in the alias file as Aaron Woods; the fixture has no sponsor row for the code, so
    // a stray one is added (a real code: the cache's HB 3592 names "Sen Woods" as a chief sponsor).
    const system = await startSystem({
      clockAt: afterTheSession,
      olis: { strayRows: { MeasureSponsors: [sb69MemberRow("150301", "Sen Woods", "Chief", "2")] } },
    });
    started.push(system);
    const connected = await connectClient("2026-07-28", system.handler);
    try {
      const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });
      const pull = await system.pullAgain();

      expect(outcome.structured?.["sponsors"]).toEqual([
        {
          level: "chief",
          legislator_code: "Sen Woods",
          legislator: { id: "legislator-2025r1-woods", name: "Aaron Woods" },
        },
      ]);
      expect(pull.unresolvedLegislatorCodes).toEqual([]);
    } finally {
      await connected.close();
    }
  });

  it("puts a code that moved chamber on the same Legislator as the code the row carries", async () => {
    // HB 3131's chief sponsor "Rep Neron" has no Legislators row; "Sen Neron Misslin" has one (Courtney
    // Neron Misslin). One person, so one id, whichever code a sponsor row uses.
    const [hb3131, sb69] = await getMeasures(
      {
        clockAt: afterTheSession,
        olis: { strayRows: { MeasureSponsors: [sb69MemberRow("900010", "Sen Neron Misslin", "Regular", "20")] } },
      },
      ["HB 3131", "SB 69"],
    );

    const neron = (hb3131?.structured?.["sponsors"] as Sponsor[]).find(
      (sponsor) => sponsor.legislator_code === "Rep Neron",
    );
    const neronMisslin = (sb69?.structured?.["sponsors"] as Sponsor[])[0];
    expect(neron?.legislator).toEqual({ id: "legislator-2025r1-neron-misslin", name: "Courtney Neron Misslin" });
    expect(neronMisslin?.legislator).toEqual(neron?.legislator);
  });

  it("stays unresolved, and is reported, while the Legislator the alias names is not in the feed yet", async () => {
    // On 2025-01-29 the fake OLIS has no Legislators row for "Sen Neron Misslin" (created 2025-05-09),
    // so the alias for "Rep Neron" has nobody to point at.
    const system = await startSystem({ clockAt: "2025-01-29T17:00:00Z" });
    started.push(system);
    const connected = await connectClient("2026-07-28", system.handler);
    try {
      const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });
      const pull = await system.pullAgain();

      const neron = (outcome.structured?.["sponsors"] as Sponsor[]).find(
        (sponsor) => sponsor.legislator_code === "Rep Neron",
      );
      expect(neron).toEqual({ level: "chief", legislator_code: "Rep Neron", legislator: null });
      expect(pull.unresolvedLegislatorCodes).toEqual([
        { code: "Rep Neron", references: [{ source: "MeasureSponsors", count: 1 }] },
      ]);
    } finally {
      await connected.close();
    }
  });
});

describe("rows the resolver refuses to build on", () => {
  it.for([
    [
      "two Legislators whose codes would make one id",
      [legislatorRow("2025R1", "Rep Fahey", "Julie", "Fahey")],
      /"Rep Speaker Fahey" and "Rep Fahey" would both have the id legislator-2025r1-fahey/,
    ],
    [
      "a Legislator Code listed twice",
      [legislatorRow("2025R1", "Rep Helm", "Ken", "Helm")],
      /list the Legislator Code "Rep Helm" twice/,
    ],
  ] as const)("stops the pull for %s", async ([, rows, message]) => {
    const pull = startSystem({ clockAt: afterTheSession, olis: { strayRows: { Legislators: [...rows] } } });

    await expect(pull).rejects.toThrow(message);
  });

  it("stops the pull for a Member sponsor row that names no Legislator Code", async () => {
    const row = { ...sb69MemberRow("900020", "Rep Helm", "Chief", "1"), LegislatoreCode: null };

    const pull = startSystem({ clockAt: afterTheSession, olis: { strayRows: { MeasureSponsors: [row] } } });

    await expect(pull).rejects.toThrow(/MeasureSponsorId 900020/);
  });
});

describe("rows of another Session", () => {
  it("are taken for neither a sponsor nor a Legislator", async () => {
    // Legislator Codes and measure numbers mean different things in each Session (2025S1 is the
    // special session of the same year).
    const [hb3131, sb69] = await getMeasures(
      {
        clockAt: afterTheSession,
        olis: {
          strayRows: {
            Legislators: [legislatorRow("2025S1", "Rep Owens", "Another", "Owens")],
            MeasureSponsors: [{ ...sb69MemberRow("900030", "Rep Owens", "Chief", "1"), SessionKey: "2025S1" }],
          },
        },
      },
      ["HB 3131", "SB 69"],
    );

    expect((hb3131?.structured?.["sponsors"] as Sponsor[])[0]?.legislator).toEqual({
      id: "legislator-2025r1-owens",
      name: "Mark Owens",
    });
    expect(sb69?.structured?.["sponsors"]).toEqual([]);
  });
});

describe("sponsors with the same print order", () => {
  it("follow in MeasureSponsorId order, whatever order the feed sent the rows in", async () => {
    // Both rows are regular sponsors with PrintOrder 20. The feed sends the later one (900002) first.
    const outcome = await getMeasure(
      {
        clockAt: afterTheSession,
        olis: {
          strayRows: {
            MeasureSponsors: [
              sb69MemberRow("900002", "Sen President Wagner", "Regular", "20"),
              sb69MemberRow("900001", "Rep Speaker Fahey", "Regular", "20"),
            ],
          },
        },
      },
      "SB 69",
    );

    const codes = (outcome.structured?.["sponsors"] as Sponsor[]).map((sponsor) => sponsor.legislator_code);
    expect(codes).toEqual(["Rep Speaker Fahey", "Sen President Wagner"]);
  });
});
