// Seam 1 (test/CLAUDE.md): Floor Letters as an agent sees them through `get_document`, `get_measure` and `search`
// (ticket #64, ADR-0045). The 2025R1 fixture holds no FloorLetters file, so the fake OLIS is given three MADE UP rows and
// their MADE UP PDFs (`withFloorLetters`, test/support/floor-letters.ts): a letter on SB 69, a petition that names no
// Measure, and a scan with no text layer. Every case only reads, so they share one database: a copy of the run's template
// for these options (test/CLAUDE.md, Database, Templates). The fixture's own documents are off; the made-up files are
// served all the same. The embedder is the fake: nothing here is about how well a meaning ranks.
import { describe, expect, it } from "vitest";
import { floorLetterSourceUrl, withFloorLetters, type MadeUpFloorLetter } from "../support/floor-letters.ts";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { systemTemplate } from "../support/system.ts";

// 2025-07-15 10:00 in Oregon: after every row of the fixture was created but eight (two history actions, three Witness Registration lists and three Recording Logs), so SB 69 is in the index.
const clockAt = "2025-07-15T17:00:00Z";

// MADE UP: a letter to the Senate on SB 69.
const onSb69: MadeUpFloorLetter = {
  floorLetterId: 900001,
  measure: { prefix: "SB", number: 69 },
  letterDate: "2025-03-04T00:00:00",
  chamber: "S",
  title: "Made-up letter on SB 69",
  description: "Made-up letter of support",
  lines: ["Made-up floor letter in support of Senate Bill 69."],
};
// MADE UP: a petition to the House that names no Measure, with words no fixture document holds.
const petition: MadeUpFloorLetter = {
  floorLetterId: 900002,
  measure: null,
  letterDate: "2025-03-05T00:00:00",
  chamber: "H",
  title: "Made-up lighthouse petition",
  description: "Made-up petition",
  lines: ["A made-up petition about lighthouse keepers and their quahog chowder."],
};
// MADE UP: a scan, whose PDF is one page with no text on it.
const scan: MadeUpFloorLetter = {
  floorLetterId: 900003,
  measure: { prefix: "SB", number: 69 },
  letterDate: "2025-03-06T00:00:00",
  chamber: "S",
  title: "Made-up scanned letter",
  description: "Made-up scan",
  lines: [],
};

const template = systemTemplate({ clockAt, olis: withFloorLetters([onSb69, petition, scan]) });

async function call(era: Era, tool: string, args: Record<string, unknown>) {
  const system = await template.start();
  try {
    const connected = await connectClient(era, system.handler);
    try {
      return await callTool(connected, tool, args);
    } finally {
      await connected.close();
    }
  } finally {
    await system.stop();
  }
}

describe.for(eras)("Floor Letters, for a %s client", (era) => {
  it("serves a letter on a Measure as a document with its text, source_url, retrieval time, Chamber, LetterDate and title", async () => {
    const outcome = await call(era, "get_document", { id: "floor-letter-2025r1-900001" });

    expect(outcome.isError, outcome.text).toBe(false);
    expect(outcome.structured).toMatchObject({
      id: "floor-letter-2025r1-900001",
      kind: "floor_letter",
      source_url: floorLetterSourceUrl(900001),
      retrieved_at: "2025-07-15T10:00:00-07:00",
      has_text_layer: true,
      floor_letter: {
        floor_letter_id: 900001,
        chamber: "senate",
        letter_date: "2025-03-04T00:00:00-08:00",
        title: "Made-up letter on SB 69",
        description: "Made-up letter of support",
      },
      no_longer_listed: false,
    });
    expect(outcome.structured?.["text"]).toContain("Made-up floor letter in support of Senate Bill 69.");
    expect(outcome.structured?.["related"]).toEqual([
      { id: "measure-2025r1-sb69", relation: "measure", meaning: null, document_id: null },
    ]);
  });

  it("lists the letters that name a Measure under get_measure, and not the one that names none", async () => {
    const outcome = await call(era, "get_measure", { measure: "SB 69" });

    expect(outcome.isError, outcome.text).toBe(false);
    expect(outcome.structured?.["floor_letters"]).toEqual([
      {
        id: "floor-letter-2025r1-900001",
        source_url: floorLetterSourceUrl(900001),
        chamber: "senate",
        letter_date: "2025-03-04T00:00:00-08:00",
        title: "Made-up letter on SB 69",
        description: "Made-up letter of support",
        fetched: true,
        has_text_layer: true,
      },
      {
        id: "floor-letter-2025r1-900003",
        source_url: floorLetterSourceUrl(900003),
        chamber: "senate",
        letter_date: "2025-03-06T00:00:00-08:00",
        title: "Made-up scanned letter",
        description: "Made-up scan",
        fetched: true,
        has_text_layer: false,
      },
    ]);
  });

  it("finds a letter that names no Measure under the floor_letter kind, and get_document serves it", async () => {
    const found = await call(era, "search", { query: "lighthouse keepers quahog chowder", kind: "floor_letter" });

    expect(found.isError, found.text).toBe(false);
    // The fake embedder's meaning side ranks every letter, so the petition, the only one with the words, comes first.
    const results = found.structured?.["results"] as { id: string; kind: string }[];
    expect(results[0]?.id).toBe("floor-letter-2025r1-900002");
    expect(results.every((hit) => hit.kind === "floor_letter")).toBe(true);

    const served = await call(era, "get_document", { id: "floor-letter-2025r1-900002" });
    expect(served.isError, served.text).toBe(false);
    expect(served.structured).toMatchObject({
      kind: "floor_letter",
      source_url: floorLetterSourceUrl(900002),
      floor_letter: {
        chamber: "house",
        letter_date: "2025-03-05T00:00:00-08:00",
        title: "Made-up lighthouse petition",
      },
      related: [],
    });
    expect(served.structured?.["text"]).toContain("lighthouse keepers");
  });

  it("flags a letter whose PDF has no text layer", async () => {
    const outcome = await call(era, "get_document", { id: "floor-letter-2025r1-900003" });

    expect(outcome.isError, outcome.text).toBe(false);
    expect(outcome.structured).toMatchObject({ kind: "floor_letter", has_text_layer: false });
    expect((outcome.structured?.["text"] as string).trim()).toBe("");
  });
});
