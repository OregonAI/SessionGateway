// Seam 1 (test/CLAUDE.md): `testimony` on values the committed fixture lacks, or after the feed changes. Each case
// builds its own system, because the feed it needs is the thing under test. A row that a case adds is MADE UP (a
// `strayRows` row of the fake OLIS, shaped like feed/CommitteePublicTestimonies.json's, filed under SB 983 unless the
// case says otherwise) and is said so in the case's comment. The cases that read the fixture as it stands are in
// testimony.test.ts, and the Measure with more rows than a page is in testimony-large.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";
import { madeUpTestimonyRow, testimonyDownloadPath, type MadeUpTestimony } from "../support/testimony.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 2025-07-15 10:00 in Oregon: after every row of the fixture was created.
const clockAt = "2025-07-15T17:00:00Z";

async function start(options: Partial<SystemOptions> = {}): Promise<System> {
  const system = await startSystem({ clockAt, ...options });
  started.push(system);
  return system;
}

async function testimonyOf(system: System, era: Era, measure: string, page?: number) {
  const connected = await connectClient(era, system.handler);
  try {
    return await callTool(connected, "testimony", page === undefined ? { measure } : { measure, page });
  } finally {
    await connected.close();
  }
}

/** The Testimony rows of SB 983 the made-up rows add to the fixture's one. */
function withMadeUp(rows: MadeUpTestimony[]): Partial<SystemOptions> {
  return { olis: { strayRows: { CommitteePublicTestimonies: rows.map(madeUpTestimonyRow) } } };
}

type Item = { id: string; [field: string]: unknown };
type Group = { organization: string | null; spellings: string[]; count: number; items: Item[] };
type Position = { position_id: number; position: string; count: number; organizations: Group[] };
const positionsOf = (outcome: { structured: Record<string, unknown> | undefined }): Position[] =>
  outcome.structured?.["positions"] as Position[];

