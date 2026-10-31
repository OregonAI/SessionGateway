// Seam 1: `find_measures` by ORS section and by ORS chapter, by Agency across the whole Session, and the contract of its
// answer (ticket #16, spec #1 stories 30 to 32 and 35), with the whole system behind it. One database of the whole
// fixture serves every case in this file because none of them changes it; the cases that ask at an earlier day are in
// find-measures-since.test.ts, and the ones that need rows the fixture lacks in find-measures-pull.test.ts.
//
// Expected values are literals from the fixture's feed rows (test/fixtures/olis-2025R1/feed/), the documents as
// `pdftotext` prints them (test/fixtures/olis-2025R1/documents/) and the snapshot fixture.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 278 documents.
  system = await startCopiedSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type Example = {
  document_id: string;
  target_id?: string;
  measure_sections?: (string | null)[];
  chapter_id?: string;
  unit?: string;
  through?: string[];
  through_total?: number;
};
type KindEvidence = { kind: string; count: number; left_out: number; examples: Example[] };
type Item = {
  id: string;
  type: string;
  title: string;
  measure_id: string;
  source_url: string;
  created_at: string | null;
  last_created_at: string | null;
  evidence: KindEvidence[];
};
type Group = { evidence_kind: string; description: string; total: number; items: Item[] };
type Found = {
  query: { agency: string | null; ors_section: string | null; ors_chapter: string | null; since: string | null };
  total: number;
  page: number;
  last_page: number;
  page_size: number;
  groups: Group[];
  documents: { id: string; source_url: string }[];
  notes: string[];
  as_of: string;
  notice: string;
};

