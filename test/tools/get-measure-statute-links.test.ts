// Seam 1: what get_measure shows of a Measure's Statute Links, by the Version or Proposed Amendment each was
// read from and the measure section each is in (ticket #13, spec #1 stories 24 and 25), with the whole system
// behind it. One database of the whole fixture serves every case in this file because none of them changes it;
// the cases that need the feed as it stood earlier, or a row the fixture lacks, are in
// get-measure-statute-links-pull.test.ts.
//
// Expected values are literals from the documents as `pdftotext` prints them
// (test/fixtures/olis-2025R1/documents/measure-documents/), read by hand: the lines with "SECTION n." and
// "is amended to read", and the references to ORS.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { chapterTarget, expectedLinks, sectionTarget, triplesOf, type StatuteLinks } from "../support/statute-links.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 280 documents.
  system = await startCopiedSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type VersionEntry = {
  id: string;
  label: string;
  source_url: string;
  /** The id of the Version before it in print order, when this one's Statute Links are exactly that Version's and are not repeated. */
  same_links_as?: string;
  text_read?: boolean;
  not_read_reason?: string | null;
  statute_links?: StatuteLinks;
};
type Superseded = {
  id: string;
  number: string;
  amended_version: { id: string | null; label: string; source_url: string | null };
  later_version: { id: string; label: string; source_url: string };
};
type ByAmendment = { id: string; number: string };
type StatuteLinksBySource = {
  versions: VersionEntry[];
  proposed_amendments: ByAmendment[];
  superseded_amendments: Superseded[];
  note: string;
};

