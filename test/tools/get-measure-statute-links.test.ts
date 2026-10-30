// Seam 1: what get_measure shows of a Measure's Statute Links, by the Version or Proposed Amendment each was
// read from and the measure section each is in (ticket #13, spec #1 stories 24 and 25), with the whole system
// behind it. One database of the whole fixture serves every case in this file because none of them changes it;
// the cases that need the feed as it stood earlier, or a row the fixture lacks, are in
// get-measure-statute-links-pull.test.ts.
//
// Expected values are literals from the documents as `pdftotext` prints them
// (test/fixtures/olis-2025R1/documents/measure-documents/), read by hand: the lines with "SECTION n." and
// "is amended to read", and the references to ORS.
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

type Link = {
  kind: string;
  target_id: string;
  target_type: "section" | "chapter";
  resolvable_on_oregonai: boolean;
  measure_section: string | null;
};
type VersionEntry = {
  id: string;
  label: string;
  source_url: string;
  text_read: boolean;
  not_read_reason: string | null;
  statute_links: Link[];
};
type Superseded = {
  id: string;
  number: string;
  amended_version: { id: string; label: string };
  later_version: { id: string; label: string };
};
type ByAmendment = { id: string; number: string };
type StatuteLinksBySource = {
  versions: VersionEntry[];
  proposed_amendments: ByAmendment[];
  superseded_amendments: Superseded[];
  note: string;
};

const section = (kind: string, id: string, measureSection: string): Link => ({
  kind,
  target_id: id,
  target_type: "section",
  resolvable_on_oregonai: true,
  measure_section: measureSection,
});
const chapter = (kind: string, id: string, measureSection: string): Link => ({
  kind,
  target_id: id,
  target_type: "chapter",
  resolvable_on_oregonai: false,
  measure_section: measureSection,
});

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

      expect(versions.map((version) => [version.id, version.label, version.text_read])).toEqual([
        ["version-2025r1-sb69-introduced", "Introduced", true],
        ["version-2025r1-sb69-a-engrossed", "A-Engrossed", true],
        ["version-2025r1-sb69-enrolled", "Enrolled", true],
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
      expect(introduced?.statute_links).toEqual([section("cites", "ors-192.245", "1")]);
      const changes = [
        section("amends", "ors-657b.070", "3"),
        section("amends", "ors-659a.159", "4"),
        section("amends", "ors-659a.165", "5"),
        section("amends", "ors-657b.400", "6"),
        section("amends", "ors-657b.060", "7"),
        section("amends", "ors-653.616", "8"),
        section("amends", "ors-653.626", "9"),
        section("amends", "ors-659a.156", "10"),
        chapter("adds-to", "ors-chapter-657b", "1"),
      ];
      expect(aEngrossed?.statute_links.slice(0, 9)).toEqual(changes);
      expect(enrolled?.statute_links.slice(0, 9)).toEqual(changes);
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
      expect(introduced?.statute_links).toEqual([section("cites", "ors-192.245", "1")]);
      expect(aEngrossed?.statute_links).toEqual([
        section("amends", "ors-409.711", "1"),
        section("cites", "ors-192.245", "1"),
      ]);
      const both = [
        section("amends", "ors-409.711", "1"),
        section("amends", "ors-418.808", "2"),
        section("cites", "ors-192.245", "1"),
        section("cites", "ors-418.806", "2"),
        section("cites", "ors-418.808", "2"),
        section("cites", "ors-418.811", "2"),
        section("cites", "ors-418.813", "2"),
        section("cites", "ors-418.816", "2"),
      ];
      expect(bEngrossed?.statute_links).toEqual(both);
      expect(enrolled?.statute_links).toEqual(both);
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
          amended_version: { id: "version-2025r1-sb69-introduced", label: "Introduced" },
          later_version: { id: "version-2025r1-sb69-a-engrossed", label: "A-Engrossed" },
        },
        {
          id: "amendment-2025r1-sb69-2",
          number: "-2",
          amended_version: { id: "version-2025r1-sb69-introduced", label: "Introduced" },
          later_version: { id: "version-2025r1-sb69-a-engrossed", label: "A-Engrossed" },
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
          amended_version: { id: "version-2025r1-hb3795-introduced", label: "Introduced" },
          later_version: { id: "version-2025r1-hb3795-a-engrossed", label: "A-Engrossed" },
        },
        {
          id: "amendment-2025r1-hb3795-a3",
          number: "-A3",
          amended_version: { id: "version-2025r1-hb3795-a-engrossed", label: "A-Engrossed" },
          later_version: { id: "version-2025r1-hb3795-b-engrossed", label: "B-Engrossed" },
        },
      ]);
    });

    it("says where the left-out amendments are and what answers for them", async () => {
      expect((await linksOf("SB 69")).note).toBe(
        "A Proposed Amendment's Statute Links are listed under proposed_amendments only while this index holds no Version later than the one the amendment amends, because the next Version's own Statute Links replace them. The amendments left out are in superseded_amendments, and compare_amendment still answers for each. An amendment whose Version is not known stays in proposed_amendments.",
      );
    });
  });
});
