// Seam 1 (test/CLAUDE.md): the two-pull rule of ADR-0005, as an agent sees it through `search` and `get_document`.
// A row that two complete full pulls in a row did not list is no longer listed: it leaves search results and
// stays fetchable by id (spec #1, story 47). Each case builds its own system, because the pulls and what the fake
// OLIS lists at each are the thing under test.
//
// The row is a real one: HB 3131's Testimony 117165 (Oregon Climate and Agriculture Network, a letter created
// 2025-01-17 15:16 Pacific; feed/CommitteePublicTestimonies.json). The fake OLIS stops listing it with
// `stopListing` (test/support/unlisted-rows.ts), which changes the row the way OLIS would have, from the pull
// after. The embedder is the fake: nothing here is about how well a meaning ranks.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];

// A case that serves the documents extracts the early Session's few files in each pull of a system of its own.
vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 17:00, 18:00 and 19:00 on 2025-01-17 in Oregon, which was on UTC-8: three nightly pulls an hour apart, so that
// each pull has an as-of time of its own. Testimony 117165 was created at 15:16 that day, before the first.
const firstPull = "2025-01-18T01:00:00Z";
const secondPull = "2025-01-18T02:00:00Z";
const thirdPull = "2025-01-18T03:00:00Z";

const letter = "testimony-2025r1-117165";
const isLetter = (row: Record<string, unknown>): boolean => row["CommTestId"] === 117165;

async function start(): Promise<System> {
  const system = await startSystem({ clockAt: firstPull, documents: true });
  started.push(system);
  return system;
}

/** The ids of the hits for words only 117165 holds ("riparian planting and cover cropping"), in HB 3131's scope. */
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

async function getDocument(system: System, era: Era, id: string) {
  const connected = await connectClient(era, system.handler);
  try {
    return await callTool(connected, "get_document", { id });
  } finally {
    await connected.close();
  }
}

describe.for(eras)("a row two complete pulls in a row do not list, for a %s client", (era) => {
  it("leaves search but is still fetched by id, flagged and dated by the last pull that listed it", async () => {
    const system = await start();
    expect(await idsFound(system, era)).toContain(letter);

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    system.clock.set(secondPull);
    await system.pullAgain();
    system.clock.set(thirdPull);
    await system.pullAgain();

    expect(await idsFound(system, era)).not.toContain(letter);
    const document = await getDocument(system, era, letter);
    expect(document.isError).toBe(false);
    expect(document.structured).toMatchObject({
      id: letter,
      has_text_layer: true,
      no_longer_listed: true,
      last_listed_at: "2025-01-17T17:00:00-08:00",
      as_of: "2025-01-17T19:00:00-08:00",
    });
    expect(document.structured?.["text"]).toContain("riparian planting and cover cropping");
  });
});