// Every case runs once for each kind of MCP client (test/CLAUDE.md, "MCP client"), each with a system of its own.
describe.for(eras)("testimony on rows the fixture lacks, for a %s client", (era) => {
  describe("a Testimony file the worker has not fetched", () => {
    // The fake OLIS serves no files by default, so the worker lists every document as not fetched (test/CLAUDE.md). The
    // feed still says who testified, so HB 3131's 42 rows are listed all the same, each saying that get_document does
    // not know its id yet and that nothing is known of its text layer. Nothing can be called an identical letter.
    it("is listed with fetched false, an unknown text layer and no identical letters", async () => {
      const system = await start({ documents: false });

      const outcome = await testimonyOf(system, era, "HB 3131");

      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({ total: 42, identical_letters: [] });
      const items = positionsOf(outcome)
        .flatMap((position) => position.organizations)
        .flatMap((group) => group.items);
      expect(items).toHaveLength(42);
      expect(items.every((item) => item["fetched"] === false && item["has_text_layer"] === null)).toBe(true);
      expect(items.every((item) => item["same_letter_as"] === null)).toBe(true);
      const connected = await connectClient(era, system.handler);
      try {
        const document = await callTool(connected, "get_document", { id: "testimony-2025r1-117165" });
        expect(document.isError).toBe(true);
      } finally {
        await connected.close();
      }
    });
  });

  describe("a position id that is not one of the four", () => {
    // Made-up rows 930001 (4022, which is listed: "unknown"), 930002 (9999) and 930003 (9000) on SB 983, whose one real
    // row is 212098, oppose. The two ids the feed does not list are shown under their numbers, labelled as unlisted,
    // after the four listed positions, in numeric order, and none is dropped: 4 rows in all.
    it("is shown under its number, labelled as unlisted, and never dropped", async () => {
      const system = await start({
        documents: false,
        ...withMadeUp([
          { commTestId: 930_001, positionId: 4022, organization: "Alpha" },
          { commTestId: 930_002, positionId: 9999, organization: "Beta" },
          { commTestId: 930_003, positionId: 9000, organization: "Gamma" },
        ]),
      });

      const outcome = await testimonyOf(system, era, "SB 983");

      expect(outcome.structured).toMatchObject({ total: 4 });
      expect(outcome.structured?.["position_counts"]).toEqual([
        { position_id: 3983, position: "support", count: 0 },
        { position_id: 3982, position: "oppose", count: 1 },
        { position_id: 3981, position: "neutral", count: 0 },
        { position_id: 4022, position: "unknown", count: 1 },
        { position_id: 9000, position: "unlisted position", count: 1 },
        { position_id: 9999, position: "unlisted position", count: 1 },
      ]);
      expect(
        positionsOf(outcome).map((position) => [
          position.position_id,
          position.position,
          position.organizations.flatMap((group) => group.items.map((item) => item.id)),
        ]),
      ).toEqual([
        [3982, "oppose", ["testimony-2025r1-212098"]],
        [4022, "unknown", ["testimony-2025r1-930001"]],
        [9000, "unlisted position", ["testimony-2025r1-930003"]],
        [9999, "unlisted position", ["testimony-2025r1-930002"]],
      ]);
    });
  });

  describe("a row whose BehalfOf names an Agency and whose Organization is a city", () => {
    // MADE UP: row 930041 on SB 983 gives BehalfOf "Bureau of Labor and Industries", which is the whole of an Agency's
    // name in the committed snapshot's registry (test/fixtures/oregonai-snapshot/snapshot.json, the same name that
    // SB 69's real Testimony 196915 gives as its Organization), and Organization "Portland". Spec #1 (module 5) matches
    // a row's Organization against the registry and nothing else, so the row carries no slug: no real row of the
    // fixture has an Agency's name in BehalfOf, so only a made-up one can show that BehalfOf is not matched.
    it("carries no Agency slug, because only Organization is matched", async () => {
      const system = await start({
        documents: false,
        ...withMadeUp([
          {
            commTestId: 930_041,
            behalfOf: "Bureau of Labor and Industries",
            organization: "Portland",
          },
        ]),
      });

      const outcome = await testimonyOf(system, era, "SB 983");

      const items = positionsOf(outcome)
        .flatMap((position) => position.organizations)
        .flatMap((group) => group.items);
      expect(items.find((item) => item.id === "testimony-2025r1-930041")).toMatchObject({
        behalf_of: "Bureau of Labor and Industries",
        organization: "Portland",
        agency_id: null,
      });
    });
  });

  describe("Organization values that differ only in capitals or spaces", () => {
    // Made-up rows 930021 "grants pass", 930022 "Grants  Pass" (two spaces) and 930023 "GRANTS PASS " (capitals and a
    // trailing space) are support; 930024 "Grants Pass" is oppose. "grants pass" is how the feed's own row 197756
    // (HB 3027) spells it. The three support rows are one group, shown as the first spelling by CommTestId (not the
    // first alphabetically) with every spelling listed as written. The oppose row is a group of its own: an
    // organization on both sides is two groups, so the Measure has 3 (the real oppose row's "Newberg" is the third).
    it("are one group in a position, shown by the first spelling, and another group under another position", async () => {
      const system = await start({
        documents: false,
        ...withMadeUp([
          { commTestId: 930_021, organization: "grants pass" },
          { commTestId: 930_022, organization: "Grants  Pass" },
          { commTestId: 930_023, organization: "GRANTS PASS " },
          { commTestId: 930_024, positionId: 3982, organization: "Grants Pass" },
        ]),
      });

      const outcome = await testimonyOf(system, era, "SB 983");

      const [support, oppose] = positionsOf(outcome);
      expect(support?.organizations).toEqual([
        expect.objectContaining({
          organization: "grants pass",
          spellings: ["grants pass", "Grants  Pass", "GRANTS PASS "],
          count: 3,
        }),
      ]);
      expect(support?.organizations[0]?.items.map((item) => item.id)).toEqual([
        "testimony-2025r1-930021",
        "testimony-2025r1-930022",
        "testimony-2025r1-930023",
      ]);
      expect(oppose?.organizations.map((group) => [group.organization, group.count])).toEqual([
        ["Grants Pass", 1],
        ["Newberg", 1],
      ]);
      expect(outcome.structured).toMatchObject({ total: 5, organization_groups: 3 });
    });
  });

  describe("a row that gives no organization", () => {
    // Made-up rows 930011 (""), 930012 ("   ") and 930013 (no Organization at all) with 930014 "Zed Town" and 930015
    // "Abe Town". The three that give none are one "no organization given" group, with organization null, and it comes
    // after every named group: alphabetically an empty value would come first.
    it("goes into one group, listed after the named ones", async () => {
      const system = await start({
        documents: false,
        ...withMadeUp([
          { commTestId: 930_011, organization: "" },
          { commTestId: 930_012, organization: "   " },
          { commTestId: 930_013, organization: null },
          { commTestId: 930_014, organization: "Zed Town" },
          { commTestId: 930_015, organization: "Abe Town" },
        ]),
      });

      const outcome = await testimonyOf(system, era, "SB 983");

      const support = positionsOf(outcome)[0];
      expect(support?.position).toBe("support");
      expect(support?.organizations.map((group) => [group.organization, group.count])).toEqual([
        ["Abe Town", 1],
        ["Zed Town", 1],
        [null, 3],
      ]);
      expect(support?.organizations[2]?.items.map((item) => [item.id, item["organization"]])).toEqual([
        ["testimony-2025r1-930011", ""],
        ["testimony-2025r1-930012", "   "],
        ["testimony-2025r1-930013", null],
      ]);
    });
  });

  describe("two files with the same words and different bytes", () => {
    // The two postings of SB 69's -1 that the fixture holds as proposed-amendments/26284.pdf and 26287.pdf differ only
    // in the PDF's modification date (ADR-0011): `sha256sum` gives c58e10ef... and 6c7919c7..., and `pdftotext -raw`
    // prints the same text for both. They are served here as the files of made-up rows 930031 and 930032; 930033 has a
    // file whose words differ (26286.pdf, `pdftotext` differs). Identical letters are decided by the text, so 930031
    // and 930032 are one letter, and the case shows it through get_document: the content hashes differ and the text
    // does not.
    it("are one letter, and a file with other words is not part of it", async () => {
      const system = await start({
        documents: true,
        olis: {
          strayRows: {
            CommitteePublicTestimonies: [930_031, 930_032, 930_033].map((commTestId) =>
              madeUpTestimonyRow({ commTestId }),
            ),
          },
          strayDocuments: {
            [testimonyDownloadPath(930_031)]: "proposed-amendments/26284.pdf",
            [testimonyDownloadPath(930_032)]: "proposed-amendments/26287.pdf",
            [testimonyDownloadPath(930_033)]: "proposed-amendments/26286.pdf",
          },
        },
      });

      const outcome = await testimonyOf(system, era, "SB 983");

      expect(outcome.structured?.["identical_letters"]).toEqual([
        {
          id_to_read: "testimony-2025r1-930031",
          count: 2,
          ids: ["testimony-2025r1-930031", "testimony-2025r1-930032"],
          ids_left_out: 0,
        },
      ]);
      const connected = await connectClient(era, system.handler);
      try {
        const first = await callTool(connected, "get_document", { id: "testimony-2025r1-930031" });
        const second = await callTool(connected, "get_document", { id: "testimony-2025r1-930032" });
        expect(first.structured?.["content_hash"]).not.toBe(second.structured?.["content_hash"]);
        expect(first.structured?.["text"]).toBe(second.structured?.["text"]);
      } finally {
        await connected.close();
      }
    }, 60_000);
  });

  describe("a Testimony row that OLIS moves to another Measure", () => {
    // OLIS changes a Testimony's Measure after the fact (ADR-0011, "Order of a pull"). The fixture holds each row's final
    // state, so the case moves SB 983's one row, 212098, to SB 64 (made up for the case) and pulls again. SB 983 is then
    // a Measure with no Testimony: no rows, no positions with rows, one empty page, and all four positions counted 0.
    it("follows the row, and a Measure with none answers with an empty page", async () => {
      const system = await start({ documents: false });
      expect(await testimonyOf(system, era, "SB 983")).toMatchObject({ structured: { total: 1 } });

      system.olis.amendRows("CommitteePublicTestimonies", (row) => row["CommTestId"] === 212_098, {
        MeasurePrefix: "SB",
        MeasureNumber: 64,
      });
      await system.pullAgain();

      const emptied = await testimonyOf(system, era, "SB 983");
      expect(emptied.isError).toBe(false);
      expect(emptied.structured).toMatchObject({
        total: 0,
        organization_groups: 0,
        identical_letters: [],
        positions: [],
        page: 1,
        page_count: 1,
        position_counts: [
          { position_id: 3983, position: "support", count: 0 },
          { position_id: 3982, position: "oppose", count: 0 },
          { position_id: 3981, position: "neutral", count: 0 },
          { position_id: 4022, position: "unknown", count: 0 },
        ],
      });
      const gained = await testimonyOf(system, era, "SB 64");
      expect(gained.structured).toMatchObject({ total: 13 });
      expect(
        positionsOf(gained)
          .flatMap((position) => position.organizations)
          .flatMap((group) => group.items)
          .map((item) => item.id),
      ).toContain("testimony-2025r1-212098");
    });
  });
});
