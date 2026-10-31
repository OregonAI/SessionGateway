// Seam 1 (test/CLAUDE.md): the worker's loop (ticket #17, ADR-0039) runs what the schedule says, as the tools and the
// fake OLIS's request log show it. The loop's sleep is the harness's: it moves the simulated clock (`runSchedule`), so a
// night or a day of the worker's life takes a moment and no timer runs. The schedule's own rule is a table in
// src/packages/ingest/tests/; here the rule meets the loop, the database and the tools. The embedder is the fake.
//
// An increment is a request for a count of Measures with `gt datetime` in its filter; a full pull is one without.
// All times are Pacific (UTC-8 in January).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeOlis } from "../support/fake-olis.ts";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

vi.setConfig({ testTimeout: 120_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

async function start(options: SystemOptions): Promise<System> {
  const system = await startSystem({ documents: true, ...options });
  started.push(system);
  system.olis.forgetRequests();
  return system;
}

function runsOf(olis: FakeOlis): { increments: number; fullPulls: number } {
  const counts = olis.requests().filter((request) => request.entitySet === "Measures" && request.isCount);
  const increments = counts.filter((request) => request.filter?.includes(" gt datetime") === true).length;
  return { increments, fullPulls: counts.length - increments };
}

async function isHeld(system: System, era: Era, id: string): Promise<boolean> {
  const connected = await connectClient(era, system.handler);
  try {
    return !(await callTool(connected, "get_document", { id })).isError;
  } finally {
    await connected.close();
  }
}

async function idsFound(system: System, era: Era): Promise<string[]> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "search", {
      query: "riparian planting and cover cropping",
      measure: "HB 3131",
    });
    return (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);
  } finally {
    await connected.close();
  }
}

describe("the default rhythm: an increment a night, the full pull on Sunday", () => {
  it("finds a document created during the day after that night's increment, and runs no full pull", async () => {
    // Friday 2025-01-17 at 2 pm, before HB 3131's Testimony 117165 was created (3:16 pm). The night that ends on
    // Saturday is not a full-pull night (those end on a Sunday).
    const system = await start({ clockAt: "2025-01-17T22:00:00Z" });
    for (const era of eras) expect(await idsFound(system, era)).not.toContain("testimony-2025r1-117165");

    system.clock.set("2025-01-17T23:30:00Z"); // 3:30 pm: the letter exists and the worker has not looked
    await system.runSchedule("2025-01-18T16:00:00Z"); // Saturday 8 am

    for (const era of eras) expect(await idsFound(system, era)).toContain("testimony-2025r1-117165");
    // One increment for the night, none in the daytime, and the full pull did not run.
    expect(runsOf(system.olis)).toEqual({ increments: 1, fullPulls: 0 });
  });

  it("runs the full pull in the small hours of the full-pull night, and no increment that night", async () => {
    // Saturday 2025-01-18 at 2 pm. The night that ends on Sunday 2025-01-19 is the weekly full-pull night. MADE UP:
    // a Testimony row created at 3 pm that Saturday, served the file of the real letter 117166.
    const path = "/liz/2025R1/Downloads/PublicTestimonyDocument/900201";
    const system = await start({
      clockAt: "2025-01-18T22:00:00Z",
      olis: { strayDocuments: { [path]: "testimony/117166.pdf" } },
    });
    system.olis.addRows("CommitteePublicTestimonies", [
      {
        SessionKey: "2025R1",
        CommTestId: 900201,
        SubmitterFirstName: "Made",
        SubmitterLastName: "Up 900201",
        PositionOnMeasureId: 3983,
        CommitteeCode: "HALNRW",
        MeetingDate: "2025-01-22T08:00:00",
        DocumentDescription: "Testimony",
        MeasurePrefix: "HB",
        MeasureNumber: 3131,
        DocumentUrl: "https://olis.oregonlegislature.gov/liz/2025R1",
        CreatedDate: "2025-01-18T15:00:00",
        ModifiedDate: null,
      },
    ]);
    system.clock.set("2025-01-18T23:30:00Z");

    await system.runSchedule("2025-01-19T16:00:00Z"); // Sunday 8 am

    for (const era of eras) expect(await isHeld(system, era, "testimony-2025r1-900201")).toBe(true);
    expect(runsOf(system.olis)).toEqual({ increments: 0, fullPulls: 1 });
  });
});

describe("a full pull that OLIS gave short", () => {
  it("is the night's one full pull: a worker restarted in the same night does not read the Session again", async () => {
    // The night that ends on Sunday 2025-01-19 is the weekly full-pull night. The feed counts its rows and pages one
    // fewer, so the pull is refused and stores nothing (full-pull-report.test.ts).
    const system = await start({ clockAt: "2025-01-18T22:00:00Z" });
    system.olis.withholdLastRows(1);

    // The worker runs from Saturday 3:30 pm to Sunday 2 am: the full pull starts at midnight and is refused.
    await expect(system.runSchedule("2025-01-19T10:00:00Z")).rejects.toThrow("A run of the worker's loop failed");
    const afterFirst = runsOf(system.olis);
    expect(afterFirst.fullPulls).toBe(1);

    // The worker restarts at 2 am and runs until 4 am. The Acceptable Use Agreement allows one full pull a day.
    await expect(system.runSchedule("2025-01-19T12:00:00Z")).resolves.toBeUndefined();
    expect(runsOf(system.olis)).toEqual(afterFirst);
  });
});

describe("a meeting day", () => {
  // Wednesday 2025-01-22: HALNRW met at 8 am (feed/CommitteeMeetings.json), so the Session meets that day. The span
  // runs from 5 am that Wednesday to 5:30 am on Thursday.
  const start22 = "2025-01-22T13:00:00Z";
  const end23 = "2025-01-23T13:30:00Z";

  it("runs no increment with increments off and the full pull nightly, only the night's full pull", async () => {
    const system = await start({ clockAt: start22, ingest: { increments: "off", fullPull: "nightly" } });

    await system.runSchedule(end23);

    expect(runsOf(system.olis)).toEqual({ increments: 0, fullPulls: 1 });
  });

  it("runs an increment every 15 minutes from 6 am to 10 pm with 15min", async () => {
    const system = await start({ clockAt: start22, ingest: { increments: "15min", fullPull: "weekly" } });

    await system.runSchedule(end23);

    // 6:00, 6:15, ... 21:45: sixteen hours of four quarters. Thursday's small hours are not a full-pull night.
    expect(runsOf(system.olis)).toEqual({ increments: 64, fullPulls: 0 });
  });
});
