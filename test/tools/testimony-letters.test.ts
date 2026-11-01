// Seam 1 (test/CLAUDE.md): `testimony` on a Measure with more sets of identical letters than the summary lists. The
// fixture's only real set is SB 64's pair (testimony.test.ts), so the rows here are MADE UP: 54 support rows added to
// SB 983, which has one real row (CommTestId 212098, oppose, Newberg), served through the fake OLIS as `strayRows` and
// `strayDocuments`. Each made-up row is served the file of one of HB 3131's 42 real Testimony (the 42 have 42
// different texts, which testimony.test.ts shows), so two made-up rows have the same letter exactly when they are
// served the same file. One database serves every case in this file because none of them changes it.
//
// The 54 rows (all support, in organizations "Alpha", "Mid" and "Zz"; a page is 50 items, so page 1 is every row of
// "Alpha" and "Mid" and page 2 is "Zz" and then the real oppose row):
//   - 12 sets of identical letters (a file each), in "Mid" except the last two, in "Zz":
//       5 rows: 940050-940054
//       4 rows: 940010, 940090, 940091, 940092 and 4 rows: 940030-940033 (the same count; 940010 is the lower id)
//       3 rows: 940060-940062, 940065-940067 and 940070-940072
//       2 rows each: 940101-940102, 940103-940104, 940105-940106, 940107-940108 ("Mid"), 940109-940110 and
//       940111-940112 ("Zz")
//   - 20 rows in "Alpha" that are served 20 more files, so each has a letter of its own: 940200-940219.
// The summary lists the 10 largest sets, by count and then by the lowest CommTestId: the sets of 5, 4, 4, 3, 3, 3 and
// the four sets of 2 with the lowest ids. The sets 940109 and 940111 are left out, and their rows are on page 2.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import { madeUpTestimonyRow, testimonyDownloadPath } from "../support/testimony.ts";

// The first 32 of HB 3131's 42 CommTestIds (feed/CommitteePublicTestimonies.json), each a file under
// test/fixtures/olis-2025R1/documents/testimony/.
const files = [
  117_165, 117_166, 117_167, 117_172, 117_177, 117_182, 117_188, 117_191, 117_196, 117_201, 117_204, 117_206, 117_210,
  117_213, 117_225, 117_226, 117_227, 117_228, 117_243, 117_245, 117_248, 117_258, 117_264, 117_276, 117_280, 117_282,
  117_295, 117_301, 117_303, 117_311, 117_326, 117_331,
].map((commTestId) => `testimony/${commTestId}.pdf`);

type MadeUpSet = { ids: number[]; organization: string };
const sets: MadeUpSet[] = [
  { ids: [940_050, 940_051, 940_052, 940_053, 940_054], organization: "Mid" },
  { ids: [940_030, 940_031, 940_032, 940_033], organization: "Mid" },
  { ids: [940_010, 940_090, 940_091, 940_092], organization: "Mid" },
  { ids: [940_060, 940_061, 940_062], organization: "Mid" },
  { ids: [940_065, 940_066, 940_067], organization: "Mid" },
  { ids: [940_070, 940_071, 940_072], organization: "Mid" },
  { ids: [940_101, 940_102], organization: "Mid" },
  { ids: [940_103, 940_104], organization: "Mid" },
  { ids: [940_105, 940_106], organization: "Mid" },
  { ids: [940_107, 940_108], organization: "Mid" },
  { ids: [940_109, 940_110], organization: "Zz" },
  { ids: [940_111, 940_112], organization: "Zz" },
];
const singles = Array.from({ length: 20 }, (_, i) => 940_200 + i);

const rows = [
  ...sets.flatMap((set) =>
    set.ids.map((commTestId) => madeUpTestimonyRow({ commTestId, organization: set.organization })),
  ),
  ...singles.map((commTestId) => madeUpTestimonyRow({ commTestId, organization: "Alpha" })),
];
// A file for each set, then one for each single row: 32 different files, so 12 letters shared and 20 not.
const served: [number, string][] = [
  ...sets.flatMap((set, i) => set.ids.map((commTestId): [number, string] => [commTestId, files[i] ?? ""])),
  ...singles.map((commTestId, i): [number, string] => [commTestId, files[sets.length + i] ?? ""]),
];
const idOf = (commTestId: number): string => `testimony-2025r1-${commTestId}`;

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({
    clockAt: "2025-07-15T17:00:00Z",
    documents: true,
    olis: {
      strayRows: { CommitteePublicTestimonies: rows },
      strayDocuments: Object.fromEntries(served.map(([commTestId, file]) => [testimonyDownloadPath(commTestId), file])),
    },
  });
}, 90_000);

