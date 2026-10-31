// Seam 1: get_measure's same_as (#16, fix pass L1) beside ticket #22's Statutes Affected Table. A Version says same_as the
// Version before it in print order only when its whole entry, as an agent would otherwise see it, is that Version's: the
// links read from its text, the table's block beside them, and its no_longer_listed flag (ticket #18). A Version whose
// links are the same and whose table block is not is listed in full.
//
// SB 69's A-Engrossed and Enrolled Versions read the same, to the last measure section (292 links;
// get-measure-statute-links.test.ts), so with no table the Enrolled Version is same_as the A-Engrossed one. The table is a
// MADE-UP TABLE (test/support/made-up-pdf.ts), not the fixture's: two rows of SB 69 at level A, which name the A-Engrossed
// Version and no other, chosen for the case (the real table has nine such rows; get-measure-statutes-affected-table.test.ts).
// A level names one Version, and no level names an Enrolled one (ADR-0033), so the A-Engrossed Version gets a block and the
// Enrolled one none. The first pull finds no table (404), and the made-up one is served for the next. The cases run in the
// order written on one system, and each is asked by a 2026-07-28 client and by a legacy client, which must say the same.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { expectedLinks, triplesOf, type StatuteLinks } from "../support/statute-links.ts";
import {
  chapterTarget,
  confirmed,
  expectedParsedChanges,
  madeUpTable,
  publishedTableUrl,
  sectionTarget,
  tablePath,
  tableUrlOn,
  unconfirmed,
  type TableOfVersion,
} from "../support/statutes-affected-table.ts";
import { startSystem, type System } from "../support/system.ts";

// The system serves the documents, which pulls the fixture's 278 files: seconds, more beside the other files' workers.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type VersionEntry = {
  id: string;
  label: string;
  source_url: string;
  no_longer_listed?: boolean;
  same_as?: string;
  text_read?: boolean;
  not_read_reason?: string | null;
  statute_links?: StatuteLinks;
  statutes_affected_table?: TableOfVersion;
};
type LinksBySource = { versions: VersionEntry[] };

let system: System;
const clients: ConnectedClient[] = [];

beforeAll(async () => {
  system = await startSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
    statutesAffectedTableUrl: tableUrlOn,
    olis: { documentFailures: { [publishedTableUrl]: [404] } },
  });
  for (const era of eras) clients.push(await connectClient(era, system.handler));
});

afterAll(async () => {
  for (const client of clients) await client.close();
  await system.stop();
});

/** SB 69's Versions as both kinds of client read them, which must be the same. */
async function versionsOfSb69(): Promise<VersionEntry[]> {
  const answers: LinksBySource[] = [];
  for (const client of clients) {
    const outcome = await callTool(client, "get_measure", { measure: "SB 69" });
    expect(outcome.isError, outcome.text).toBe(false);
    answers.push(outcome.structured?.["statute_links_by_source"] as LinksBySource);
  }
  expect(answers[1]).toEqual(answers[0]);
  return answers[0]?.versions ?? [];
}

function versionOf(versions: readonly VersionEntry[], label: string): VersionEntry {
  const found = versions.find((version) => version.label === label);
  if (found === undefined) throw new Error(`SB 69 has no ${label} Version`);
  return found;
}

describe("same_as beside a made-up Statutes Affected Table", () => {
  it("says same_as while no table is held: the Enrolled Version's whole entry is the A-Engrossed Version's", async () => {
    const versions = await versionsOfSb69();

    expect(versionOf(versions, "Enrolled")).toEqual({
      id: "version-2025r1-sb69-enrolled",
      label: "Enrolled",
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Enrolled",
      same_as: "version-2025r1-sb69-a-engrossed",
    });
    expect(versionOf(versions, "A-Engrossed").statutes_affected_table).toBeUndefined();
  });

  it("lists the Enrolled Version in full once the A-Engrossed Version has a table block and it has none, though their links are the same (a made-up table)", async () => {
    // MADE UP: two rows of SB 69 at level A ("653.616 A §8 SB 69 A": ORS 653.616 amended in SECTION 8).
    system.olis.serveDocument(tablePath, madeUpTable(["653.616 A §8 SB 69 A", "659A.159 A §4 SB 69 A"]));
    system.clock.set("2026-08-02T17:00:00Z");
    await system.pullAgain();
    expect(system.buildReport()["statutes_affected_table"]).toMatchObject({ outcome: "loaded", held: true });

    const versions = await versionsOfSb69();
    const aEngrossed = versionOf(versions, "A-Engrossed");
    const enrolled = versionOf(versions, "Enrolled");
    // The A-Engrossed Version's block: the two rows confirm two of its eight amendments.
    expect(aEngrossed.statutes_affected_table?.compared).toBe(true);
    expect(aEngrossed.statutes_affected_table?.parsed_changes).toEqual(
      expectedParsedChanges({
        amends: {
          sections: [
            unconfirmed(sectionTarget("ors-657b.070", "3")),
            confirmed(sectionTarget("ors-659a.159", "4")),
            unconfirmed(sectionTarget("ors-659a.165", "5")),
            unconfirmed(sectionTarget("ors-657b.400", "6")),
            unconfirmed(sectionTarget("ors-657b.060", "7")),
            confirmed(sectionTarget("ors-653.616", "8")),
            unconfirmed(sectionTarget("ors-653.626", "9")),
            unconfirmed(sectionTarget("ors-659a.156", "10")),
          ],
        },
        "adds-to": { chapters: [unconfirmed(chapterTarget("ors-chapter-657b", "1"))] },
      }),
    );
    // The Enrolled Version has the same links and no block, so it is not the same entry: it is listed in full.
    expect(enrolled.same_as).toBeUndefined();
    expect(enrolled.statutes_affected_table).toBeUndefined();
    expect(enrolled.text_read).toBe(true);
    expect(enrolled.not_read_reason).toBeNull();
    expect(enrolled.statute_links).toEqual(aEngrossed.statute_links);
    expect(triplesOf(enrolled.statute_links ?? expectedLinks({}))).toHaveLength(292);
  });
});
