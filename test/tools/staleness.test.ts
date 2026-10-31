// Seam 1 (test/CLAUDE.md): the staleness warning (ticket #17, ADR-0039). Every answer says when the index's latest update
// is too old, by the rhythm the deployment configured: `15min` over two hours old during working hours, `daily` older
// than the last night window (a night was missed), `off` a full pull older than its last scheduled run. Each case builds
// a system, moves the simulated clock without running the worker (or runs it, to show the warning clears) and reads what
// an agent reads: the text of a tool's answer. All times are Pacific (UTC-8 in January). The embedder is the fake, and
// the Session's meeting days are the fixture's (HALNRW met on Wednesday 2025-01-22; nothing meets on Sunday 2025-01-26).
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

async function start(options: SystemOptions): Promise<System> {
  const system = await startSystem(options);
  started.push(system);
  return system;
}

const WARNING = "may be out of date";

/** What an agent reads from one answer: all of its text. */
async function answerText(system: System, tool = "session_overview"): Promise<string> {
  const connected = await connectClient("2026-07-28", system.handler);
  try {
    const args = tool === "search" ? { query: "leave" } : tool === "get_measure" ? { measure: "SB 69" } : {};
    return (await callTool(connected, tool, args)).text;
  } finally {
    await connected.close();
  }
}

describe("15min: the latest update is over two hours old during working hours", () => {
  // Wednesday 2025-01-22, a day the Session meets; the pull is at 7:00 am.
  const pulledAt = "2025-01-22T15:00:00Z";
  const options: SystemOptions = { clockAt: pulledAt, ingest: { increments: "15min", fullPull: "weekly" } };

  it("does not warn two hours after the update, and warns a minute later, in every tool", async () => {
    const system = await start(options);

    system.clock.set("2025-01-22T17:00:00Z"); // 9:00 am: two hours exactly
    expect(await answerText(system)).not.toContain(WARNING);

    system.clock.set("2025-01-22T17:01:00Z"); // 9:01 am
    for (const tool of ["session_overview", "search", "get_measure"]) {
      const text = await answerText(system, tool);
      expect(text, tool).toContain(WARNING);
      expect(text, tool).toContain("more than two hours ago");
      expect(text, tool).toContain("2025-01-22T07:00:00-08:00");
    }
  });

  it("warns both kinds of client alike", async () => {
    const system = await start(options);
    system.clock.set("2025-01-22T18:00:00Z"); // 10:00 am
    for (const era of eras) {
      const connected = await connectClient(era, system.handler);
      expect((await callTool(connected, "session_overview", {})).text, era).toContain(WARNING);
      await connected.close();
    }
  });

  it("is cleared by an increment, which is an update", async () => {
    const system = await start(options);
    system.clock.set("2025-01-22T16:50:00Z"); // 8:50 am
    await system.incrementAgain();

    system.clock.set("2025-01-22T18:49:00Z"); // 10:49 am, one hour 59 minutes after the increment
    expect(await answerText(system)).not.toContain(WARNING);
    system.clock.set("2025-01-22T18:51:00Z"); // 10:51 am
    expect(await answerText(system)).toContain(WARNING);
  });

  it("does not warn outside working hours, 10 pm and after", async () => {
    const system = await start(options);
    system.clock.set("2025-01-23T05:59:00Z"); // 9:59 pm, working hours still
    expect(await answerText(system)).toContain(WARNING);
    system.clock.set("2025-01-23T06:00:00Z"); // 10:00 pm
    expect(await answerText(system)).not.toContain(WARNING);
  });

  it("does not warn on a day the Session does not meet", async () => {
    // Sunday 2025-01-26: nothing meets, and the pull is at 7:00 am.
    const system = await start({ ...options, clockAt: "2025-01-26T15:00:00Z" });
    system.clock.set("2025-01-26T23:00:00Z"); // 3:00 pm, eight hours later
    expect(await answerText(system)).not.toContain(WARNING);
  });
});

