// Seam 1 (test/CLAUDE.md): the two-pull rule (ADR-0005, ADR-0030) on a Floor Letter (ticket #64, ADR-0045). The 2025R1
// fixture holds no FloorLetters file, so the fake OLIS is given one MADE UP row on SB 69 and its MADE UP PDF
// (test/support/floor-letters.ts); `stopListing` then moves the row to another Session, which is how a test makes OLIS
// stop listing a row. The case builds its own system, because the pulls are the subject. The fixture's own documents are
// off; the made-up file is served all the same. The embedder is the fake: nothing here is about how well a meaning ranks.
import { afterEach, describe, expect, it } from "vitest";
import { withFloorLetters, type MadeUpFloorLetter } from "../support/floor-letters.ts";
import { callTool, connectClient, eras } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// MADE UP: a letter to the Senate on SB 69, with words no fixture document holds.
const letter: MadeUpFloorLetter = {
  floorLetterId: 900001,
  measure: { prefix: "SB", number: 69 },
  letterDate: "2025-03-04T00:00:00",
  chamber: "S",
  title: "Made-up letter on SB 69",
  description: "Made-up letter of support",
  lines: ["A made-up letter about the marmot census of Senate Bill 69."],
};
const id = "floor-letter-2025r1-900001";

/** What every client sees of the letter: get_document's flag and time, get_measure's item, and search's hits. */
async function seen(system: System) {
  const views = [];
  for (const era of eras) {
    const connected = await connectClient(era, system.handler);
    try {
      const document = await callTool(connected, "get_document", { id });
      expect(document.isError, document.text).toBe(false);
      const measure = await callTool(connected, "get_measure", { measure: "SB 69" });
      expect(measure.isError, measure.text).toBe(false);
      const search = await callTool(connected, "search", { query: "marmot census", kind: "floor_letter" });
      expect(search.isError, search.text).toBe(false);
      views.push({
        noLongerListed: document.structured?.["no_longer_listed"],
        lastListedAt: document.structured?.["last_listed_at"],
        item: (measure.structured?.["floor_letters"] as Record<string, unknown>[])[0],
        found: (search.structured?.["results"] as { id: string }[]).map((hit) => hit.id),
      });
    } finally {
      await connected.close();
    }
  }
  expect(views[1]).toEqual(views[0]);
  return views[0];
}

describe("a Floor Letter the feed stops listing", () => {
  it("is flagged no_longer_listed after two complete full pulls in a row miss it, and stays served by get_document", async () => {
    // 2025-07-15, -16 and -17 at 10:00 in Oregon.
    const system = await startSystem({ clockAt: "2025-07-15T17:00:00Z", olis: withFloorLetters([letter]) });
    started.push(system);
    expect(await seen(system)).toMatchObject({ noLongerListed: false, found: [id] });

    stopListing(system.olis, "FloorLetters", (row) => row["FloorLetterId"] === letter.floorLetterId);
    system.clock.set("2025-07-16T17:00:00Z");
    await system.pullAgain();
    // One missing pull is not a withdrawal.
    const afterOne = await seen(system);
    expect(afterOne).toMatchObject({ noLongerListed: false, lastListedAt: "2025-07-15T10:00:00-07:00", found: [id] });
    expect(afterOne?.item).not.toHaveProperty("no_longer_listed");

    system.clock.set("2025-07-17T17:00:00Z");
    await system.pullAgain();
    const afterTwo = await seen(system);
    expect(afterTwo).toMatchObject({ noLongerListed: true, lastListedAt: "2025-07-15T10:00:00-07:00" });
    expect(afterTwo?.item).toMatchObject({ id, no_longer_listed: true });
    expect(afterTwo?.found).not.toContain(id);
  });
});