afterAll(async () => {
  await system.stop();
});

type Item = { id: string; same_letter_as: string | null; same_letter_count: number | null };
type Group = { organization: string | null; items: Item[] };
type Position = { position_id: number; organizations: Group[] };
const itemsOf = (structured: Record<string, unknown> | undefined): Item[] =>
  (structured?.["positions"] as Position[])
    .flatMap((position) => position.organizations)
    .flatMap((group) => group.items);

// What the summary lists on every page, as literals from the table above.
const summary = [
  { id_to_read: idOf(940_050), count: 5 },
  { id_to_read: idOf(940_010), count: 4 },
  { id_to_read: idOf(940_030), count: 4 },
  { id_to_read: idOf(940_060), count: 3 },
  { id_to_read: idOf(940_065), count: 3 },
  { id_to_read: idOf(940_070), count: 3 },
  { id_to_read: idOf(940_101), count: 2 },
  { id_to_read: idOf(940_103), count: 2 },
  { id_to_read: idOf(940_105), count: 2 },
  { id_to_read: idOf(940_107), count: 2 },
];

describe.for(eras)("testimony on a Measure with 12 sets of identical letters, for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // The summary is bounded: at most 10 sets, the largest first and, among sets of one size, the one with the lower
  // CommTestId first. A set is its id to read and its count, with no list of the ids that carry it. The page says how
  // many sets are left out. The same holds on page 2.
  it("lists the 10 largest sets on every page, each as its id to read and its count, and says how many it leaves out", async () => {
    for (const page of [1, 2]) {
      const outcome = await callTool(connected, "testimony", { measure: "SB 983", page });

      expect(outcome.isError, `page ${page}`).toBe(false);
      expect(outcome.structured, `page ${page}`).toMatchObject({
        total: 55,
        page,
        last_page: 2,
        identical_letters: summary,
        identical_letters_left_out: 2,
      });
    }
  });

  // Page 1 holds every row of "Alpha" (20 rows, each with a letter of its own) and of "Mid" (30 rows of 10 sets). An
  // item of a set says which letter it has and how many rows share it, so the agent need not look in the summary. The
  // set of 4 whose lowest id is 940010 has two rows far from it (940090 and 940091 are later in the same group).
  it("tells an item of a set on page 1 the id to read and the set's count, and an item of no set neither", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 983" });

    const items = itemsOf(outcome.structured);
    expect(items).toHaveLength(50);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(idOf(940_054))).toMatchObject({ same_letter_as: idOf(940_050), same_letter_count: 5 });
    expect(byId.get(idOf(940_010))).toMatchObject({ same_letter_as: idOf(940_010), same_letter_count: 4 });
    expect(byId.get(idOf(940_092))).toMatchObject({ same_letter_as: idOf(940_010), same_letter_count: 4 });
    expect(byId.get(idOf(940_033))).toMatchObject({ same_letter_as: idOf(940_030), same_letter_count: 4 });
    expect(byId.get(idOf(940_108))).toMatchObject({ same_letter_as: idOf(940_107), same_letter_count: 2 });
    expect(byId.get(idOf(940_200))).toMatchObject({ same_letter_as: null, same_letter_count: null });
    expect(byId.get(idOf(940_219))).toMatchObject({ same_letter_as: null, same_letter_count: null });
    expect(items.filter((item) => item.same_letter_as !== null)).toHaveLength(30);
  });

  // Page 2 holds the two sets the summary leaves out (940109-940110 and 940111-940112, in "Zz") and the real oppose row
  // (212098). Their items still say the id to read and the count: that is how an agent learns the size of a set
  // that is on no summary.
  it("tells an item on page 2 the id to read and the count of a set the summary leaves out", async () => {
    const outcome = await callTool(connected, "testimony", { measure: "SB 983", page: 2 });

    expect(itemsOf(outcome.structured).map((item) => [item.id, item.same_letter_as, item.same_letter_count])).toEqual([
      [idOf(940_109), idOf(940_109), 2],
      [idOf(940_110), idOf(940_109), 2],
      [idOf(940_111), idOf(940_111), 2],
      [idOf(940_112), idOf(940_111), 2],
      [idOf(212_098), null, null],
    ]);
    expect(summary.map((set) => set.id_to_read)).not.toContain(idOf(940_109));
    expect(summary.map((set) => set.id_to_read)).not.toContain(idOf(940_111));
  });
});
