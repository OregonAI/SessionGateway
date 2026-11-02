// Seam 1: what get_measure shows of the Statutes Affected Table beside a Version's parsed Statute Links (ticket #22,
// spec #1 story 29, ADR-0033), with the whole system behind it. The worker loads the fixture's copy of the table
// (documents/reports/artables2025R1.pdf, which the fake OLIS serves at /AutoPubs/artables2025R1.pdf) during the pull,
// and one database of the whole fixture serves every case in this file because none of them changes it. The cases that
// change the table, or the pull, are in get-measure-statutes-affected-table-pull.test.ts.
//
// Expected values are literals read from the table with `pdftotext -layout` (the rows of each Measure, with their ORS
// numbers) and from the Versions as `pdftotext` prints them; neither is computed from the other.
//
// Its database is built by this file and shared by every case. It is not a copy of the run's template, because the
// system names the Statutes Affected Table and the table's address is the fake's origin (test/CLAUDE.md, Database,
// Templates).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { type StatuteLinks } from "../support/statute-links.ts";
import {
  chapterTarget,
  confirmed,
  expectedChanges,
  expectedParsedChanges,
  sectionTarget,
  tableUrlOn,
  tablePath,
  type TableOfMeasure,
  type TableOfVersion,
} from "../support/statutes-affected-table.ts";
import { startSystem, type System } from "../support/system.ts";

vi.setConfig({ testTimeout: 60_000 });

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 280 documents and the table.
  system = await startSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    statutesAffectedTableUrl: tableUrlOn,
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
  same_links_as?: string;
  statute_links: StatuteLinks;
  statutes_affected_table?: TableOfVersion;
};
type LinksBySource = { versions: VersionEntry[]; statutes_affected_table?: TableOfMeasure };