describe.for(eras)("find_measures for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  async function find(args: Record<string, unknown>): Promise<Found> {
    const outcome = await callTool(connected, "find_measures", args);
    expect(outcome.isError, outcome.text).toBe(false);
    return outcome.structured as unknown as Found;
  }

  /** Every item of one group, from every page of the answer. */
  async function allItems(args: Record<string, unknown>, kind: string): Promise<Item[]> {
    const first = await find(args);
    const items = [...groupOf(first, kind).items];
    for (let page = 2; page <= first.last_page; page += 1) {
      items.push(...groupOf(await find({ ...args, page }), kind).items);
    }
    return items;
  }

  const groupOf = (found: Found, kind: string): Group => {
    const group = found.groups.find((candidate) => candidate.evidence_kind === kind);
    if (group === undefined) throw new Error(`No group ${kind}`);
    return group;
  };

  /** What an item's Statute Links of these kinds say, as [link kind, count, target, measure sections] for each example. */
  const linksOf = (item: Item | undefined, kinds: readonly string[]): [string, number, string, (string | null)[]][] =>
    (item?.evidence ?? [])
      .filter((group) => kinds.includes(group.kind))
      .flatMap((group) =>
        group.examples.map((example): [string, number, string, (string | null)[]] => [
          group.kind,
          group.count,
          example.target_id ?? "",
          example.measure_sections ?? [],
        ]),
      );

  // ORS 653.616 is amended by SECTION 8 of SB 69's A-Engrossed and Enrolled Versions and of its Proposed Amendments -1
  // and -2, and cited in their SECTION 9 ("for a purpose described in ORS 653.616 (1) to [(4)] (5)"): pdftotext of
  // measure-documents/SB69/A-Engrossed.pdf, Enrolled.pdf and proposed-amendments/26284.pdf, 26286.pdf. No other
  // Version or Proposed Amendment of the fixture names the section (Introduced SB 69 cites ORS 192.245 alone; the
  // Printed Amendment "Senate Amendments to Introduced" names it but is not read, ADR-0015). The items come newest
  // first: Enrolled was created 2025-05-05 (feed/MeasureDocuments.json), A-Engrossed 2025-02-03, and the amendments'
  // latest postings 26288 (-2) and 26287 (-1) on 2025-01-23 at 16:27:37.073 and 16:27:37.06.
  describe("by ORS section", () => {
    it("returns the Versions and Proposed Amendments with a Statute Link to ORS 653.616, newest first, with the kind of each link", async () => {
      const found = await find({ ors_section: "ORS 653.616" });

      expect(found.query).toEqual({ agency: null, ors_section: "ors-653.616", ors_chapter: null, since: null });
      expect(found.groups.map((group) => [group.evidence_kind, group.total])).toEqual([["statute-link", 4]]);
      const { items } = groupOf(found, "statute-link");
      expect(items.map((item) => [item.id, item.type, item.measure_id, item.title])).toEqual([
        ["version-2025r1-sb69-enrolled", "version", "measure-2025r1-sb69", "SB 69 Enrolled"],
        ["version-2025r1-sb69-a-engrossed", "version", "measure-2025r1-sb69", "SB 69 A-Engrossed"],
        ["amendment-2025r1-sb69-2", "proposed_amendment", "measure-2025r1-sb69", "SB 69-2"],
        ["amendment-2025r1-sb69-1", "proposed_amendment", "measure-2025r1-sb69", "SB 69-1"],
      ]);
      for (const item of items) {
        expect(linksOf(item, ["amends", "repeals", "adds-to", "cites"])).toEqual([
          ["amends", 1, "ors-653.616", ["8"]],
          ["cites", 1, "ors-653.616", ["9"]],
        ]);
      }
    });

    it("reads the section as a citation in any case, as OregonAI's id, or with stray spaces", async () => {
      const forms = ["ORS 653.616", "ors 653.616", "ors-653.616", "  ORS   653.616 "];

      for (const form of forms) {
        const found = await find({ ors_section: form });
        expect(groupOf(found, "statute-link").items.map((item) => item.id)).toEqual([
          "version-2025r1-sb69-enrolled",
          "version-2025r1-sb69-a-engrossed",
          "amendment-2025r1-sb69-2",
          "amendment-2025r1-sb69-1",
        ]);
      }
    });

    it("gives each item the document its link was read from and where the Legislature publishes it", async () => {
      const found = await find({ ors_section: "ORS 653.616" });

      const { items } = groupOf(found, "statute-link");
      expect(items.map((item) => item.source_url)).toEqual([
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Enrolled",
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/A-Engrossed",
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26288",
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26287",
      ]);
      expect(items.map((item) => item.evidence[0]?.examples[0]?.document_id)).toEqual([
        "version-2025r1-sb69-enrolled",
        "version-2025r1-sb69-a-engrossed",
        "posting-2025r1-26286",
        "posting-2025r1-26284",
      ]);
      // Each document once, with where the Legislature publishes it: the amendments' first postings by the feed's number.
      expect(found.documents).toEqual([
        {
          id: "posting-2025r1-26284",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26284",
        },
        {
          id: "posting-2025r1-26286",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26286",
        },
        {
          id: "version-2025r1-sb69-a-engrossed",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/A-Engrossed",
        },
        {
          id: "version-2025r1-sb69-enrolled",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Enrolled",
        },
      ]);
    });

    it("returns nothing for a section no Version or amendment links to, and says so", async () => {
      const found = await find({ ors_section: "ORS 468.130" });

      expect(found.total).toBe(0);
      expect(groupOf(found, "statute-link").items).toEqual([]);
      expect(found.notes).toEqual(["The index holds no Statute Link to ors-468.130."]);
    });
  });

  // SB 69 changes three sections of chapter 657B (657B.060 in SECTION 7, 657B.070 in 3 and 657B.400 in 6) and adds a
  // section to the chapter in SECTION 1 ("added to and made a part of ORS chapter 657B"): pdftotext of the same files.
  // Chapter 657B is not chapter 657: SB 69 also cites "ORS chapter 657" (SECTION 3's "duties under ORS chapter 657."),
  // and no other Version or amendment of the fixture names chapter 657 or a section in it.
  describe("by ORS chapter", () => {
    // An item shows three examples at the most, the changes first: the three amended sections. The section added to the
    // chapter (SECTION 1) is the one adds-to link, counted and left out.
    const changes = [
      ["amends", 3, "ors-657b.060", ["7"]],
      ["amends", 3, "ors-657b.070", ["3"]],
      ["amends", 3, "ors-657b.400", ["6"]],
    ];

    it("returns the Versions and Proposed Amendments with a Statute Link to the chapter or to a section in it", async () => {
      const found = await find({ ors_chapter: "ORS chapter 657B" });

      expect(found.query).toEqual({ agency: null, ors_section: null, ors_chapter: "ors-chapter-657b", since: null });
      const { items } = groupOf(found, "statute-link");
      expect(items.map((item) => item.id)).toEqual([
        "version-2025r1-sb69-enrolled",
        "version-2025r1-sb69-a-engrossed",
        "amendment-2025r1-sb69-2",
        "amendment-2025r1-sb69-1",
      ]);
      for (const item of items) {
        expect(linksOf(item, ["amends", "repeals", "adds-to"])).toEqual(changes);
        expect(
          item.evidence
            .filter((group) => group.kind !== "cites")
            .map((group) => [group.kind, group.count, group.left_out]),
        ).toEqual([
          ["amends", 3, 0],
          ["adds-to", 1, 1],
        ]);
      }
    });

    it("reads the chapter as a citation or as the id this service mints", async () => {
      for (const form of ["ORS chapter 657B", "ors chapter 657b", "ors-chapter-657b"]) {
        const found = await find({ ors_chapter: form });
        expect(found.query.ors_chapter).toBe("ors-chapter-657b");
        expect(groupOf(found, "statute-link").total).toBe(4);
      }
    });

    it("matches a chapter that only sections of it link to", async () => {
      const found = await find({ ors_chapter: "ORS chapter 653" });

      const { items } = groupOf(found, "statute-link");
      expect(items.map((item) => item.id)).toEqual([
        "version-2025r1-sb69-enrolled",
        "version-2025r1-sb69-a-engrossed",
        "amendment-2025r1-sb69-2",
        "amendment-2025r1-sb69-1",
      ]);
      for (const item of items) {
        expect(linksOf(item, ["amends"])).toEqual([
          ["amends", 2, "ors-653.616", ["8"]],
          ["amends", 2, "ors-653.626", ["9"]],
        ]);
      }
    });

    it("does not take chapter 657B's sections for chapter 657's", async () => {
      const found = await find({ ors_chapter: "ORS chapter 657" });

      const { items } = groupOf(found, "statute-link");
      expect(items.map((item) => item.id)).toEqual([
        "version-2025r1-sb69-enrolled",
        "version-2025r1-sb69-a-engrossed",
        "amendment-2025r1-sb69-2",
        "amendment-2025r1-sb69-1",
      ]);
      for (const item of items) {
        expect(item.evidence.map((group) => [group.kind, group.count])).toEqual([["cites", 1]]);
        expect(item.evidence[0]?.examples.map((example) => example.target_id)).toEqual(["ors-chapter-657"]);
      }
    });
  });

  // The Agency across the whole Session. SB 69's Fiscal Impact Statement 85414 lists the Bureau of Labor and Industries;
  // its Label "A" places it on the A-Engrossed Version (created 2025-02-03), once the feed lists that Version, and the
  // statement was created 2025-01-30 at 10:43:53.29. Testimony 196915 (Organization "Bureau of Labor and Industries") was
  // created 2025-04-21 at 08:40:21.78, in daylight time. The Bureau's rules implement chapters 25, 279C, 345, 652, 653,
  // 654, 657B, 658 and 659A (snapshot fixture), of which SB 69's changes reach 653, 657B and 659A, HB 3027's
  // Introduced and Enrolled Versions add to ORS 345.010 to 345.340, and the fixture's other Versions and amendments reach none.
  describe("by Agency", () => {
    const boli = "bureau-of-labor-and-industries";

    it("keeps the four ways an item is tied to the Agency in four groups, in a fixed order", async () => {
      const found = await find({ agency: boli });

      expect(found.query).toEqual({ agency: boli, ors_section: null, ors_chapter: null, since: null });
      expect(found.groups.map((group) => [group.evidence_kind, group.total])).toEqual([
        ["derived", 6],
        ["fiscal-impact-statement", 1],
        ["named-in-text", 4],
        ["testimony", 1],
      ]);
      expect(found.total).toBe(12);
      expect(found.notes).toEqual([]);
    });

    it("lists the items that touch the Agency's statutes, with the chapter and the Statute Link of each", async () => {
      const found = await find({ agency: boli });

      const { items } = groupOf(found, "derived");
      expect(items.map((item) => item.id)).toEqual([
        "version-2025r1-hb3027-enrolled",
        "version-2025r1-sb69-enrolled",
        "version-2025r1-sb69-a-engrossed",
        "amendment-2025r1-sb69-2",
        "amendment-2025r1-sb69-1",
        "version-2025r1-hb3027-introduced",
      ]);
      const chaptersOf = (item: Item | undefined): (string | undefined)[] =>
        item?.evidence.flatMap((group) => group.examples.map((example) => example.chapter_id)) ?? [];
      expect(chaptersOf(items[1])).toEqual(["ors-chapter-657b", "ors-chapter-659a", "ors-chapter-653"]);
      expect(chaptersOf(items[0])).toEqual(["ors-chapter-345"]);
      expect(chaptersOf(items[5])).toEqual(["ors-chapter-345"]);
    });

    it("lists the Fiscal Impact Statement's item on the Version it is of, with the statement's own time", async () => {
      const found = await find({ agency: boli });

      const { items } = groupOf(found, "fiscal-impact-statement");
      expect(items.map((item) => [item.id, item.type, item.created_at])).toEqual([
        ["version-2025r1-sb69-a-engrossed", "version", "2025-01-30T10:43:53.29-08:00"],
      ]);
      expect(items[0]?.source_url).toBe(
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/A-Engrossed",
      );
      expect(items[0]?.evidence[0]?.examples[0]?.document_id).toBe("analysis-2025r1-85414");
      expect(found.documents.find((document) => document.id === "analysis-2025r1-85414")?.source_url).toBe(
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/85414",
      );
    });

    it("lists the Measure whose Testimony names the Agency, with the Testimony", async () => {
      const found = await find({ agency: boli });

      const { items } = groupOf(found, "testimony");
      expect(items.map((item) => [item.id, item.type, item.title, item.created_at, item.last_created_at])).toEqual([
        ["measure-2025r1-sb69", "measure", "SB 69", "2025-04-21T08:40:21.78-07:00", "2025-04-21T08:40:21.78-07:00"],
      ]);
      expect(items[0]?.source_url).toBe("https://olis.oregonlegislature.gov/liz/2025R1/Measures/Overview/SB69");
      expect(items[0]?.evidence.flatMap((group) => group.examples.map((example) => example.document_id))).toEqual([
        "testimony-2025r1-196915",
      ]);
    });

    it("puts an Agency slug and nothing else in the answer's Agency ids", async () => {
      const found = await find({ agency: "department-of-human-services" });

      expect(found.query.agency).toBe("department-of-human-services");
      expect(groupOf(found, "derived").items.length).toBeGreaterThan(0);
    });

    it("says so when the index holds no Agency Link to the slug", async () => {
      const found = await find({ agency: "no-such-agency" });

      expect(found.total).toBe(0);
      expect(found.notes).toEqual([
        "The index holds no Agency Link to no-such-agency. Check the slug against the OregonAI agency registry.",
      ]);
    });
  });

  // An Agency's sub-units are rows of their own in the registry, and the Chapter table gives a chapter the sub-unit that
  // implements it, not the Department (ADR-0012). A Fiscal Impact Statement that names "Department of Human Services"
  // resolves to the Department, so the two halves of spec #1's question (a) must meet at the parent (#16 F3). The snapshot
  // fixture's chapter 659A row lists DHS's Aging and People with Disabilities and Developmental Disabilities (a sub-unit
  // whose registry relation places it under department-of-human-services) and not the Department itself, and SB 69's
  // A-Engrossed and Enrolled Versions and its amendments -1 and -2 amend sections of chapter 659A (659A.159, 659A.165 and
  // 659A.156: pdftotext of measure-documents/SB69/A-Engrossed.pdf). Chapters 409 and 418 list the Department itself and
  // three of its sub-units, and HB 3795's Versions and amendments amend 409.711 and 418.808. HB 3795's Fiscal Impact
  // Statements 'A' and 'B' and SB 64's Introduced one name the Department (measures.txt).
  describe("an Agency with sub-units", () => {
    const dhs = "department-of-human-services";
    const apd = "department-of-human-services-aging-and-people-with-disabilities-and-developmental-disabilities";

    it("lists SB 69 among the Department's statutes, through the sub-unit whose rules implement chapter 659A", async () => {
      const found = await find({ agency: dhs });

      const { items } = groupOf(found, "derived");
      expect(items.map((item) => item.id)).toEqual([
        "version-2025r1-hb3795-enrolled",
        "version-2025r1-hb3795-b-engrossed",
        "amendment-2025r1-hb3795-a3",
        "version-2025r1-sb69-enrolled",
        "version-2025r1-hb3795-a-engrossed",
        "amendment-2025r1-hb3795-1",
        "version-2025r1-sb69-a-engrossed",
        "amendment-2025r1-sb69-2",
        "amendment-2025r1-sb69-1",
      ]);
      const sb69 = items.filter((item) => item.measure_id === "measure-2025r1-sb69");
      expect(sb69).toHaveLength(4);
      for (const item of sb69) {
        expect(
          item.evidence.flatMap((group) => group.examples.map((example) => [example.chapter_id, example.through])),
        ).toEqual([["ors-chapter-659a", [apd]]]);
      }
    });

    it("lists HB 3795 as before, on the chapters the Department's own rules implement, with no sub-unit named", async () => {
      const found = await find({ agency: dhs });

      const hb3795 = groupOf(found, "derived").items.filter((item) => item.measure_id === "measure-2025r1-hb3795");
      expect(hb3795).toHaveLength(5);
      for (const item of hb3795) {
        for (const group of item.evidence) {
          for (const example of group.examples) expect(example.through).toBeUndefined();
        }
      }
    });

    it("keeps the Fiscal Impact Statement group as it was: the statements that name the Department", async () => {
      const found = await find({ agency: dhs });

      expect(groupOf(found, "fiscal-impact-statement").items.map((item) => item.id)).toEqual([
        "version-2025r1-hb3795-b-engrossed",
        "version-2025r1-hb3795-a-engrossed",
        "version-2025r1-sb64-introduced",
      ]);
    });

    // get_measure counts these six and gives three of them as examples (agency-links.test.ts); find_measures has all six.
    it("lists every node of HB 3795 whose text names the Department, the six that get_measure only counts", async () => {
      const named = (await allItems({ agency: dhs }, "named-in-text")).filter(
        (item) => item.measure_id === "measure-2025r1-hb3795",
      );
      expect(named.map((item) => item.id)).toEqual([
        "version-2025r1-hb3795-enrolled",
        "version-2025r1-hb3795-b-engrossed",
        "amendment-2025r1-hb3795-a3",
        "version-2025r1-hb3795-a-engrossed",
        "amendment-2025r1-hb3795-1",
        "version-2025r1-hb3795-introduced",
      ]);
    });

    it("lists the sub-unit's own items without a sub-unit named: the link is its own", async () => {
      const found = await find({ agency: apd });

      const sb69 = groupOf(found, "derived").items.filter((item) => item.measure_id === "measure-2025r1-sb69");
      expect(sb69.map((item) => item.id)).toEqual([
        "version-2025r1-sb69-enrolled",
        "version-2025r1-sb69-a-engrossed",
        "amendment-2025r1-sb69-2",
        "amendment-2025r1-sb69-1",
      ]);
      for (const item of sb69) {
        expect(item.evidence.every((group) => group.examples.every((example) => example.through === undefined))).toBe(
          true,
        );
      }
    });
  });

  // The ticket's second box: non-agency units stay unresolved. SB 983's Introduced statement is analysis 88044 and its
  // A-Engrossed one 91466; both read "Government Unit(s) Affected: Cities, Counties, School Districts, Special Districts,
  // Metro, TriMet" (pdftotext of measure-analysis-documents/88044.pdf and 91466.pdf). None is a state agency, so the units
  // are kept as written and the statements give no Agency a link of any kind (#16 F10: this case checked three slugs
  // that no defect would have put there).
  describe("units that are not Agencies", () => {
    const statements = ["analysis-2025r1-88044", "analysis-2025r1-91466"];
    const units = ["Cities", "Counties", "School Districts", "Special Districts", "Metro", "TriMet"];

    async function linksOfSb983(): Promise<{
      agencies: { agency_id: string; evidence: { kind: string; examples: { document_id: string }[] }[] }[];
      unresolved_units: { unit: string; statement_id: string }[];
    }> {
      const outcome = await callTool(connected, "get_measure", { measure: "SB 983" });
      expect(outcome.isError, outcome.text).toBe(false);
      return outcome.structured?.["agency_links"] as Awaited<ReturnType<typeof linksOfSb983>>;
    }

    it("keeps each statement's six units as it writes them, in its order", async () => {
      const links = await linksOfSb983();

      expect(links.unresolved_units.map((unit) => [unit.statement_id, unit.unit])).toEqual([
        ["analysis-2025r1-88044", "Cities"],
        ["analysis-2025r1-88044", "Counties"],
        ["analysis-2025r1-88044", "School Districts"],
        ["analysis-2025r1-88044", "Special Districts"],
        ["analysis-2025r1-88044", "Metro"],
        ["analysis-2025r1-88044", "TriMet"],
        ["analysis-2025r1-91466", "Cities"],
        ["analysis-2025r1-91466", "Counties"],
        ["analysis-2025r1-91466", "School Districts"],
        ["analysis-2025r1-91466", "Special Districts"],
        ["analysis-2025r1-91466", "Metro"],
        ["analysis-2025r1-91466", "TriMet"],
      ]);
    });

    it("gives no Agency a link of any kind from either statement", async () => {
      const links = await linksOfSb983();

      const documents = links.agencies.flatMap((agency) =>
        agency.evidence.flatMap((group) => group.examples.map((example) => example.document_id)),
      );
      for (const statement of statements) expect(documents).not.toContain(statement);
      expect(links.agencies.flatMap((agency) => agency.evidence.map((group) => group.kind))).not.toContain(
        "fiscal-impact-statement",
      );
      // And none of the units is an Agency id.
      const ids = links.agencies.map((agency) => agency.agency_id);
      for (const unit of units) expect(ids).not.toContain(unit.toLowerCase().replaceAll(" ", "-"));
    });

    it("ties SB 983 to no Agency's Fiscal Impact Statement group, for every Agency the Measure has a link to", async () => {
      const links = await linksOfSb983();

      for (const agency of links.agencies) {
        const found = await find({ agency: agency.agency_id });
        const items = groupOf(found, "fiscal-impact-statement").items;
        expect(items.filter((item) => item.measure_id === "measure-2025r1-sb983")).toEqual([]);
      }
    });
  });

  describe("a call that cannot be met", () => {
    it.for([
      ["no target", {}, "Give exactly one of agency, ors_section and ors_chapter."],
      [
        "two targets",
        { agency: "department-of-revenue", ors_section: "ORS 653.616" },
        "Give exactly one of agency, ors_section and ors_chapter.",
      ],
      ["a name where a slug is wanted", { agency: "Bureau of Labor and Industries" }, "is not an Agency id"],
      ["a section that is a chapter", { ors_section: "ORS chapter 657B" }, "is not an ORS section"],
      ["a section with no number", { ors_section: "ORS 653" }, "is not an ORS section"],
      ["a chapter that is a section", { ors_chapter: "ORS 653.616" }, "is not an ORS chapter"],
      ["a time that is a word", { agency: "department-of-revenue", since: "yesterday" }, "is not a time"],
    ] as const)("is a tool error for %s", async ([, args, message]) => {
      const outcome = await callTool(connected, "find_measures", args);

      expect(outcome.isError).toBe(true);
      expect(outcome.text).toContain(message);
    });

    it("is a tool error for a page past the last", async () => {
      const outcome = await callTool(connected, "find_measures", { agency: "bureau-of-labor-and-industries", page: 2 });

      expect(outcome.isError).toBe(true);
      expect(outcome.text).toBe("The answer has 1 page, so there is no page 2. Ask for a page from 1 to 1.");
    });
  });

  // F16: the feed's CreatedDate is the "created" time, and "posted" is the meeting a posting was posted to. `since` filters on
  // created_at, and an agent reads that in the tool list.
  describe("the tool list", () => {
    it("says that since is compared with created_at, the time OLIS created the row of the evidence's document", async () => {
      const { tools } = await connected.client.listTools();

      const tool = tools.find((candidate) => candidate.name === "find_measures");
      expect(tool?.description).toContain("created_at");
      const properties = (tool?.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      expect(properties["since"]?.description).toContain("created_at");
      expect(properties["since"]?.description).not.toContain("posted_at");
    });
  });

  describe("what every result carries", () => {
    it("carries the index's as-of time, the non-official notice and the size of a page", async () => {
      const found = await find({ ors_section: "ORS 653.616" });

      // The clock was 2026-08-01 17:00 UTC when the pull ran: 10:00 in Oregon, in daylight time.
      expect(found.as_of).toBe("2026-08-01T10:00:00-07:00");
      expect(found.notice).toContain("Not the official record");
      expect([found.page, found.last_page, found.page_size]).toEqual([1, 1, 12]);
    });
  });
});
