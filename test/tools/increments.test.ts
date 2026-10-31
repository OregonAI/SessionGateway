// Seam 1 (test/CLAUDE.md): an increment (ticket #17, ADR-0005, ADR-0039), as an agent sees it through the tools. The
// worker pulls the Session in full, the clock moves, rows appear in the fake OLIS, and an increment reads what
// OLIS created or modified since. Each case builds its own system, because the clock and the rows are the thing
// under test. The embedder is the fake: nothing here is about how well a meaning ranks.
//
// The real rows are HB 3131's Testimony: 117165 (Oregon Climate and Agriculture Network, created 2025-01-17
// 15:16:44, modified 15:20:18 Pacific; the only one whose text holds "riparian planting and cover cropping") and
// 117166 and 117167 (American Farmland Trust and the Oregon Association of Conservation Districts, created at 16:17
// and 17:00 the same day; feed/CommitteePublicTestimonies.json).
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

const started: System[] = [];

vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 2025-01-17 14:00 and 18:00 in Oregon, which was on UTC-8: before and after the three letters were created.
const beforeTheLetters = "2025-01-17T22:00:00Z";
const afterTheLetters = "2025-01-18T02:00:00Z";

const letter = "testimony-2025r1-117165";

async function start(clockAt: string = beforeTheLetters): Promise<System> {
  const system = await startSystem({ clockAt, documents: true });
  started.push(system);
  return system;
}

/** The ids of the hits for words only 117165 holds, in HB 3131's scope. */
async function idsFound(system: System, era: Era): Promise<string[]> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "search", {
      query: "riparian planting and cover cropping",
      measure: "HB 3131",
    });
    expect(outcome.isError).toBe(false);
    return (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);
  } finally {
    await connected.close();
  }
}

async function everyClient(check: (era: Era) => Promise<void>): Promise<void> {
  for (const era of eras) await check(era);
}

describe("an increment", () => {
  it("finds a document that was absent from search, once the clock has moved and an increment has run", async () => {
    const system = await start();
    await everyClient(async (era) => {
      expect(await idsFound(system, era)).not.toContain(letter);
    });

    system.clock.set(afterTheLetters);
    await system.incrementAgain();

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);
    });
  });
});
