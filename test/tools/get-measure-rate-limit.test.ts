// Seam 1: the MCP specification says a server must rate-limit tool calls, so the server limits them by
// default and the limit is set from the environment (src/CLAUDE.md, "MCP"). The limit counts tool calls
// only, over every caller together, in the injected clock's time. Each case builds its own system
// because the limit and the clock are what is under test.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient, type Era } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];
const connections: ConnectedClient[] = [];

afterEach(async () => {
  for (const connected of connections.splice(0)) await connected.close();
  for (const system of started.splice(0)) await system.stop();
});

async function connect(
  era: Era,
  serverEnv: SystemOptions["serverEnv"],
): Promise<{ system: System; agent: ConnectedClient }> {
  const system = await startSystem({
    clockAt: "2025-01-29T17:00:00Z",
    ...(serverEnv === undefined ? {} : { serverEnv }),
  });
  started.push(system);
  // connectClient calls listTools() first: that, and the handshake, are not tool calls and do not count.
  const agent = await connectClient(era, system.handler);
  connections.push(agent);
  return { system, agent };
}

describe.for(eras)("the tool-call rate limit for a %s client", (era) => {
  it("answers calls up to the limit, then tells the agent when to try again", async () => {
    const { agent } = await connect(era, { MCP_RATE_LIMIT: "3", MCP_RATE_WINDOW_SECONDS: "60" });

    const answers = [];
    for (let call = 0; call < 3; call += 1) answers.push(await callTool(agent, "get_measure", { measure: "SB 69" }));
    const refused = await callTool(agent, "get_measure", { measure: "SB 69" });

    expect(answers.map((answer) => answer.isError)).toEqual([false, false, false]);
    expect(refused.isError).toBe(true);
    expect(refused.structured).toBeUndefined();
    expect(refused.text).toMatch(/rate limit/i);
    expect(refused.text).toContain("at most 3 tool calls every 60 seconds");
    expect(refused.text).toContain("in 60 seconds");
  });

  it("counts every tool's calls together: get_measure, session_overview and get_document share the limit", async () => {
    const { agent } = await connect(era, { MCP_RATE_LIMIT: "3", MCP_RATE_WINDOW_SECONDS: "60" });

    const measure = await callTool(agent, "get_measure", { measure: "SB 69" });
    const overview = await callTool(agent, "session_overview", {});
    // This system serves no documents, so the id is unknown: an answer, counted as a call, but not a refusal.
    const document = await callTool(agent, "get_document", { id: "version-2025r1-sb69-introduced" });
    const refusedOverview = await callTool(agent, "session_overview", {});
    const refusedDocument = await callTool(agent, "get_document", { id: "version-2025r1-sb69-introduced" });

    expect([measure.isError, overview.isError, document.isError]).toEqual([false, false, true]);
    expect(document.text).not.toMatch(/rate limit/i);
    expect(refusedOverview.isError).toBe(true);
    expect(refusedOverview.text).toMatch(/rate limit/i);
    expect(refusedDocument.text).toMatch(/rate limit/i);
  });

  it("answers again once the window has passed", async () => {
    const { system, agent } = await connect(era, { MCP_RATE_LIMIT: "2", MCP_RATE_WINDOW_SECONDS: "60" });
    await callTool(agent, "get_measure", { measure: "SB 69" });
    await callTool(agent, "get_measure", { measure: "SB 69" });
    expect((await callTool(agent, "get_measure", { measure: "SB 69" })).isError).toBe(true);

    system.clock.advance(30_000);
    const midway = await callTool(agent, "get_measure", { measure: "SB 69" });
    system.clock.advance(31_000);
    const later = await callTool(agent, "get_measure", { measure: "SB 69" });

    expect(midway.isError).toBe(true);
    expect(midway.text).toContain("in 30 seconds");
    expect(later.isError).toBe(false);
    expect(later.structured).toMatchObject({ id: "measure-2025r1-sb69" });
  });

  it("is on when nothing is configured: the 121st call within a minute is refused", async () => {
    const { agent } = await connect(era, undefined);

    let refusedAt: number | undefined;
    for (let call = 1; call <= 125 && refusedAt === undefined; call += 1) {
      const answer = await callTool(agent, "get_measure", { measure: "SB 69" });
      if (answer.isError) refusedAt = call;
    }

    expect(refusedAt).toBe(121);
  });
});