describe("daily: the latest update is older than the last night window", () => {
  // Friday 2025-01-17, pulled at 2:00 pm. Night windows run from 5 pm to 6 am.
  const options: SystemOptions = {
    clockAt: "2025-01-17T22:00:00Z",
    ingest: { increments: "daily", fullPull: "weekly" },
  };

  it("does not warn during the day, nor in the night that is still to run", async () => {
    const system = await start(options);
    system.clock.set("2025-01-18T04:00:00Z"); // 8:00 pm Friday, inside tonight's window
    expect(await answerText(system)).not.toContain(WARNING);
    system.clock.set("2025-01-18T13:59:00Z"); // 5:59 am Saturday, the window is still open
    expect(await answerText(system)).not.toContain(WARNING);
  });

  it("warns when the night's window has closed with no update, in every tool", async () => {
    const system = await start(options);
    system.clock.set("2025-01-18T14:00:00Z"); // 6:00 am Saturday
    for (const tool of ["session_overview", "search", "get_measure"]) {
      const text = await answerText(system, tool);
      expect(text, tool).toContain(WARNING);
      expect(text, tool).toContain("a nightly update was missed");
      expect(text, tool).toContain("2025-01-17T14:00:00-08:00");
    }
  });

  it("does not warn once the night's increment has run", async () => {
    const system = await start(options);
    system.clock.set("2025-01-18T02:00:00Z"); // 6:00 pm Friday
    await system.incrementAgain();

    system.clock.set("2025-01-18T14:00:00Z"); // 6:00 am Saturday
    expect(await answerText(system)).not.toContain(WARNING);
    // And the next night missed is a warning again.
    system.clock.set("2025-01-19T14:00:00Z"); // 6:00 am Sunday
    expect(await answerText(system)).toContain(WARNING);
  });
});

describe("off: the last full pull is older than its last scheduled run", () => {
  // Weekly full pulls run in the small hours of Sunday. The pull is on Sunday 2025-01-12 at 7:00 am; the next is
  // scheduled for the night that ends on Sunday 2025-01-19 (5 pm Saturday to 6 am Sunday).
  const options: SystemOptions = { clockAt: "2025-01-12T15:00:00Z", ingest: { increments: "off", fullPull: "weekly" } };

  it("does not warn for days after the pull, however many", async () => {
    const system = await start(options);
    system.clock.set("2025-01-15T20:00:00Z"); // Wednesday 12:00 pm, a meeting-less week or not
    expect(await answerText(system)).not.toContain(WARNING);
    system.clock.set("2025-01-19T13:59:00Z"); // 5:59 am the next Sunday: the window is still open
    expect(await answerText(system)).not.toContain(WARNING);
  });

  it("warns when the scheduled full pull did not happen, in every tool", async () => {
    const system = await start(options);
    system.clock.set("2025-01-19T14:00:00Z"); // 6:00 am the next Sunday
    for (const tool of ["session_overview", "search", "get_measure"]) {
      const text = await answerText(system, tool);
      expect(text, tool).toContain(WARNING);
      expect(text, tool).toContain("a scheduled full pull was missed");
      expect(text, tool).toContain("2025-01-12T07:00:00-08:00");
    }
  });

  it("does not warn once the full pull has run", async () => {
    const system = await start(options);
    system.clock.set("2025-01-19T11:00:00Z"); // 3:00 am Sunday
    await system.pullAgain();

    system.clock.set("2025-01-19T15:00:00Z"); // 7:00 am
    expect(await answerText(system)).not.toContain(WARNING);
  });

  it("is not cleared by an increment, which is not a full pull", async () => {
    const system = await start(options);
    system.clock.set("2025-01-19T11:00:00Z");
    await system.incrementAgain();

    system.clock.set("2025-01-19T15:00:00Z");
    expect(await answerText(system)).toContain(WARNING);
  });
});
