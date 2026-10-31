// Seam 1: `find_measures` by ORS section and by ORS chapter, by Agency across the whole Session, and the contract of its
// answer (ticket #16, spec #1 stories 30 to 32 and 35), with the whole system behind it. One database of the whole
// fixture serves every case in this file because none of them changes it; the cases that ask at an earlier day are in
// find-measures-since.test.ts, and the ones that need rows the fixture lacks in find-measures-pull.test.ts.
//
// Expected values are literals from the fixture's feed rows (test/fixtures/olis-2025R1/feed/), the documents as
// `pdftotext` prints them (test/fixtures/olis-2025R1/documents/) and the snapshot fixture.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 278 documents.
  system = await startSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type Evidence = {
  kind: string;
  document_id: string;
  source_url: string;
  link_kind?: string;
  target_id?: string;
  measure_sections?: (string | null)[];
  chapter_id?: string;
};
type Item = {
  id: string;
  type: string;
  title: string;
  measure_id: string;
  source_url: string;
  posted_at: string | null;
  last_posted_at: string | null;
  evidence_total: number;
  evidence: Evidence[];
};
type Group = { evidence_kind: string; description: string; total: number; items: Item[] };
type Found = {
  query: { agency: string | null; ors_section: string | null; ors_chapter: string | null; since: string | null };
  total: number;
  page: number;
  last_page: number;
  page_size: number;
  groups: Group[];
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

  const groupOf = (found: Found, kind: string): Group => {
    const group = found.groups.find((candidate) => candidate.evidence_kind === kind);
    if (group === undefined) throw new Error(`No group ${kind}`);
    return group;
  };

  /** What each item's Statute Links to the target say, as [link kind, target, measure sections]. */
  const linksOf = (item: Item | undefined, kinds: readonly string[]): [string, string, (string | null)[]][] =>
    (item?.evidence ?? [])
      .filter((evidence) => kinds.includes(evidence.link_kind ?? ""))
      .map((evidence): [string, string, (string | null)[]] => [
        evidence.link_kind ?? "",
        evidence.target_id ?? "",
        evidence.measure_sections ?? [],
      ]);

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
          ["amends", "ors-653.616", ["8"]],
          ["cites", "ors-653.616", ["9"]],
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
      expect(items.map((item) => item.evidence[0]?.document_id)).toEqual([
        "version-2025r1-sb69-enrolled",
        "version-2025r1-sb69-a-engrossed",
        "posting-2025r1-26286",
        "posting-2025r1-26284",
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
    const changes = [
      ["amends", "ors-657b.060", ["7"]],
      ["amends", "ors-657b.070", ["3"]],
      ["amends", "ors-657b.400", ["6"]],
      ["adds-to", "ors-chapter-657b", ["1"]],
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
      for (const item of items) expect(linksOf(item, ["amends", "repeals", "adds-to"])).toEqual(changes);
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
          ["amends", "ors-653.616", ["8"]],
          ["amends", "ors-653.626", ["9"]],
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
        expect(item.evidence.map((evidence) => [evidence.link_kind, evidence.target_id])).toEqual([
          ["cites", "ors-chapter-657"],
        ]);
      }
    });
  });
});