describe.for(eras)("get_measure's Statutes Affected Table for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  async function linksOf(measure: string): Promise<LinksBySource> {
    const outcome = await callTool(connected, "get_measure", { measure });
    expect(outcome.isError).toBe(false);
    return outcome.structured?.["statute_links_by_source"] as LinksBySource;
  }

  function version(links: LinksBySource, label: string): VersionEntry {
    const found = links.versions.find((entry) => entry.label === label);
    if (found === undefined)
      throw new Error(`No ${label} Version among ${links.versions.map((v) => v.label).join(", ")}`);
    return found;
  }

  // SB 69. The table prints nine rows for it, all "SB 69 A": 653.616 A §8, 653.626 A §9, Ch. 657B Add §1, 657B.060 A §7,
  // 657B.070 A §3, 657B.400 A §6, 659A.156 A §10, 659A.159 A §4 and 659A.165 A §5. The ticket names three of them. Its
  // A-Engrossed Version, parsed, amends the eight sections in SECTIONS 3 to 10 and adds section 2 of the Act to ORS
  // chapter 657B in SECTION 1 (get-measure-statute-links.test.ts): every row of the table is a link the text has.
  describe("SB 69", () => {
    const nine = expectedChanges({
      amends: {
        sections: [
          sectionTarget("ors-657b.070", "3"),
          sectionTarget("ors-659a.159", "4"),
          sectionTarget("ors-659a.165", "5"),
          sectionTarget("ors-657b.400", "6"),
          sectionTarget("ors-657b.060", "7"),
          sectionTarget("ors-653.616", "8"),
          sectionTarget("ors-653.626", "9"),
          sectionTarget("ors-659a.156", "10"),
        ],
      },
      "adds-to": { chapters: [chapterTarget("ors-chapter-657b", "1")] },
    });

    it("shows the A-Engrossed Version's links as confirmed by the table: 653.616 §8 and 659A.159 §4 amend, and ORS chapter 657B §1 is added to", async () => {
      const shown = version(await linksOf("SB 69"), "A-Engrossed").statutes_affected_table;

      expect(shown?.parsed_changes?.amends.sections).toContainEqual(confirmed(sectionTarget("ors-653.616", "8")));
      expect(shown?.parsed_changes?.amends.sections).toContainEqual(confirmed(sectionTarget("ors-659a.159", "4")));
      expect(shown?.parsed_changes?.["adds-to"].chapters).toEqual([confirmed(chapterTarget("ors-chapter-657b", "1"))]);
    });

    it("shows the A-Engrossed Version's nine links that change the law, each confirmed by the table, and no disagreement", async () => {
      const shown = version(await linksOf("SB 69"), "A-Engrossed").statutes_affected_table;

      expect(shown).toEqual({
        compared: true,
        not_compared_reason: null,
        parsed_changes: expectedParsedChanges({
          amends: { sections: nine.amends.sections.map(confirmed) },
          "adds-to": { chapters: nine["adds-to"].chapters.map(confirmed) },
        }),
        only_in_table: null,
        only_in_parsed_links: null,
        entries_not_compared: null,
      });
    });

    it("does not list the table's entries a second time: the Version's block has no entries list and no confirmed list", async () => {
      const shown = version(await linksOf("SB 69"), "A-Engrossed").statutes_affected_table;

      expect(Object.keys(shown ?? {}).toSorted()).toEqual([
        "compared",
        "entries_not_compared",
        "not_compared_reason",
        "only_in_parsed_links",
        "only_in_table",
        "parsed_changes",
      ]);
    });

    it("says nothing of the Introduced and Enrolled Versions, which no row of the table names: the table's rows are for the A-Engrossed Version", async () => {
      const links = await linksOf("SB 69");

      expect(version(links, "Introduced").statutes_affected_table).toBeUndefined();
      expect(version(links, "Enrolled").statutes_affected_table).toBeUndefined();
    });

    // ADR-0036 (ticket #52): the Enrolled Version's links are the A-Engrossed Version's, to the last measure section
    // (get-measure-statute-links.test.ts), so it says so though the A-Engrossed Version has a table block and it has none.
    // Listed in full, its entry was 15,145 characters, and SB 69's answer 82,145 with the table against 65,623 without it
    // (measured on the fixture at cee9d03); the Enrolled Version's own entry is back to its id, label and source_url.
    it("says the Enrolled Version's links are the A-Engrossed Version's, though only the A-Engrossed Version has a table block", async () => {
      const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });
      const links = outcome.structured?.["statute_links_by_source"] as LinksBySource;

      expect(version(links, "Enrolled")).toEqual({
        id: "version-2025r1-sb69-enrolled",
        label: "Enrolled",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Enrolled",
        same_links_as: "version-2025r1-sb69-a-engrossed",
      });
      expect(version(links, "A-Engrossed").same_links_as).toBeUndefined();
      expect(outcome.text.length).toBeLessThan(70_000);
    });

    it("says where the table is from and when this index retrieved it, and that it lists the Measure", async () => {
      const table = (await linksOf("SB 69")).statutes_affected_table;

      expect(table?.source_url).toBe(tableUrlOn(system.olis.origin));
      expect(table?.source_url.endsWith(tablePath)).toBe(true);
      // The pull began at 2026-08-01 10:00 Pacific, and retrieved the table then.
      expect(table?.retrieved_at).toBe("2026-08-01T10:00:00-07:00");
      expect(table?.lists_measure).toBe(true);
      expect(table?.other_entries).toEqual([]);
    });
  });

  // HB 3795 -A3 amends ORS 409.711 and 418.808 (spec #1 case (b)). The table prints "409.711 A §1 HB 3795 B" and
  // "418.808 A §2 HB 3795 B": its B-Engrossed Version, which the table names, and not the A-Engrossed one, whose parsed
  // links (one amendment) it does not describe.
  describe("HB 3795", () => {
    it("confirms the B-Engrossed Version's two amendments, and says nothing of its other Versions", async () => {
      const links = await linksOf("HB 3795");

      expect(version(links, "B-Engrossed").statutes_affected_table).toEqual({
        compared: true,
        not_compared_reason: null,
        parsed_changes: expectedParsedChanges({
          amends: {
            sections: [confirmed(sectionTarget("ors-409.711", "1")), confirmed(sectionTarget("ors-418.808", "2"))],
          },
        }),
        only_in_table: null,
        only_in_parsed_links: null,
        entries_not_compared: null,
      });
      for (const label of ["Introduced", "A-Engrossed", "Enrolled"]) {
        expect(version(links, label).statutes_affected_table).toBeUndefined();
      }
    });

    // ADR-0036: the Enrolled Version reads the same as the B-Engrossed one, which has the table's block, so it says
    // same_links_as and repeats neither. Listed in full, its entry was 798 characters (207 without the table, at cee9d03).
    it("says the Enrolled Version's links are the B-Engrossed Version's, though only the B-Engrossed Version has a table block", async () => {
      const enrolled = version(await linksOf("HB 3795"), "Enrolled");

      expect(enrolled.same_links_as).toBe("version-2025r1-hb3795-b-engrossed");
      expect(enrolled.statutes_affected_table).toBeUndefined();
      expect(JSON.stringify(enrolled).length).toBeLessThan(250);
    });
  });

  // HB 3027, never engrossed, adds section 2 of its Act "to and made a part of ORS 345.010 to 345.340", and the table prints
  // one series: "345.010 to) / 345.340 ) Add §1 HB 3027". Both are expanded against the snapshot's ORS section list, which
  // holds these 22 sections from 345.010 to 345.340 (test/fixtures/oregonai-snapshot/snapshot.json).
  describe("HB 3027, whose table row is a series", () => {
    const series = [
      "ors-345.010",
      "ors-345.015",
      "ors-345.017",
      "ors-345.020",
      "ors-345.030",
      "ors-345.035",
      "ors-345.040",
      "ors-345.060",
      "ors-345.070",
      "ors-345.080",
      "ors-345.110",
      "ors-345.113",
      "ors-345.115",
      "ors-345.117",
      "ors-345.120",
      "ors-345.210",
      "ors-345.230",
      "ors-345.240",
      "ors-345.320",
      "ors-345.325",
      "ors-345.330",
      "ors-345.340",
    ].map((id) => sectionTarget(id, "1"));

    it("confirms the sections of the series that the text adds to, and cuts the list at twenty with a count of the two it left out", async () => {
      const shown = version(await linksOf("HB 3027"), "Introduced").statutes_affected_table;

      expect(shown).toEqual({
        compared: true,
        not_compared_reason: null,
        // The series is 22 sections. A list shows twenty targets and says how many sections it left out, so a long
        // series (the table has ranges of hundreds of sections) cannot make the answer grow without a bound.
        parsed_changes: expectedParsedChanges({
          "adds-to": { sections: series.slice(0, 20).map(confirmed), sections_not_shown: 2 },
        }),
        only_in_table: null,
        only_in_parsed_links: null,
        entries_not_compared: null,
      });
    });
  });

  // HB 3723 (ticket #54, which began as the first REAL disagreement of the fixture; ticket #55 ended it). Its Introduced Version is the only one the feed lists, and
  // the table prints ten rows for it, each ending in an E alone, which is the emergency clause here because the feed lists no
  // E-Engrossed Version (get-measure-statutes-affected-table-pull.test.ts): "247.002 A §3", "247.012 A §4", "247.014 A §9",
  // "247.016 R §1", "247.017 A §2", "247.018 R §1", "247.019 A §10", "247.171 A §5", "247.292 A §6" and "247.302 A §7"
  // (artables2025R1.pdf, pdftotext -layout, pages RS25-T-16 and RS25-T-17). The Version's SECTION 1 reads "ORS 247.016 and
  // 247.018 and section 9, chapter 492, Oregon Laws 2023, are repealed", and SECTIONS 2 to 10 amend the eight others.
  describe("HB 3723, whose repeal list a session-law citation follows", () => {
    // Ticket #55 made the parser read the repeal list, so the two repeals at §1 are links the text has and the table confirms.
    // Before it they were only_in_table, and the Version's repeals were empty.
    it("confirms the ten entries: the eight amendments and the two repeals at §1", async () => {
      const links = await linksOf("HB 3723");
      const introduced = version(links, "Introduced");

      expect(introduced.statutes_affected_table).toEqual({
        compared: true,
        not_compared_reason: null,
        parsed_changes: expectedParsedChanges({
          amends: {
            sections: [
              confirmed(sectionTarget("ors-247.017", "2")),
              confirmed(sectionTarget("ors-247.002", "3")),
              confirmed(sectionTarget("ors-247.012", "4")),
              confirmed(sectionTarget("ors-247.171", "5")),
              confirmed(sectionTarget("ors-247.292", "6")),
              confirmed(sectionTarget("ors-247.302", "7")),
              confirmed(sectionTarget("ors-247.014", "9")),
              confirmed(sectionTarget("ors-247.019", "10")),
            ],
          },
          repeals: {
            sections: [confirmed(sectionTarget("ors-247.016", "1")), confirmed(sectionTarget("ors-247.018", "1"))],
          },
        }),
        only_in_table: null,
        only_in_parsed_links: null,
        entries_not_compared: null,
      });
      // The Version's own repeals are what its text says: ORS 247.016 and 247.018, in SECTION 1.
      expect(introduced.statute_links.repeals).toEqual({
        sections: [sectionTarget("ors-247.016", "1"), sectionTarget("ors-247.018", "1")],
        chapters: [],
      });
    });

    it("says the table lists the Measure, and has no entry for any other Version or level", async () => {
      const table = (await linksOf("HB 3723")).statutes_affected_table;

      expect(table?.lists_measure).toBe(true);
      expect(table?.other_entries).toEqual([]);
    });
  });

  // HB 3124 (ticket #54). Its SECTION 1 reads "Section 2 of this 2025 Act is added to and made a part of the wildlife laws", and
  // names no ORS chapter, so the parser reads no link that adds to the law. The table prints "Ch. 496 to) Ch. 501 ) ... Add §1
  // HB 3124 E" (artables2025R1.pdf, pdftotext -layout, page RS25-T-41, the row after HB 2557's): a series of chapters, which
  // is its two ends and the chapters between them that the snapshot's section list holds. The [496, 501] literal comes from
  // the trimmed snapshot fixture, which keeps no section of any chapter 496 to 501: the trim reads an ORS citation, HB 3124's
  // text cites none, and the trim ignores the table's bare chapter numbers (snapshot README, "How the list was taken" 1). The
  // code keeps a series' two ends whether or not the list holds them. ERF at 6c41efefb5 holds sections of chapters 496, 497,
  // 498 and 501 (none of 499 or 500), so the full snapshot would give [496, 497, 498, 501].
  describe("HB 3124, whose text says 'the wildlife laws' and names no chapter", () => {
    it("lists the table's addition to ORS chapters 496 and 501 at §1 as the table's alone, and no parsed link that changes the law", async () => {
      const introduced = version(await linksOf("HB 3124"), "Introduced");

      expect(introduced.statutes_affected_table).toEqual({
        compared: true,
        not_compared_reason: null,
        parsed_changes: null,
        only_in_table: expectedChanges({
          "adds-to": { chapters: [chapterTarget("ors-chapter-496", "1"), chapterTarget("ors-chapter-501", "1")] },
        }),
        only_in_parsed_links: null,
        entries_not_compared: null,
      });
      expect(introduced.statute_links["adds-to"]).toEqual({ sections: [], chapters: [] });
    });
  });

  // HB 3131 amends no ORS section, and the table prints no row for it.
  describe("a Measure the table has no row for", () => {
    it("says the table does not list it, and puts no table beside any Version", async () => {
      const links = await linksOf("HB 3131");

      expect(links.statutes_affected_table?.lists_measure).toBe(false);
      expect(links.statutes_affected_table?.other_entries).toEqual([]);
      for (const entry of links.versions) expect(entry.statutes_affected_table).toBeUndefined();
    });
  });
});
