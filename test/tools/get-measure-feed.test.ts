// Seam 1: what get_measure shows depends on what the feed said and when. Each case here builds its
// own system, because the feed it serves (the clock time, the page size, the rows served) is the
// thing under test. Cases that only read are in get-measure.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

async function getMeasure(options: SystemOptions, reference: string) {
  return (await getMeasures(options, [reference]))[0] as ToolOutcome;
}

/** Builds one system and looks several references up in it. */
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

describe("Pacific time", () => {
  // The feed row for SB 69 (test/fixtures/olis-2025R1/feed/Measures.json) says
  //   "CreatedDate":"2024-12-31T13:18:07"  and  "ModifiedDate":"2025-05-20T10:38:35",
  // with no offset. Oregon was on standard time (UTC-8) on 31 December and on daylight time (UTC-7)
  // on 20 May: daylight time began on 2025-03-09 (spec of the Pacific zone, not of this code).
  it("shows a winter and a summer feed timestamp with the offset in force on its day", async () => {
    const outcome = await getMeasure({ clockAt: "2025-07-15T17:00:00Z" }, "SB 69");

    expect(outcome.structured).toMatchObject({
      created_at: "2024-12-31T13:18:07-08:00",
      modified_at: "2025-05-20T10:38:35-07:00",
    });
  });

  it("shows the as-of time with the offset in force when the pull ran", async () => {
    const summer = await getMeasure({ clockAt: "2025-07-15T17:00:00Z" }, "SB 69");
    const winter = await getMeasure({ clockAt: "2025-12-15T17:00:00Z" }, "SB 69");

    expect(summer.structured).toMatchObject({ as_of: "2025-07-15T10:00:00-07:00" });
    expect(winter.structured).toMatchObject({ as_of: "2025-12-15T09:00:00-08:00" });
  });
});

describe("a timestamp the feed does not send", () => {
  // The feed's timestamps are Edm.DateTime and carry no offset (docs/research/olis-odata.md section 6).
  // One that carries an offset is not in the form the client reads as Pacific local time, so the pull
  // refuses it instead of reading its clock digits as Pacific time and shifting the instant.
  const row = {
    SessionKey: "2025R1",
    MeasurePrefix: "HB",
    MeasureNumber: 9001,
    CatchLine: "A Measure whose timestamp carries an offset.",
    CreatedDate: "2025-01-01T10:00:00",
    ModifiedDate: null,
  };

  it.for([
    ["CreatedDate", "2025-01-01T10:00:00+05:00"],
    ["CreatedDate", "2025-01-01T10:00:00Z"],
    ["ModifiedDate", "2025-01-01T10:00:00-08:00"],
    ["ModifiedDate", "yesterday"],
  ])("refuses the pull when %s is %s", async ([property, value]) => {
    const stray = { ...row, [property as string]: value };

    const pull = startSystem({ clockAt: "2025-12-15T17:00:00Z", olis: { strayRows: { Measures: [stray] } } });

    await expect(pull).rejects.toThrow(new RegExp(String(property)));
  });
});

describe("the deployment's Session", () => {
  // A Measure of another Session that shares SB 69's prefix and number: measure numbers restart each
  // Session (docs/research/olis-odata.md section 8, gotcha 1). The harness adds it to the fake
  // OLIS; the committed fixture holds 2025R1 only.
  const otherSessionSb69 = {
    SessionKey: "2025S1",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    CatchLine: "A special-session Measure that happens to be numbered SB 69.",
    CreatedDate: "2025-08-29T09:00:00",
    ModifiedDate: null,
  };
  const sb69CatchlineStart = "Specifies that the Bureau of Labor and Industries";

  it("does not let a row of another Session replace the Measure with the same prefix and number", async () => {
    const olis = { strayRows: { Measures: [otherSessionSb69] } };

    const own = await getMeasure({ clockAt: "2025-12-15T17:00:00Z", olis }, "SB 69");

    expect(own.structured).toMatchObject({ id: "measure-2025r1-sb69" });
    expect(String(own.structured?.["catchline"])).toContain(sb69CatchlineStart);
  });

  it("takes no row of another Session into the index: a server for that Session finds nothing", async () => {
    // The worker pulls 2025R1 and the feed serves a 2025S1 row anyway. A server then configured for
    // 2025S1 over the same database must not find that row: the pull never took it.
    const outcome = await getMeasure(
      {
        clockAt: "2025-12-15T17:00:00Z",
        olis: { strayRows: { Measures: [otherSessionSb69] } },
        serverEnv: { SESSION_KEY: "2025S1" },
      },
      "SB 69",
    );

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('No Measure "SB 69" in the 2025S1 Session');
  });

  it("serves the Session the configuration names", async () => {
    const options = {
      clockAt: "2025-12-15T17:00:00Z",
      sessionKey: "2025S1",
      olis: { strayRows: { Measures: [otherSessionSb69] } },
    };

    const configured = await getMeasure(options, "SB 69");
    const unconfigured = await getMeasure(options, "measure-2025r1-sb69");

    expect(configured.structured).toMatchObject({
      id: "measure-2025s1-sb69",
      catchline: "A special-session Measure that happens to be numbered SB 69.",
    });
    expect(unconfigured.isError).toBe(true);
  });
});

