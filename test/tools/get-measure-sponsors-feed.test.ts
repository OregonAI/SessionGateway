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
import { createTempAliasFile, type TempAliasFile } from "../support/alias-file.ts";
import { callTool, connectClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { legislatorRow, memberSponsorRow, sponsorsOf } from "../support/sponsors.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];
const aliasFiles: TempAliasFile[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
  for (const aliasFile of aliasFiles.splice(0)) aliasFile.remove();
});

/** Writes an alias file for the system under test to read in place of the committed one. */
function aliasFileOf(content: unknown): string {
  const aliasFile = createTempAliasFile(content);
  aliasFiles.push(aliasFile);
  return aliasFile.path;
}

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
    // Neron Misslin). One person, so one id, whichever code a sponsor row uses. The id is the one the
    // alias file's code makes (see "one Legislator across the codes the feed uses for them" below).
    const [hb3131, sb69] = await getMeasures(
      {
        clockAt: afterTheSession,
        olis: { strayRows: { MeasureSponsors: [memberSponsorRow("900010", "Sen Neron Misslin", "Regular", "20")] } },
      },
      ["HB 3131", "SB 69"],
    );

    const neron = sponsorsOf(hb3131)?.find((sponsor) => sponsor.legislator_code === "Rep Neron");
    const neronMisslin = sponsorsOf(sb69)?.[0];
    expect(neron?.legislator).toEqual({ id: "legislator-2025r1-neron", name: "Courtney Neron Misslin" });
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

describe("the alias file the worker is given", () => {
  // "Sen Woods" alone: a file that does not list "Rep Neron". The entry is the committed one's own
  // evidence for Woods, cut down to the cache's row 150301.
  const woodsOnly = {
    about: "A test's alias file.",
    aliases: [
      {
        session: "2025R1",
        code: "Sen Woods",
        person: { first_name: "Aaron", last_name: "Woods" },
        evidence: [
          { entity_set: "MeasureSponsors (cache)", row: "MeasureSponsorId 150301", says: "HB 3592, Sen Woods, Chief." },
        ],
      },
    ],
  };

  it("is the only one read: HB 3131's Rep Neron stays unresolved when the file does not list the code", async () => {
    const system = await startSystem({
      clockAt: afterTheSession,
      legislatorAliasesPath: aliasFileOf(woodsOnly),
    });
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

  it.for([
    [
      "an entry that cites no evidence",
      { about: "", aliases: [{ session: "2025R1", code: "Rep Neron", same_person_as: "Sen Neron Misslin" }] },
    ],
    ["text that is not JSON", "{ not json"],
    [
      "an entry that names a code with an entry of its own, here its own",
      {
        about: "",
        aliases: [
          {
            session: "2025R1",
            code: "Rep Neron",
            same_person_as: "Rep Neron",
            evidence: [{ entity_set: "a test", row: "none", says: "made up for the test" }],
          },
        ],
      },
    ],
  ] as const)("stops the pull, naming the alias file, for %s", async ([, content]) => {
    const pull = startSystem({ clockAt: afterTheSession, legislatorAliasesPath: aliasFileOf(content) });

    await expect(pull).rejects.toThrow(/Legislator alias file/);
  });
});

describe("one Legislator across the codes the feed uses for them", () => {
  // Courtney Neron was "Rep Neron" until she moved to the Senate on 2025-05-09, when the feed's
  // Legislators set gained "Sen Neron Misslin" (olis-odata.md section 8, gotcha 4; the committed alias
  // file cites the rows). The set is a current snapshot, so a pull made before the move would list
  // "Rep Neron" (inferred: the cache holds only the snapshot of 2026-10-28). The id is the one the
  // alias file's code, "Rep Neron", makes: it does not depend on which of the two rows the snapshot has.
  const repNeronRow = legislatorRow("2025R1", "Rep Neron", "Courtney", "Neron");
  const neronId = "legislator-2025r1-neron";

  it("keeps her id from a pull made before the move to a pull made after it", async () => {
    const [before] = await getMeasures(
      { clockAt: "2025-01-29T17:00:00Z", olis: { strayRows: { Legislators: [repNeronRow] } } },
      ["HB 3131"],
    );
    const [after] = await getMeasures({ clockAt: afterTheSession }, ["HB 3131"]);

    const neronOf = (outcome: ToolOutcome | undefined) =>
      sponsorsOf(outcome)?.find((sponsor) => sponsor.legislator_code === "Rep Neron")?.legislator;
    expect(neronOf(before)).toEqual({ id: neronId, name: "Courtney Neron" });
    expect(neronOf(after)).toEqual({ id: neronId, name: "Courtney Neron Misslin" });
  });

  it("is one person when the Legislators set lists both of her codes", async () => {
    const [hb3131, sb69] = await getMeasures(
      {
        clockAt: afterTheSession,
        olis: {
          strayRows: {
            Legislators: [repNeronRow],
            MeasureSponsors: [memberSponsorRow("900010", "Sen Neron Misslin", "Regular", "20")],
          },
        },
      },
      ["HB 3131", "SB 69"],
    );

    const neron = sponsorsOf(hb3131)?.find((sponsor) => sponsor.legislator_code === "Rep Neron");
    const neronMisslin = sponsorsOf(sb69)?.[0];
    const person = { id: neronId, name: "Courtney Neron Misslin" };
    expect(neron?.legislator).toEqual(person);
    expect(neronMisslin?.legislator).toEqual(person);
  });
});

describe("the id of a Legislator whose code carries more than the last name", () => {
  // These two rows are made up for the test, in the shape of the real "Rep Speaker Fahey" row: a title
  // between the chamber word and the name, as the feed writes it for the Speaker and the President.
  it("leaves the title out even when the code writes only part of a longer last name", async () => {
    const row = memberSponsorRow("900040", "Rep Speaker Quux", "Chief", "1");
    const outcome = await getMeasure(
      {
        clockAt: afterTheSession,
        olis: {
          strayRows: {
            Legislators: [legislatorRow("2025R1", "Rep Speaker Quux", "Quentin", "Quux-Zed")],
            MeasureSponsors: [row],
          },
        },
      },
      "SB 69",
    );

    expect(sponsorsOf(outcome)?.[0]?.legislator).toEqual({ id: "legislator-2025r1-quux", name: "Quentin Quux-Zed" });
  });

  it("stops the pull for a code that does not contain the last name, since the title cannot be told from the name", async () => {
    const pull = startSystem({
      clockAt: afterTheSession,
      olis: { strayRows: { Legislators: [legislatorRow("2025R1", "Rep Speaker Quux", "Quentin", "Smith")] } },
    });

    await expect(pull).rejects.toThrow(/"Rep Speaker Quux" does not contain the last name "Smith"/);
  });

  it("stops the pull for an alias file that names one Legislator Code as the person of two others", async () => {
    const entry = (code: string) => ({
      session: "2025R1",
      code,
      same_person_as: "Sen Neron Misslin",
      evidence: [{ entity_set: "a test", row: "none", says: "made up for the test" }],
    });
    const pull = startSystem({
      clockAt: afterTheSession,
      legislatorAliasesPath: aliasFileOf({ about: "", aliases: [entry("Rep Neron"), entry("Rep Courtney")] }),
    });

    await expect(pull).rejects.toThrow(
      /"Sen Neron Misslin" as the same person for both "Rep Neron" and "Rep Courtney"/,
    );
  });
});
