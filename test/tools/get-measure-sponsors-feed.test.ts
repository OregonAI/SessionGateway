// Seam 1: what get_measure shows of a Measure's sponsors depends on what the feed said. Each case
// here builds its own system, because the rows the fake OLIS serves (or the time it serves them at)
// are the thing under test. Cases that only read the committed fixture are in
// get-measure-sponsors.test.ts.
//
// A stray row is a MeasureSponsors row the test adds to what the fake OLIS serves; the committed
// fixture never changes (test/CLAUDE.md). A row with a MeasureSponsorId below 900000 is a real row
// of the cached 2025R1 feed (.cache/olis-2025R1/feed/MeasureSponsors.json), with its code, level,
// PrintOrder and CreatedDate as the cache has them and only its Measure changed to SB 69, so that
// the fixture holds the Measure it names; the comment beside it names the Measure it came from. A
// MeasureSponsorId of 900000 or more is made up for the test, and carries a Legislator Code in a form
// the feed does use.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { legislatorRow, memberSponsorRow, sponsorsOf } from "../support/sponsors.ts";
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

// 2025-12-15, after the newest Legislators row was created (2025-06-07).
const afterTheSession = "2025-12-15T17:00:00Z";

describe("Legislator Codes that carry a leadership title", () => {
  // Both rows are real rows of the cache, moved to SB 69. "Rep Speaker Fahey" is the chief sponsor of
  // HB 2010 (MeasureSponsorId 143197, PrintOrder 1, created 2024-12-30T16:16:37) and "Sen President
  // Wagner" a regular sponsor of SB 223 (143036, PrintOrder 20, created 2024-12-26T22:36:10). Each
  // has a Legislators row with that code (Title "Speaker" and "President") in the fixture, whose name
  // is Julie Fahey and Rob Wagner.
  it.for([
    [
      "Speaker",
      memberSponsorRow("143197", "Rep Speaker Fahey", "Chief", "1", { createdDate: "2024-12-30T16:16:37" }),
      { level: "chief", id: "legislator-2025r1-fahey", name: "Julie Fahey" },
    ],
    [
      "President",
      memberSponsorRow("143036", "Sen President Wagner", "Regular", "20", { createdDate: "2024-12-26T22:36:10" }),
      { level: "regular", id: "legislator-2025r1-wagner", name: "Rob Wagner" },
    ],
  ] as const)(
    "resolves the code of the %s to the Legislator, named for the person and not the office",
    async ([, row, expected]) => {
      const outcome = await getMeasure(
        { clockAt: afterTheSession, olis: { strayRows: { MeasureSponsors: [row] } } },
        "SB 69",
      );

      expect(sponsorsOf(outcome)?.[0]).toEqual({
        level: expected.level,
        legislator_code: row["LegislatoreCode"],
        legislator: { id: expected.id, name: expected.name },
      });
    },
  );
});

describe("a Legislator Code that has no Legislators row and no alias", () => {
  // "Rep Fahey" is the code a Legislators row would carry if the Speaker's title were not in it: the
  // snapshot's row for her is "Rep Speaker Fahey" (Julie Fahey). A resolver that guessed from the look
  // of a code would name her here. The feed gives no reason to, so the code stays unresolved.
  const strayRows = [
    memberSponsorRow("900001", "Rep Fahey", "Chief", "1"),
    memberSponsorRow("900002", "Rep Fahey", "Regular", "20"),
  ];

  it("shows the sponsor under its code with no Legislator, and does not guess one", async () => {
    const outcome = await getMeasure(
      { clockAt: afterTheSession, olis: { strayRows: { MeasureSponsors: strayRows } } },
      "SB 69",
    );

    expect(sponsorsOf(outcome)).toEqual([
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
    // a stray one is added: the cache's row 150301 (HB 3592, Chief, PrintOrder 2, created
    // 2025-02-17T18:03:00), moved to SB 69.
    const system = await startSystem({
      clockAt: afterTheSession,
      olis: {
        strayRows: {
          MeasureSponsors: [
            memberSponsorRow("150301", "Sen Woods", "Chief", "2", { createdDate: "2025-02-17T18:03:00" }),
          ],
        },
      },
    });
    started.push(system);
    const connected = await connectClient("2026-07-28", system.handler);
    try {
      const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });
      const pull = await system.pullAgain();

      expect(sponsorsOf(outcome)).toEqual([
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
        olis: { strayRows: { MeasureSponsors: [memberSponsorRow("900010", "Sen Neron Misslin", "Regular", "20")] } },
      },
      ["HB 3131", "SB 69"],
    );

    const neron = sponsorsOf(hb3131)?.find((sponsor) => sponsor.legislator_code === "Rep Neron");
    const neronMisslin = sponsorsOf(sb69)?.[0];
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

      const neron = sponsorsOf(outcome)?.find((sponsor) => sponsor.legislator_code === "Rep Neron");
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
    const row = { ...memberSponsorRow("900020", "Rep Helm", "Chief", "1"), LegislatoreCode: null };

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
            MeasureSponsors: [{ ...memberSponsorRow("900030", "Rep Owens", "Chief", "1"), SessionKey: "2025S1" }],
          },
        },
      },
      ["HB 3131", "SB 69"],
    );

    expect(sponsorsOf(hb3131)?.[0]?.legislator).toEqual({
      id: "legislator-2025r1-owens",
      name: "Mark Owens",
    });
    expect(sponsorsOf(sb69)).toEqual([]);
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
              memberSponsorRow("900002", "Sen President Wagner", "Regular", "20"),
              memberSponsorRow("900001", "Rep Speaker Fahey", "Regular", "20"),
            ],
          },
        },
      },
      "SB 69",
    );

    const codes = sponsorsOf(outcome)?.map((sponsor) => sponsor.legislator_code);
    expect(codes).toEqual(["Rep Speaker Fahey", "Sen President Wagner"]);
  });
});