describe("the simulated clock", () => {
  // SB 921's row says "CreatedDate":"2025-01-16T11:00:34" (Pacific local time, Measures.json).
  it("serves only the Measures the feed had by then", async () => {
    // 10:00 and 12:00 on 2025-01-16 in Oregon, which was on UTC-8.
    const beforeCreation = await getMeasure({ clockAt: "2025-01-16T18:00:00Z" }, "SB 921");
    const afterCreation = await getMeasure({ clockAt: "2025-01-16T20:00:00Z" }, "SB 921");

    expect(beforeCreation.isError).toBe(true);
    expect(afterCreation.structured).toMatchObject({ id: "measure-2025r1-sb921" });
  });
});

describe("the OLIS base URL", () => {
  // docs/research/olis-odata.md writes the service root as https://api.oregonlegislature.gov/odata/odataservice.svc
  // with no trailing slash, and that is what an operator will copy into OLIS_BASE_URL.
  it("reaches the feed from the service root written without a trailing slash", async () => {
    const outcome = await getMeasure(
      { clockAt: "2025-12-15T17:00:00Z", olisBaseUrl: (root) => root.replace(/\/$/, "") },
      "SB 69",
    );

    expect(outcome.structured).toMatchObject({ id: "measure-2025r1-sb69" });
  });
});

describe("the feed's paging", () => {
  // The fixture holds these eight Measures of 2025R1 (test/fixtures/olis-2025R1/measures.txt).
  const fixtureMeasures = [
    ["SB 64", "measure-2025r1-sb64"],
    ["SB 69", "measure-2025r1-sb69"],
    ["SB 121", "measure-2025r1-sb121"],
    ["SB 921", "measure-2025r1-sb921"],
    ["SB 983", "measure-2025r1-sb983"],
    ["HB 3027", "measure-2025r1-hb3027"],
    ["HB 3131", "measure-2025r1-hb3131"],
    ["HB 3795", "measure-2025r1-hb3795"],
  ] as const;

  it("reads every page: three rows to a page leave no Measure behind", async () => {
    const outcomes = await getMeasures(
      { clockAt: "2025-12-15T17:00:00Z", olis: { pageSize: 3 } },
      fixtureMeasures.map(([citation]) => citation),
    );

    expect(outcomes.map((outcome) => outcome.structured?.["id"])).toEqual(fixtureMeasures.map(([, id]) => id));
  });

  // A feed that never stops paging must end the pull with an error, not keep the worker fetching and
  // collecting rows until memory runs out or the process is stopped (src/CLAUDE.md, "Errors").
  it("refuses a feed whose next link keeps returning to the first page", { timeout: 10_000 }, async () => {
    const pull = startSystem({ clockAt: "2025-12-15T17:00:00Z", olis: { pagingFault: "repeats-the-first-page" } });

    await expect(pull).rejects.toThrow(/more rows than.*counted/);
  });

  it("refuses a feed that keeps sending empty pages with a next link", { timeout: 10_000 }, async () => {
    const pull = startSystem({ clockAt: "2025-12-15T17:00:00Z", olis: { pagingFault: "never-ends" } });

    await expect(pull).rejects.toThrow(/empty page/);
  });

  it("refuses a pull whose pages hold fewer rows than the feed counted", async () => {
    const pull = startSystem({ clockAt: "2025-12-15T17:00:00Z", olis: { withholdLastRows: 1 } });

    await expect(pull).rejects.toThrow(/counted 8.*read 7/);
  });
});