describe.for(eras)("get_measure's Statute Links for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  async function linksOf(measure: string): Promise<StatuteLinksBySource> {
    const outcome = await callTool(connected, "get_measure", { measure });
    expect(outcome.isError).toBe(false);
    return outcome.structured?.["statute_links_by_source"] as StatuteLinksBySource;
  }

  // SB 69 (Feed/MeasureDocuments.json): Introduced, A-Engrossed, Enrolled, and the Printed Amendment "Senate
  // Amendments to Introduced", which is not a Version and is not read. Introduced, as pdftotext prints it, has two
  // sections: SECTION 1 ("report in the manner provided by ORS 192.245") and SECTION 2 (repeals section 1 of the
  // Act). A-Engrossed and Enrolled have twelve: SECTION 1 adds section 2 of the Act to ORS chapter 657B,
  // SECTIONS 3 to 10 amend 657B.070, 659A.159, 659A.165, 657B.400, 657B.060, 653.616, 653.626 and 659A.156.
  describe("SB 69", () => {
    it("shows each Version in print order, with the Version it was read from", async () => {
      const { versions } = await linksOf("SB 69");

      expect(versions.map((version) => [version.id, version.label])).toEqual([
        ["version-2025r1-sb69-introduced", "Introduced"],
        ["version-2025r1-sb69-a-engrossed", "A-Engrossed"],
        ["version-2025r1-sb69-enrolled", "Enrolled"],
      ]);
      expect(versions.map((version) => version.source_url)).toEqual([
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/A-Engrossed",
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Enrolled",
      ]);
    });

    it("shows the Introduced Version's one citation, and what the A-Engrossed and Enrolled Versions amend, each with its measure section", async () => {
      const { versions } = await linksOf("SB 69");

      const [introduced, aEngrossed, enrolled] = versions;
      expect(introduced?.statute_links).toEqual(
        expectedLinks({ cites: { sections: [sectionTarget("ors-192.245", "1")] } }),
      );
      expect(introduced?.text_read).toBe(true);
      const changes = [
        sectionTarget("ors-657b.070", "3"),
        sectionTarget("ors-659a.159", "4"),
        sectionTarget("ors-659a.165", "5"),
        sectionTarget("ors-657b.400", "6"),
        sectionTarget("ors-657b.060", "7"),
        sectionTarget("ors-653.616", "8"),
        sectionTarget("ors-653.626", "9"),
        sectionTarget("ors-659a.156", "10"),
      ];
      expect(aEngrossed?.statute_links?.amends).toEqual({ sections: changes, chapters: [] });
      expect(aEngrossed?.statute_links?.["adds-to"]).toEqual({
        sections: [],
        chapters: [chapterTarget("ors-chapter-657b", "1")],
      });
      expect(aEngrossed?.statute_links?.repeals).toEqual({ sections: [], chapters: [] });
      // The Enrolled Version's links are the A-Engrossed Version's, to the last measure section (ADR-0036).
      expect(enrolled?.same_links_as).toBe("version-2025r1-sb69-a-engrossed");
    });

    // ADR-0036: a Version whose reading is the one before it in print order says so and does not list it again. The Enrolled
    // Version of SB 69 repeats the A-Engrossed Version's 292 links (8 amends, 1 adds-to and 283 cites) to the measure
    // section, which was 15,145 characters of the answer (counted in the answer before this change). A Version that
    // differs lists its own: the A-Engrossed Version is not the Introduced one.
    it("does not list the Enrolled Version's links again: it says it is the A-Engrossed Version's", async () => {
      const { versions } = await linksOf("SB 69");

      const enrolled = versions.find((version) => version.id === "version-2025r1-sb69-enrolled");
      expect(enrolled).toEqual({
        id: "version-2025r1-sb69-enrolled",
        label: "Enrolled",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Enrolled",
        same_links_as: "version-2025r1-sb69-a-engrossed",
      });
      const aEngrossed = versions.find((version) => version.id === "version-2025r1-sb69-a-engrossed");
      expect(aEngrossed?.same_links_as).toBeUndefined();
      expect(aEngrossed?.text_read).toBe(true);
      expect(triplesOf(aEngrossed?.statute_links ?? expectedLinks({}))).toHaveLength(292);
    });
  });

  // Finding F6: get_measure used to repeat every link of every Version as an object of five fields, 292 for each of SB 69's
  // A-Engrossed and Enrolled Versions (8 amends, 1 adds-to and 283 cites, counted in the answer before the shape changed),
  // and the answer was more than three times what it had been. The links are now listed once for each target under its
  // kind, with the measure sections it is in, and none is left out. In pdftotext of measure-documents/SB69/A-Engrossed.pdf
  // ORS 657B.060 is named in SECTION 2 ("requirements under ORS 657B.060") and in SECTION 3 ("(a) Violate ORS 657B.060."
  // and "a violation of ORS 657B.060 or this ..."), and amended by SECTION 7; the 283 cites name 261 targets.
  describe("a target linked in more than one measure section", () => {
    it("is listed once under its kind, with each measure section, and no link of the A-Engrossed Version is left out", async () => {
      const { versions } = await linksOf("SB 69");

      const links = versions[1]?.statute_links ?? expectedLinks({});
      expect(versions[1]?.id).toBe("version-2025r1-sb69-a-engrossed");
      const byKind = (kind: "amends" | "repeals" | "adds-to" | "cites"): number =>
        triplesOf(links).filter(([linked]) => linked === kind).length;
      expect([byKind("amends"), byKind("repeals"), byKind("adds-to"), byKind("cites")]).toEqual([8, 0, 1, 283]);
      expect(triplesOf(links)).toHaveLength(292);
      expect(links.cites.sections.length + links.cites.chapters.length).toBe(261);
      expect(links.cites.sections.find((target) => target.target_id === "ors-657b.060")).toEqual(
        sectionTarget("ors-657b.060", "2", "3"),
      );
      expect(links.amends.sections.find((target) => target.target_id === "ors-657b.060")).toEqual(
        sectionTarget("ors-657b.060", "7"),
      );
      for (const group of [links.amends, links.repeals, links["adds-to"], links.cites]) {
        const ids = [...group.sections, ...group.chapters].map((target) => target.target_id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  });

  // HB 3795 (Feed/MeasureDocuments.json): Introduced, A-Engrossed, B-Engrossed, Enrolled, and the Printed Amendments
  // "House Amendments to Introduced" and "Senate Amendments to A-Engrossed". As pdftotext prints them: Introduced has
  // SECTION 1 ("report in the manner provided by ORS 192.245") and SECTION 2 (repeals section 1 of the Act);
  // A-Engrossed has SECTION 1 "ORS 409.711 is amended to read:" with "in the manner provided in ORS 192.245" in
  // subsection (5); B-Engrossed and Enrolled add SECTION 2 "ORS 418.808 is amended to read: ... As used in ORS
  // 418.806 to 418.816". The snapshot holds 418.806, 418.808, 418.811, 418.813 and 418.816 between those ends.
  describe("HB 3795", () => {
    it("shows what each Version amends and cites, and the later ones amending both ORS 409.711 and ORS 418.808 and citing the rest of the range", async () => {
      const { versions } = await linksOf("HB 3795");

      expect(versions.map((version) => version.label)).toEqual([
        "Introduced",
        "A-Engrossed",
        "B-Engrossed",
        "Enrolled",
      ]);
      const [introduced, aEngrossed, bEngrossed, enrolled] = versions;
      expect(introduced?.statute_links).toEqual(
        expectedLinks({ cites: { sections: [sectionTarget("ors-192.245", "1")] } }),
      );
      expect(aEngrossed?.statute_links).toEqual(
        expectedLinks({
          amends: { sections: [sectionTarget("ors-409.711", "1")] },
          cites: { sections: [sectionTarget("ors-192.245", "1")] },
        }),
      );
      const both = expectedLinks({
        amends: { sections: [sectionTarget("ors-409.711", "1"), sectionTarget("ors-418.808", "2")] },
        cites: {
          sections: [
            sectionTarget("ors-192.245", "1"),
            sectionTarget("ors-418.806", "2"),
            sectionTarget("ors-418.808", "2"),
            sectionTarget("ors-418.811", "2"),
            sectionTarget("ors-418.813", "2"),
            sectionTarget("ors-418.816", "2"),
          ],
        },
      });
      expect(bEngrossed?.statute_links).toEqual(both);
      // The Enrolled Version reads the same as the B-Engrossed one, so it says so (ADR-0036).
      expect(enrolled?.same_links_as).toBe("version-2025r1-hb3795-b-engrossed");
      expect(enrolled?.statute_links).toBeUndefined();
    });
  });

  // ADR-0001: "When the next Version is printed, its parse replaces these links for that Measure." This index reads
  // that as a state: an amendment's links are listed while no later Version is held, and with the whole fixture
  // every Measure's later Versions are held. SB 69's -1 and -2 amend Introduced (their numbers have no letter and
  // their headers say "SENATE BILL 69"), and A-Engrossed is held. HB 3795's -1 amends Introduced and its -A3
  // amends A-Engrossed (header "A-ENGROSSED HOUSE BILL 3795"), and B-Engrossed is held.
  describe("the Proposed Amendments of a Measure whose next Version is held", () => {
    it("lists none of SB 69's -1 and -2 among the links, and names the Version that replaces each", async () => {
      const links = await linksOf("SB 69");

      expect(links.proposed_amendments).toEqual([]);
      expect(links.superseded_amendments).toEqual([
        {
          id: "amendment-2025r1-sb69-1",
          number: "-1",
          amended_version: {
            id: "version-2025r1-sb69-introduced",
            label: "Introduced",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
          },
          later_version: {
            id: "version-2025r1-sb69-a-engrossed",
            label: "A-Engrossed",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/A-Engrossed",
          },
        },
        {
          id: "amendment-2025r1-sb69-2",
          number: "-2",
          amended_version: {
            id: "version-2025r1-sb69-introduced",
            label: "Introduced",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
          },
          later_version: {
            id: "version-2025r1-sb69-a-engrossed",
            label: "A-Engrossed",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/A-Engrossed",
          },
        },
      ]);
    });

    it("lists none of HB 3795's -1 and -A3 among the links, each replaced by the next Version", async () => {
      const links = await linksOf("HB 3795");

      expect(links.proposed_amendments).toEqual([]);
      expect(links.superseded_amendments).toEqual([
        {
          id: "amendment-2025r1-hb3795-1",
          number: "-1",
          amended_version: {
            id: "version-2025r1-hb3795-introduced",
            label: "Introduced",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/Introduced",
          },
          later_version: {
            id: "version-2025r1-hb3795-a-engrossed",
            label: "A-Engrossed",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/A-Engrossed",
          },
        },
        {
          id: "amendment-2025r1-hb3795-a3",
          number: "-A3",
          amended_version: {
            id: "version-2025r1-hb3795-a-engrossed",
            label: "A-Engrossed",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/A-Engrossed",
          },
          later_version: {
            id: "version-2025r1-hb3795-b-engrossed",
            label: "B-Engrossed",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/B-Engrossed",
          },
        },
      ]);
    });

    it("says where the left-out amendments are and what answers for them", async () => {
      expect((await linksOf("SB 69")).note).toBe(
        "A Proposed Amendment's Statute Links are listed under proposed_amendments only while this index holds no Version later than the one the amendment amends, because the next Version's own Statute Links replace them. The amendments left out are in superseded_amendments, and compare_amendment still answers for each. An amendment whose Version cannot be named stays in proposed_amendments.",
      );
    });
  });
});
