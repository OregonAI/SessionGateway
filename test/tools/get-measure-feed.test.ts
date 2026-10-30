// Seam 1: what get_measure shows depends on what the feed said and when. Each case here builds its
// own system, because the feed it serves (the clock time, the page size, the rows served) is the
// thing under test. Cases that only read are in get-measure.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

async function getMeasure(options: SystemOptions, reference: string) {
  const system = await startSystem(options);
  started.push(system);
  const connected = await connectClient("2026-07-28", system.handler);
  try {
    return await callTool(connected, "get_measure", { measure: reference });
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

  it("ignores rows of another Session that the feed serves", async () => {
    const olis = { strayRows: { Measures: [otherSessionSb69] } };

    const own = await getMeasure({ clockAt: "2025-12-15T17:00:00Z", olis }, "SB 69");
    const other = await getMeasure({ clockAt: "2025-12-15T17:00:00Z", olis }, "measure-2025s1-sb69");

    expect(own.structured).toMatchObject({ id: "measure-2025r1-sb69" });
    expect(String(own.structured?.["catchline"])).toContain(sb69CatchlineStart);
    expect(other.isError).toBe(true);
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
