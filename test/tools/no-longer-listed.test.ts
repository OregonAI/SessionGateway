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
import { listAgain, stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];

// A case that serves the documents extracts the early Session's few files in each pull of a system of its own.
vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 17:00, 18:00, 19:00 and 20:00 on 2025-01-17 in Oregon, which was on UTC-8: pulls an hour apart, so that each
// has an as-of time of its own. Testimony 117165 was created at 15:16 that day, before the first.
const firstPull = "2025-01-18T01:00:00Z";
const secondPull = "2025-01-18T02:00:00Z";
const thirdPull = "2025-01-18T03:00:00Z";
const fourthPull = "2025-01-18T04:00:00Z";

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

/** Runs a complete full pull at `at`, as the worker does on a night. */
async function pullAt(system: System, at: string): Promise<void> {
  system.clock.set(at);
  await system.pullAgain();
}

describe.for(eras)("a row two complete pulls in a row do not list, for a %s client", (era) => {
  it("leaves search but is still fetched by id, flagged and dated by the last pull that listed it", async () => {
    const system = await start();
    expect(await idsFound(system, era)).toContain(letter);

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);
    await pullAt(system, thirdPull);

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

  // One missing pull is not a withdrawal (ADR-0005): the row is searchable, get_document does not flag it, and the
  // time it was last listed is the first pull's, since the second pull did not list it.
  it("stays searchable, and unflagged, after one complete pull misses it", async () => {
    const system = await start();

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);

    expect(await idsFound(system, era)).toContain(letter);
    const document = await getDocument(system, era, letter);
    expect(document.structured).toMatchObject({
      id: letter,
      no_longer_listed: false,
      last_listed_at: "2025-01-17T17:00:00-08:00",
      as_of: "2025-01-17T18:00:00-08:00",
    });
  });

  // "In a row": a pull that lists the row ends the count of pulls that missed it.
  it("stays searchable when the two pulls that missed it were not in a row", async () => {
    const system = await start();

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);
    listAgain(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, thirdPull);
    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, fourthPull);

    expect(await idsFound(system, era)).toContain(letter);
    const document = await getDocument(system, era, letter);
    expect(document.structured).toMatchObject({
      no_longer_listed: false,
      last_listed_at: "2025-01-17T19:00:00-08:00",
      as_of: "2025-01-17T20:00:00-08:00",
    });
  });

  it("is listed again when a complete pull lists it again", async () => {
    const system = await start();
    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);
    await pullAt(system, thirdPull);
    expect(await idsFound(system, era)).not.toContain(letter);

    listAgain(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, fourthPull);

    expect(await idsFound(system, era)).toContain(letter);
    const document = await getDocument(system, era, letter);
    expect(document.structured).toMatchObject({
      no_longer_listed: false,
      last_listed_at: "2025-01-17T20:00:00-08:00",
      as_of: "2025-01-17T20:00:00-08:00",
    });
  });

  // The server holds the vectors in memory and reads them again when the index's as-of time or its generation moves
  // (ADR-0025). Three pulls at one instant share an as-of time, so only the generation can tell the server that a
  // document left the meaning side, and that it came back. The fake embedder puts every document of HB 3131 on the
  // meaning side of this query, so a hit that is found by "embedding" is a vector the server still holds.
  it("leaves the meaning side, and returns to it, though the pulls share an as-of time", async () => {
    const system = await start();
    const foundBy = async (): Promise<string[] | undefined> => {
      const connected = await connectClient(era, system.handler);
      try {
        const outcome = await callTool(connected, "search", {
          query: "riparian planting and cover cropping",
          measure: "HB 3131",
        });
        const hits = outcome.structured?.["results"] as { id: string; found_by: string[] }[];
        return hits.find((hit) => hit.id === letter)?.found_by;
      } finally {
        await connected.close();
      }
    };
    expect(await foundBy()).toEqual(["keyword", "embedding"]);

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await system.pullAgain();
    await system.pullAgain();
    expect(await foundBy()).toBeUndefined();

    listAgain(system.olis, "CommitteePublicTestimonies", isLetter);
    await system.pullAgain();
    expect(await foundBy()).toEqual(["keyword", "embedding"]);
  });
});

// A pull that is short of the feed's counts is refused whole (full-pull-report.test.ts): it is not a pull that missed
// the row, and it is not one that listed it. `withholdLastRows(1)` is a feed that counted its rows and paged one
// fewer of each set, so the last Testimony row of the early Session, 117166 (American Farmland Trust's letter,
// created 16:17), is the one it leaves out.
describe.for(eras)("a pull that is short of the feed's counts, for a %s client", (era) => {
  const otherLetter = "testimony-2025r1-117166";
  const incomplete = /counted \d+.*read \d+/;

  async function otherLetterFound(system: System): Promise<boolean> {
    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "search", {
        query: "Natural Resources Conservation Service",
        measure: "HB 3131",
      });
      return (outcome.structured?.["results"] as { id: string }[]).some((hit) => hit.id === otherLetter);
    } finally {
      await connected.close();
    }
  }

  it("removes nothing, however many of them there are in a row", async () => {
    const system = await start();
    expect(await otherLetterFound(system)).toBe(true);

    system.olis.withholdLastRows(1);
    system.clock.set(secondPull);
    await expect(system.pullAgain()).rejects.toThrow(incomplete);
    system.clock.set(thirdPull);
    await expect(system.pullAgain()).rejects.toThrow(incomplete);
    system.olis.withholdLastRows(0);

    expect(await otherLetterFound(system)).toBe(true);
    const document = await getDocument(system, era, otherLetter);
    expect(document.structured).toMatchObject({
      no_longer_listed: false,
      last_listed_at: "2025-01-17T17:00:00-08:00",
      as_of: "2025-01-17T17:00:00-08:00",
    });
  });

  // The refused pull is neither a pull that missed the row nor one that listed it: between the two complete pulls
  // that missed 117165 it counts for nothing, and the second of them is still "two in a row" among complete pulls.
  it("is not one of the two pulls that must miss a row in a row", async () => {
    const system = await start();
    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);

    system.olis.withholdLastRows(1);
    system.clock.set(thirdPull);
    await expect(system.pullAgain()).rejects.toThrow(incomplete);
    system.olis.withholdLastRows(0);
    expect(await idsFound(system, era)).toContain(letter);

    await pullAt(system, fourthPull);

    expect(await idsFound(system, era)).not.toContain(letter);
    const document = await getDocument(system, era, letter);
    expect(document.structured).toMatchObject({
      no_longer_listed: true,
      last_listed_at: "2025-01-17T17:00:00-08:00",
      as_of: "2025-01-17T20:00:00-08:00",
    });
  });
});
