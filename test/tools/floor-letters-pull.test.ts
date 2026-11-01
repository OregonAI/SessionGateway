// Seam 1 (test/CLAUDE.md): how an increment picks up a Floor Letter (ticket #64, ADR-0005, ADR-0045). FloorLetters carry
// no created or modified time, so an increment asks OLIS for the ids above the highest one the index holds, and fetches
// each new letter's file once, in the increment. The 2025R1 fixture holds no FloorLetters file, so the fake OLIS is given
// MADE UP rows and PDFs (test/support/floor-letters.ts): one there at the pull, and one added after it. Each case builds
// its own system, because the increment is the subject. The fixture's own documents are off; the made-up files are served
// all the same. The embedder is the fake: nothing here is about how well a meaning ranks.
import { afterEach, describe, expect, it } from "vitest";
import {
  floorLetterPath,
  madeUpFloorLetterPdf,
  madeUpFloorLetterRow,
  withFloorLetters,
  type MadeUpFloorLetter,
} from "../support/floor-letters.ts";
import { callTool, connectClient, eras } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 2025-07-15 10:00 in Oregon, and an hour later: after every row of the fixture was created.
const clockAt = "2025-07-15T17:00:00Z";
const anHourLater = "2025-07-15T18:00:00Z";

// MADE UP: a letter there at the full pull.
const held: MadeUpFloorLetter = {
  floorLetterId: 900001,
  measure: { prefix: "SB", number: 69 },
  letterDate: "2025-03-04T00:00:00",
  chamber: "S",
  title: "Made-up letter on SB 69",
  description: "Made-up letter of support",
  lines: ["Made-up floor letter in support of Senate Bill 69."],
};
// MADE UP: a letter OLIS adds after the pull, with a higher FloorLetterId and words no other document holds.
const added: MadeUpFloorLetter = {
  floorLetterId: 900007,
  measure: null,
  letterDate: "2025-07-15T00:00:00",
  chamber: "H",
  title: "Made-up tidepool letter",
  description: "Made-up letter",
  lines: ["A made-up letter from the guild of tidepool cartographers."],
};

async function start(): Promise<System> {
  // The added letter's file is served from the start; its row only once the test adds it.
  const olis = withFloorLetters([held]);
  const system = await startSystem({
    clockAt,
    olis: {
      ...olis,
      madeUpDocuments: { ...olis.madeUpDocuments, [floorLetterPath(added.floorLetterId)]: madeUpFloorLetterPdf(added) },
    },
  });
  started.push(system);
  return system;
}

/** The ids of the floor letters search finds for the added letter's words. */
async function lettersFound(system: System): Promise<string[]> {
  const ids: string[][] = [];
  for (const era of eras) {
    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "search", { query: "tidepool cartographers", kind: "floor_letter" });
      expect(outcome.isError, outcome.text).toBe(false);
      ids.push((outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id));
    } finally {
      await connected.close();
    }
  }
  expect(ids[1]).toEqual(ids[0]);
  return ids[0] ?? [];
}

const timesFetched = (system: System, letter: MadeUpFloorLetter): number =>
  system.olis.documentRequests().filter((path) => path === floorLetterPath(letter.floorLetterId)).length;

describe("an increment and the FloorLetters set", () => {
  it("finds a letter added after the pull with a higher FloorLetterId, asking only for ids above the highest held and fetching its file once", async () => {
    const system = await start();
    expect(await lettersFound(system)).not.toContain("floor-letter-2025r1-900007");
    expect(timesFetched(system, held)).toBe(1);

    system.olis.addRows("FloorLetters", [madeUpFloorLetterRow(added)]);
    system.olis.forgetRequests();
    system.clock.set(anHourLater);
    await system.incrementAgain();

    const letterReads = system.olis.requests().filter((request) => request.entitySet === "FloorLetters");
    expect(letterReads.length).toBeGreaterThan(0);
    for (const request of letterReads) {
      expect(request.filter).toBe("SessionKey eq '2025R1' and FloorLetterId gt 900001");
    }
    expect(timesFetched(system, added)).toBe(1);
    expect(timesFetched(system, held)).toBe(1);
    expect((await lettersFound(system))[0]).toBe("floor-letter-2025r1-900007");

    // The next increment asks for the ids above the letter it has just picked up, and fetches nothing again.
    system.olis.forgetRequests();
    system.clock.set("2025-07-15T18:15:00Z");
    await system.incrementAgain();
    const nextReads = system.olis.requests().filter((request) => request.entitySet === "FloorLetters");
    for (const request of nextReads) {
      expect(request.filter).toBe("SessionKey eq '2025R1' and FloorLetterId gt 900007");
    }
    expect(timesFetched(system, added)).toBe(1);
  });
});
