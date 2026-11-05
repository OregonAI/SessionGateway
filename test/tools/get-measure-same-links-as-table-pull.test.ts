// Seam 1: get_measure's same_links_as (ADR-0036, ticket #52) beside ticket #22's Statutes Affected Table. A Version says
// same_links_as the Version before it in print order when the Statute Links read from its text are exactly that Version's,
// whatever the table's block beside it and its no_longer_listed flag (ticket #18): its links are then left out, and its own
// block and flag are shown. A Version that was not read is never the same as another.
//
// SB 69's A-Engrossed and Enrolled Versions read the same, to the last measure section (292 links;
// get-measure-statute-links.test.ts), so the Enrolled Version says same_links_as the A-Engrossed one. The table is a
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

// The system serves the documents, which pulls the fixture's 314 files: seconds, more beside the other files' workers.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type VersionEntry = {
  id: string;
  label: string;
  source_url: string;
  no_longer_listed?: boolean;
  same_links_as?: string;
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
    clockAt: "2026-08-05T17:00:00Z",
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

describe("same_links_as beside a made-up Statutes Affected Table", () => {
  it("says same_links_as while no table is held: the Enrolled Version's links are the A-Engrossed Version's", async () => {
    const versions = await versionsOfSb69();

    expect(versionOf(versions, "Enrolled")).toEqual({
      id: "version-2025r1-sb69-enrolled",
      label: "Enrolled",
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Enrolled",
      same_links_as: "version-2025r1-sb69-a-engrossed",
    });
    expect(versionOf(versions, "A-Engrossed").statutes_affected_table).toBeUndefined();
  });

  it("still says same_links_as once the A-Engrossed Version has a table block and the Enrolled Version has none: their links are the same (a made-up table)", async () => {
    // MADE UP: two rows of SB 69 at level A ("653.616 A §8 SB 69 A": ORS 653.616 amended in SECTION 8).
    system.olis.serveDocument(tablePath, madeUpTable(["653.616 A §8 SB 69 A", "659A.159 A §4 SB 69 A"]));
    system.clock.set("2026-08-06T17:00:00Z");
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
    // The Enrolled Version has the same links and no block of its own: it says so, and repeats neither the links nor the block.
    expect(enrolled).toEqual({
      id: "version-2025r1-sb69-enrolled",
      label: "Enrolled",
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Enrolled",
      same_links_as: "version-2025r1-sb69-a-engrossed",
    });
    expect(aEngrossed.text_read).toBe(true);
    expect(triplesOf(aEngrossed.statute_links ?? expectedLinks({}))).toHaveLength(292);
  });
});

// MADE UP: a row for a B-Engrossed Version of SB 69 (the feed has none), served with the fixture's A-Engrossed file, so its
// links are the A-Engrossed Version's; and a made-up table whose one row names it ("SB 69 B"). The B-Engrossed Version then
// says same_links_as the A-Engrossed one beside a table block of its own, which the A-Engrossed Version does not have, and
// the Enrolled Version, whose links are the same again, says same_links_as the B-Engrossed one (ADR-0036).
describe("same_links_as beside a table block of the Version's own", () => {
  const madeUpRow = {
    SessionKey: "2025R1",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    VersionDescription: "B-Engrossed",
    DocumentUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/B-Engrossed",
    CreatedDate: "2025-04-01T10:00:00",
    ModifiedDate: null,
  };
  let own: System;
  const ownClients: ConnectedClient[] = [];

  beforeAll(async () => {
    own = await startSystem({
      clockAt: "2026-08-05T17:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
      statutesAffectedTableUrl: tableUrlOn,
      olis: {
        documentFailures: { [publishedTableUrl]: [404] },
        strayRows: { MeasureDocuments: [madeUpRow] },
        strayDocuments: {
          "/liz/2025R1/Downloads/MeasureDocument/SB69/B-Engrossed": "measure-documents/SB69/A-Engrossed.pdf",
        },
      },
    });
    for (const era of eras) ownClients.push(await connectClient(era, own.handler));
    own.olis.serveDocument(tablePath, madeUpTable(["653.616 A §8 SB 69 B"]));
    own.clock.set("2026-08-06T17:00:00Z");
    await own.pullAgain();
  });

  afterAll(async () => {
    for (const client of ownClients) await client.close();
    await own.stop();
  });

  it("keeps the B-Engrossed Version's own block beside same_links_as, and repeats neither in the Enrolled Version", async () => {
    const answers: LinksBySource[] = [];
    for (const client of ownClients) {
      const outcome = await callTool(client, "get_measure", { measure: "SB 69" });
      expect(outcome.isError, outcome.text).toBe(false);
      answers.push(outcome.structured?.["statute_links_by_source"] as LinksBySource);
    }
    expect(answers[1]).toEqual(answers[0]);
    const versions = answers[0]?.versions ?? [];

    expect(versions.map((version) => [version.label, version.same_links_as])).toEqual([
      ["Introduced", undefined],
      ["A-Engrossed", undefined],
      ["B-Engrossed", "version-2025r1-sb69-a-engrossed"],
      ["Enrolled", "version-2025r1-sb69-b-engrossed"],
    ]);
    const bEngrossed = versionOf(versions, "B-Engrossed");
    expect(bEngrossed.text_read).toBeUndefined();
    expect(bEngrossed.statute_links).toBeUndefined();
    // The block is set beside the links the B-Engrossed Version has, which are the A-Engrossed Version's: the row confirms
    // the amendment of ORS 653.616 in SECTION 8.
    expect(bEngrossed.statutes_affected_table?.compared).toBe(true);
    expect(bEngrossed.statutes_affected_table?.parsed_changes?.amends.sections).toContainEqual(
      confirmed(sectionTarget("ors-653.616", "8")),
    );
    expect(versionOf(versions, "A-Engrossed").statutes_affected_table).toBeUndefined();
    expect(versionOf(versions, "Enrolled").statutes_affected_table).toBeUndefined();
  });
});
