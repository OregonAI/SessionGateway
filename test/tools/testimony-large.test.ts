// Seam 1 (test/CLAUDE.md): `testimony` on a Measure with more rows than one answer should hold. The longest in
// the 2025R1 feed is SB 210 with 14,223 Testimony rows, then HB 2025 with 4,204, and 17 Measures have more than
// 1,000 (counted over the full local cache, not the fixture). The fixture's largest, HB 3131, has 42, so the
// rows here are MADE UP: 250 rows added to SB 983, which has one real row (CommTestId 212098, oppose, Newberg), all
// served with the same file (Testimony 117165's), as a form letter sent 250 times would be. The fake OLIS serves
// them as `strayRows` and `strayDocuments`, so the worker pulls them as it would any row. One database serves
// every case in this file because none of them changes it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import { madeUpTestimonyRow, testimonyDownloadPath } from "../support/testimony.ts";

// Made-up row i (0 to 249) has CommTestId 910001 + i, and by i % 5: 0 is oppose, 1 is neutral, 2 to 4 are support.
// Its Organization is "Town " and i % 10 in two digits. So support has 150 rows in six groups of 25 (Town 02, 03,
// 04, 07, 08, 09), oppose has the 50 made-up rows in two groups (Town 00, Town 05, 25 each) and the real row's group
// "Newberg", and neutral has 50 rows in two groups (Town 01, Town 06). 251 rows in all, in 11 groups.
const first = 910_001;
const positionOf = (i: number): number => [3982, 3981, 3983, 3983, 3983][i % 5] ?? 3983;
const madeUp = Array.from({ length: 250 }, (_, i) =>
  madeUpTestimonyRow({
    commTestId: first + i,
    positionId: positionOf(i),
    organization: `Town ${String(i % 10).padStart(2, "0")}`,
  }),
);
const idOf = (commTestId: number): string => `testimony-2025r1-${commTestId}`;

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({
    clockAt: "2025-07-15T17:00:00Z",
    documents: true,
    olis: {
      strayRows: { CommitteePublicTestimonies: madeUp },
      strayDocuments: Object.fromEntries(
        madeUp.map((row) => [testimonyDownloadPath(row["CommTestId"] as number), "testimony/117165.pdf"]),
      ),
    },
  });
}, 90_000);

afterAll(async () => {
  await system.stop();
});

type Item = { id: string; same_letter_as: string | null; same_letter_count: number | null };
type Group = { organization: string | null; count: number; items: Item[] };
type Position = { position_id: number; count: number; organizations: Group[] };

/** The shape of a page, as an agent would read it: each position's groups, each with its count and its items on the page. */
function shapeOf(positions: Position[]): [number, string | null, number, number][] {
  return positions.flatMap((position) =>
    position.organizations.map((group): [number, string | null, number, number] => [
      position.position_id,
      group.organization,
      group.count,
      group.items.length,
    ]),
  );
}

