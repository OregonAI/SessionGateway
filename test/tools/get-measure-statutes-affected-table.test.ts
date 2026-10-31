// Seam 1: what get_measure shows of the Statutes Affected Table beside a Version's parsed Statute Links (ticket #22,
// spec #1 story 29, ADR-0033), with the whole system behind it. The worker loads the fixture's copy of the table
// (documents/reports/artables2025R1.pdf, which the fake OLIS serves at /AutoPubs/artables2025R1.pdf) during the pull,
// and one database of the whole fixture serves every case in this file because none of them changes it. The cases that
// change the table, or the pull, are in get-measure-statutes-affected-table-pull.test.ts.
//
// Expected values are literals read from the table with `pdftotext -layout` (the rows of each Measure, with their ORS
// numbers) and from the Versions as `pdftotext` prints them; neither is computed from the other.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { type StatuteLinks } from "../support/statute-links.ts";
import {
  chapterTarget,
  expectedChanges,
  noChanges,
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
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 278 documents and the table.
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

      expect(shown?.confirmed.amends.sections).toContainEqual(sectionTarget("ors-653.616", "8"));
      expect(shown?.confirmed.amends.sections).toContainEqual(sectionTarget("ors-659a.159", "4"));
      expect(shown?.confirmed["adds-to"].chapters).toEqual([chapterTarget("ors-chapter-657b", "1")]);
    });

    it("shows all nine of the table's rows for the A-Engrossed Version, each confirmed, and no disagreement", async () => {
      const shown = version(await linksOf("SB 69"), "A-Engrossed").statutes_affected_table;

      expect(shown).toEqual({
        compared: true,
        not_compared_reason: null,
        entries: nine,
        confirmed: nine,
        only_in_table: noChanges,
        only_in_parsed_links: noChanges,
      });
    });

    it("leaves the parsed links of the A-Engrossed Version as they are: the table is beside them, never over them", async () => {
      const links = await linksOf("SB 69");
      const aEngrossed = version(links, "A-Engrossed");

      expect(aEngrossed.statute_links.amends.sections.map((target) => target.target_id)).toEqual(
        nine.amends.sections.map((target) => target.target_id),
      );
      expect(aEngrossed.statute_links.cites.sections.length).toBeGreaterThan(200);
    });

    it("says nothing of the Introduced and Enrolled Versions, which no row of the table names: the table's rows are for the A-Engrossed Version", async () => {
      const links = await linksOf("SB 69");

      expect(version(links, "Introduced").statutes_affected_table).toBeUndefined();
      expect(version(links, "Enrolled").statutes_affected_table).toBeUndefined();
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
        entries: expectedChanges({
          amends: { sections: [sectionTarget("ors-409.711", "1"), sectionTarget("ors-418.808", "2")] },
        }),
        confirmed: expectedChanges({
          amends: { sections: [sectionTarget("ors-409.711", "1"), sectionTarget("ors-418.808", "2")] },
        }),
        only_in_table: noChanges,
        only_in_parsed_links: noChanges,
      });
      for (const label of ["Introduced", "A-Engrossed", "Enrolled"]) {
        expect(version(links, label).statutes_affected_table).toBeUndefined();
      }
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

    it("confirms each section of the series that the text adds to", async () => {
      const shown = version(await linksOf("HB 3027"), "Introduced").statutes_affected_table;

      expect(shown).toEqual({
        compared: true,
        not_compared_reason: null,
        entries: expectedChanges({ "adds-to": { sections: series } }),
        confirmed: expectedChanges({ "adds-to": { sections: series } }),
        only_in_table: noChanges,
        only_in_parsed_links: noChanges,
      });
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
