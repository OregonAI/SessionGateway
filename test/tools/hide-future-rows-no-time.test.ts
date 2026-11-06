// Seam 1 (test/CLAUDE.md): a row the feed gives no CreatedDate is shown at every clock (ticket #153, ADR-0056, "A row with no
// creation time is shown"). FloorLetters is the set that has none: checked on 2026-11-05 in the 2025R1 cache
// (.cache/olis-2025R1/feed/FloorLetters.json, 322 rows: LetterDate, no CreatedDate, no ModifiedDate). The fixture holds no
// FloorLetters file, so the letters are the MADE UP ones of test/support/floor-letters.ts. The worker pulls them at a clock
// after every row, then the one clock is moved back to a moment before the letter's own LetterDate (2025-03-04), when the
// Measure it names exists (SB 69 was created 2024-12-31): the letter is still there, in get_measure and in search.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withFloorLetters, type MadeUpFloorLetter } from "../support/floor-letters.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

// MADE UP: a letter on SB 69 and a petition that names no Measure.
const onSb69: MadeUpFloorLetter = {
  floorLetterId: 900001,
  measure: { prefix: "SB", number: 69 },
  letterDate: "2025-03-04T00:00:00",
  chamber: "S",
  title: "Made-up letter on SB 69",
  description: "Made-up letter of support",
  lines: ["Made-up floor letter in support of Senate Bill 69."],
};
const petition: MadeUpFloorLetter = {
  floorLetterId: 900002,
  measure: null,
  letterDate: "2025-03-05T00:00:00",
  chamber: "H",
  title: "Made-up lighthouse petition",
  description: "Made-up petition",
  lines: ["A made-up petition about lighthouse keepers and their quahog chowder."],
};

let system: System;
let connected: ConnectedClient;

beforeAll(async () => {
  system = await startCopiedSystem({
    clockAt: "2026-08-05T17:00:00Z",
    documents: true,
    olis: withFloorLetters([onSb69, petition]),
  });
  connected = await connectClient(eras[0] ?? "legacy", system.handler);
}, 60_000);

afterAll(async () => {
  await connected.close();
  await system.stop();
});

describe("a Floor Letter, whose feed row has no CreatedDate", () => {
  it("is in get_measure and in search at a clock before its LetterDate", async () => {
    system.clock.set("2025-01-02T09:00:00-08:00");

    const measure = await callTool(connected, "get_measure", { measure: "SB 69" });
    expect(measure.isError, measure.text).toBe(false);
    expect((measure.structured?.["floor_letters"] as { id: string }[]).map((letter) => letter.id)).toEqual([
      "floor-letter-2025r1-900001",
    ]);

    const found = await callTool(connected, "search", {
      query: "lighthouse keepers quahog chowder",
      kind: "floor_letter",
    });
    expect(found.isError, found.text).toBe(false);
    expect((found.structured?.["results"] as { id: string }[])[0]?.id).toBe("floor-letter-2025r1-900002");

    const served = await callTool(connected, "get_document", { id: "floor-letter-2025r1-900002" });
    expect(served.isError, served.text).toBe(false);
  });
});