describe.for(eras)("testimony on a Measure with 251 rows, for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // The order is fixed: position (support, oppose, neutral), then organization group in alphabetical order, then
  // CommTestId. 50 items to a page. Page 1 is the first 50 of support's 150 rows: Town 02 and 03, 25 each.
  it("returns the first 50 items of 251 as page 1 of 6, with the Measure's totals", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 983" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({
      measure_id: "measure-2025r1-sb983",
      total: 251,
      page: 1,
      last_page: 6,
      page_size: 50,
    });
    expect(shapeOf(outcome.structured?.["positions"] as Position[])).toEqual([
      [3983, "Town 02", 25, 25],
      [3983, "Town 03", 25, 25],
    ]);
  });

  // get_document's `page_count` is the number of pages of a PDF. The same name here would mean the number of pages of
  // results, so an agent that read both from one server would read one field two ways: the last page is `last_page`.
  it("names the number of the last page last_page, as page_count is a PDF's pages in get_document", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 983" });

    expect(outcome.structured).toHaveProperty("last_page", 6);
    expect(outcome.structured).not.toHaveProperty("page_count");
  });

  // Pages 2 and 3 finish support: Town 04 and 07, then Town 08 and 09.
  it("continues in the same order on pages 2 and 3, to the end of support", async () => {
    const second = await callTool(connected, "testimony", { measure: "SB 983", page: 2 });
    const third = await callTool(connected, "testimony", { measure: "SB 983", page: 3 });

    expect(second.structured).toMatchObject({ total: 251, page: 2, last_page: 6 });
    expect(shapeOf(second.structured?.["positions"] as Position[])).toEqual([
      [3983, "Town 04", 25, 25],
      [3983, "Town 07", 25, 25],
    ]);
    expect(shapeOf(third.structured?.["positions"] as Position[])).toEqual([
      [3983, "Town 08", 25, 25],
      [3983, "Town 09", 25, 25],
    ]);
  });

  // Page 4 is the first 50 of oppose's 51: "Newberg" (the real row), Town 00 (25) and 24 of Town 05's 25, a group that
  // runs across the page break and keeps its whole count of 25 on both pages. Oppose has 50 made-up rows and the real one.
  it("shows a group split across a page break on both pages, with its whole count", async () => {
    const fourth = await callTool(connected, "testimony", { measure: "SB 983", page: 4 });
    const fifth = await callTool(connected, "testimony", { measure: "SB 983", page: 5 });

    expect(fourth.structured).toMatchObject({ total: 251, page: 4, last_page: 6 });
    expect(shapeOf(fourth.structured?.["positions"] as Position[])).toEqual([
      [3982, "Newberg", 1, 1],
      [3982, "Town 00", 25, 25],
      [3982, "Town 05", 25, 24],
    ]);
    // Page 5: Town 05's last row, then neutral's Town 01 (25) and 24 of Town 06's 25.
    expect(shapeOf(fifth.structured?.["positions"] as Position[])).toEqual([
      [3982, "Town 05", 25, 1],
      [3981, "Town 01", 25, 25],
      [3981, "Town 06", 25, 24],
    ]);
  });

  it("ends on page 6 with the one row left, the last of neutral's Town 06", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 983", page: 6 });

    expect(outcome.structured).toMatchObject({ total: 251, page: 6, last_page: 6 });
    expect(shapeOf(outcome.structured?.["positions"] as Position[])).toEqual([[3981, "Town 06", 25, 1]]);
  });

  it("lists every row once across the six pages, in a fixed order", async () => {
    const ids: string[] = [];
    for (const page of [1, 2, 3, 4, 5, 6]) {
      const outcome = await callTool(connected, "testimony", { measure: "SB 983", page });
      for (const position of outcome.structured?.["positions"] as Position[]) {
        for (const group of position.organizations) ids.push(...group.items.map((item) => item.id));
      }
    }

    expect(ids).toHaveLength(251);
    expect(new Set(ids).size).toBe(251);
    // The first row of page 1 is the lowest CommTestId of the first group (Town 02: i = 2, 12, 22, ...), and the
    // last row of all is the highest CommTestId of the last group (neutral's Town 06: i = 6, 16, ..., 246 → i = 246).
    expect(ids[0]).toBe(idOf(first + 2));
    expect(ids[1]).toBe(idOf(first + 12));
    expect(ids.at(-1)).toBe(idOf(first + 246));
  });

  // The ticket's brief: every page carries the Measure's total, the counts by position, the number of organization
  // groups, the identical letters, and "page N of M". 11 groups: six of support, three of oppose, two of neutral.
  it("carries the totals, the counts by position, the number of groups and the identical letters on every page", async () => {
    const pages = [];
    for (const page of [1, 2, 3, 4, 5, 6]) {
      const outcome = await callTool(connected, "testimony", { measure: "SB 983", page });
      pages.push(outcome.structured);
    }

    for (const [index, structured] of pages.entries()) {
      expect(structured, `page ${index + 1}`).toMatchObject({
        total: 251,
        organization_groups: 11,
        position_counts: [
          { position_id: 3983, position: "support", count: 150 },
          { position_id: 3982, position: "oppose", count: 51 },
          { position_id: 3981, position: "neutral", count: 50 },
          { position_id: 4022, position: "unknown", count: 0 },
        ],
      });
    }
    expect(pages[0]?.["identical_letters"]).toEqual(pages[1]?.["identical_letters"]);
    expect(pages[1]?.["identical_letters"]).toEqual(pages[2]?.["identical_letters"]);
  });

  // The 250 made-up rows have one file, so they are one letter. The summary lists it once, as the id to read and the
  // count, with no list of the 250 ids and nothing left out. Every item of it, on whatever page, carries the same two
  // facts; the real row (212098) has a file of its own, and carries neither.
  it("reports a set of 250 identical letters once, as its id to read and its count, and every item of it carries both", async () => {
    for (const page of [1, 6]) {
      const outcome = await callTool(connected, "testimony", { measure: "SB 983", page });

      expect(outcome.structured?.["identical_letters"], `page ${page}`).toEqual([
        { id_to_read: idOf(first), count: 250 },
      ]);
      expect(outcome.structured, `page ${page}`).toMatchObject({ identical_letters_left_out: 0 });
      const items = (outcome.structured?.["positions"] as Position[])
        .flatMap((position) => position.organizations)
        .flatMap((group) => group.items);
      expect(items.length, `page ${page}`).toBeGreaterThan(0);
      expect(
        items.every((item) => item.same_letter_as === idOf(first) && item.same_letter_count === 250),
        `page ${page}`,
      ).toBe(true);
    }
    const fourth = await callTool(connected, "testimony", { measure: "SB 983", page: 4 });
    const real = (fourth.structured?.["positions"] as Position[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items)
      .find((item) => item.id === idOf(212_098));
    expect(real).toMatchObject({ same_letter_as: null, same_letter_count: null });
  });

  it("answers with an error that names the last page when the page asked for is past it", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 983", page: 7 });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/6 pages/);
    expect(outcome.text).toMatch(/no page 7/);
  });
});
