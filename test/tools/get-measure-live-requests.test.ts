// Seam 1: what the live lookup asks OLIS. ADR-0005 allows on-demand queries, and the terms of use reserve
// the right to suspend a client that significantly affects OLIS's performance, so a get_measure call asks
// for the one Measure's rows and nothing else (ticket #21: "must not multiply requests"). The fake OLIS
// logs each request it receives, and the cases read the log after a call. Each case builds its own system
// because it clears the log and, in two cases, sets the rate limit.
//
// Expected values are literals: the filters are OData v3 (docs/research/olis-odata.md section 1 verified
// `eq`, `ge`, `and` and `datetime'...'`), the five entity sets are the ones the live block's five kinds of
// value come from, and the time is the clock's, 2025-04-26 10:00 in Oregon.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

/** Pulls the cache on 2025-04-10, moves the clock to 2025-04-26 10:00 and forgets the requests the pull made. */
async function systemAfterThePull(serverEnv?: SystemOptions["serverEnv"]): Promise<System> {
  const system = await startSystem({
    clockAt: "2025-04-10T17:00:00Z",
    ...(serverEnv === undefined ? {} : { serverEnv }),
  });
  started.push(system);
  system.clock.set("2025-04-26T17:00:00Z");
  system.olis.forgetRequests();
  return system;
}

describe("the requests of one get_measure call", () => {
  // Five requests, one for each kind of value in the block, none of them a count: the first page's
  // `$inlinecount` is the count (one Measure's rows fit a page: docs/research/olis-live.md §1 has the most
  // any Measure has in any of these sets, against the page's 5,000).
  //   Measures                Measure.CurrentLocation, the location
  //   MeasureHistoryActions   the history
  //   MeasureVotes            the floor votes
  //   CommitteeVotes          the committee votes
  //   CommitteeAgendaItems    the schedule, only the meetings at or after the time of the read
  it.for([
    ["SB 69", "SB", "69"],
    ["HB 3795", "HB", "3795"],
  ] as const)("asks OLIS five questions about %s and about nothing else", async ([citation, prefix, number]) => {
    const system = await systemAfterThePull();
    const connected = await connectClient("2026-07-28", system.handler);

    const outcome = await callTool(connected, "get_measure", { measure: citation });
    await connected.close();

    expect(outcome.isError).toBe(false);
    const measureFilter = `SessionKey eq '2025R1' and MeasurePrefix eq '${prefix}' and MeasureNumber eq ${number}`;
    // The five run together, so they arrive in no fixed order: they are compared sorted by name.
    const requests = system.olis.requests().toSorted((a, b) => (a.entitySet < b.entitySet ? -1 : 1));
    expect(requests).toEqual([
      {
        entitySet: "CommitteeAgendaItems",
        isCount: false,
        filter: `${measureFilter} and MeetingDate ge datetime'2025-04-26T10:00:00'`,
      },
      { entitySet: "CommitteeVotes", isCount: false, filter: measureFilter },
      { entitySet: "MeasureHistoryActions", isCount: false, filter: measureFilter },
      { entitySet: "MeasureVotes", isCount: false, filter: measureFilter },
      { entitySet: "Measures", isCount: false, filter: measureFilter },
    ]);
  });

  it("asks nothing about a Measure the index does not have", async () => {
    const system = await systemAfterThePull();
    const connected = await connectClient("2026-07-28", system.handler);

    const outcome = await callTool(connected, "get_measure", { measure: "SB 9999" });
    await connected.close();

    expect(outcome.isError).toBe(true);
    expect(system.olis.requests()).toEqual([]);
  });

  it("asks nothing for a call the rate limit refuses", async () => {
    const system = await systemAfterThePull({ MCP_RATE_LIMIT: "1", MCP_RATE_WINDOW_SECONDS: "60" });
    const connected = await connectClient("2026-07-28", system.handler);
    await callTool(connected, "get_measure", { measure: "SB 69" });
    expect(system.olis.requests()).toHaveLength(5);
    system.olis.forgetRequests();

    const refused = await callTool(connected, "get_measure", { measure: "SB 69" });
    await connected.close();

    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/rate limit/i);
    expect(system.olis.requests()).toEqual([]);
  });

  it("asks five questions for each call, so a window's worth of calls is at most five times the limit", async () => {
    const system = await systemAfterThePull({ MCP_RATE_LIMIT: "3", MCP_RATE_WINDOW_SECONDS: "60" });
    const connected = await connectClient("2026-07-28", system.handler);

    const answers = [];
    for (let call = 0; call < 5; call += 1)
      answers.push(await callTool(connected, "get_measure", { measure: "SB 69" }));
    await connected.close();

    expect(answers.map((answer) => answer.isError)).toEqual([false, false, false, true, true]);
    expect(system.olis.requests()).toHaveLength(15);
  });

  // The limiter is a fixed window that opens with its first call (mcp-server/lib/rate-limit.ts), so a burst
  // can straddle a boundary: with a limit of 3, the first call opened the window a minute ago, two more
  // are answered in its last second, and three in the first second of the next window. Those five calls
  // within one second of the clock ask 5 x 5 = 25 questions, not the 15 of a window's worth.
  it("asks 25 questions for the 5 calls a limit of 3 lets through in the second around a window boundary", async () => {
    const system = await systemAfterThePull({ MCP_RATE_LIMIT: "3", MCP_RATE_WINDOW_SECONDS: "60" });
    const connected = await connectClient("2026-07-28", system.handler);
    const call = (): ReturnType<typeof callTool> => callTool(connected, "get_measure", { measure: "SB 69" });
    expect((await call()).isError).toBe(false);
    system.olis.forgetRequests();

    system.clock.advance(59_000);
    const endOfTheFirstWindow = [await call(), await call(), await call()];
    system.clock.advance(1_000);
    const startOfTheSecond = [await call(), await call(), await call(), await call()];
    await connected.close();

    expect(endOfTheFirstWindow.map((answer) => answer.isError)).toEqual([false, false, true]);
    expect(startOfTheSecond.map((answer) => answer.isError)).toEqual([false, false, false, true]);
    expect(system.olis.requests()).toHaveLength(25);
  });
});
