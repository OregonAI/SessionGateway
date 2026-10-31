// Seam 1: the Statutes Affected Table's loading, and a disagreement between it and the parsed Statute Links (ticket #22,
// ADR-0033 and ADR-0034). The cases change what the fake OLIS serves at the table's address, or the pull, so they build
// systems of their own: a deployment that does not name the table; a table that cannot be had (404, a failing server, a
// file that is not a table) until it can; a table that is loaded, fetched again, withdrawn and then changed; and a
// Version whose text could not be read. A system pulls the fixture's 278 documents, about four seconds, so a system
// serves several cases, which run in the order written and each take the table on from the one before. They are
// read from the top: a case that comes later relies on what the earlier ones did.
//
// The fixture's table agrees with the parsed links of every Version it names (get-measure-statutes-affected-table.test.ts;
// every Measure of the fixture was looked at for a disagreement, and none has one), so the cases that need a
// disagreement serve a MADE-UP TABLE in its place: a PDF the test builds (test/support/made-up-pdf.ts), whose rows are
// SB 69's with some changed, as each row says. Expected values about the real table are literals from `pdftotext -layout`.
//
// "Exactly as it is on main" is shown two ways: the answer carries no `statutes_affected_table` anywhere, and it is equal
// to the answer of a deployment that does not name the table (every other get_measure test runs without the table too).
// Each answer is asked for by a 2026-07-28 client and by a legacy client, and the two must be equal.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { madeUpPdf } from "../support/made-up-pdf.ts";
import { type StatuteLinks } from "../support/statute-links.ts";
import {
  chapterTarget,
  expectedChanges,
  madeUpTable,
  noChanges,
  publishedTableUrl,
  sectionTarget,
  tablePath,
  tableUrlOn,
  type TableOfMeasure,
  type TableOfVersion,
} from "../support/statutes-affected-table.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

// A system serves the documents, which pulls the fixture's 278 files: about four seconds on its own and more beside the
// other files' workers (the default timeout is five seconds).
vi.setConfig({ testTimeout: 60_000 });

type Answer = Record<string, unknown>;
type VersionEntry = { label: string; statute_links: StatuteLinks; statutes_affected_table?: TableOfVersion };
type LinksBySource = { versions: VersionEntry[]; statutes_affected_table?: TableOfMeasure };

const baseOptions = {
  clockAt: "2026-08-01T17:00:00Z",
  documents: true,
  serverEnv: { MCP_RATE_LIMIT: "1000" },
} satisfies SystemOptions;

/** The pull of the system's start: 2026-08-01 10:00 Pacific. The days after it, for the pulls that follow. */
const firstPull = "2026-08-01T10:00:00-07:00";
const nextDay = "2026-08-02T17:00:00Z";
const nextDayPacific = "2026-08-02T10:00:00-07:00";
const dayAfterThat = "2026-08-03T17:00:00Z";

const fixture = (path: string): Uint8Array =>
  readFileSync(new URL(`../fixtures/olis-2025R1/documents/${path}`, import.meta.url));

/** A system, with a client of each kind: what it answers is asked of both, and the two must say the same. */
type Rig = { system: System; ask(measure: string): Promise<Answer>; close(): Promise<void> };

async function openRig(options: Partial<SystemOptions>): Promise<Rig> {
  const system = await startSystem({ ...baseOptions, ...options });
  const clients: ConnectedClient[] = [];
  try {
    for (const era of eras) clients.push(await connectClient(era, system.handler));
  } catch (error) {
    await system.stop();
    throw error;
  }
  return {
    system,
    ask: async (measure) => {
      const answers: Answer[] = [];
      for (const client of clients) {
        const outcome = await callTool(client, "get_measure", { measure });
        expect(outcome.isError).toBe(false);
        answers.push(outcome.structured ?? {});
      }
      expect(answers[1]).toEqual(answers[0]);
      return answers[0] ?? {};
    },
    close: async () => {
      for (const client of clients) await client.close();
      await system.stop();
    },
  };
}

/** A string that holds this text: an asymmetric matcher, typed as the string of the field it stands in for. */
function holding(text: string): string {
  const matcher: unknown = expect.stringContaining(text);
  return matcher as string;
}

const linksOf = (answer: Answer): LinksBySource => answer["statute_links_by_source"] as LinksBySource;
const tableReport = (system: System): Record<string, unknown> | undefined =>
  system.buildReport()["statutes_affected_table"] as Record<string, unknown> | undefined;
const aEngrossed = (links: LinksBySource): VersionEntry => {
  const found = links.versions.find((entry) => entry.label === "A-Engrossed");
  if (found === undefined) throw new Error("SB 69 has no A-Engrossed Version");
  return found;
};
const tableRequests = (system: System): number =>
  system.olis.documentRequests().filter((path) => path === tablePath).length;

const sb69Amends = [
  sectionTarget("ors-657b.070", "3"),
  sectionTarget("ors-659a.159", "4"),
  sectionTarget("ors-659a.165", "5"),
  sectionTarget("ors-657b.400", "6"),
  sectionTarget("ors-657b.060", "7"),
  sectionTarget("ors-653.616", "8"),
  sectionTarget("ors-653.626", "9"),
  sectionTarget("ors-659a.156", "10"),
];

// The deployment that does not name the table is the answer every other deployment must give while it has no table.
let unset: Rig;
let unsetAnswer: Answer;

beforeAll(async () => {
  unset = await openRig({});
  unsetAnswer = await unset.ask("SB 69");
}, 60_000);

afterAll(async () => {
  await unset.close();
});

describe("a deployment that does not name the table", () => {
  it("answers get_measure with no trace of the table, writes no word about it in the build report, and never asks for it", () => {
    expect(JSON.stringify(unsetAnswer)).not.toContain("statutes_affected_table");
    expect(tableReport(unset.system)).toBeUndefined();
    expect(tableRequests(unset.system)).toBe(0);
  });

  // tools/list says the same in every deployment, whether or not it names the table, so what an agent reads there is
  // checked here, where the variable is unset: the field keeps the description it has on main (statute-links.ts of
  // 523eafa), and the one sentence about the table reads as a condition.
  describe.for(eras)("what a %s client reads in tools/list", (era) => {
    type Schema = { description?: string; properties?: Record<string, Schema>; items?: Schema };
    let connected: ConnectedClient;
    let get: { description?: string | undefined; outputSchema?: unknown };

    beforeAll(async () => {
      connected = await connectClient(era, unset.system.handler);
      const found = (await connected.client.listTools()).tools.find((tool) => tool.name === "get_measure");
      if (found === undefined) throw new Error("tools/list has no get_measure");
      get = found;
    });

    afterAll(async () => {
      await connected.close();
    });

    it("keeps main's description of the versions field of statute_links_by_source", () => {
      const links = (get.outputSchema as Schema).properties?.["statute_links_by_source"];

      expect(links?.properties?.["versions"]?.description).toBe(
        "The Measure's Versions that this index holds, in the order they were printed (a Version with no place in that order, such as a minority report's, comes last), each with the Statute Links read from its text. A Printed Amendment is not a Version and is not read.",
      );
    });

    it("describes the table's block on a Version, beside the Version's own fields", () => {
      const links = (get.outputSchema as Schema).properties?.["statute_links_by_source"];
      const version = links?.properties?.["versions"]?.items?.properties;

      expect(Object.keys(version ?? {})).toEqual(
        expect.arrayContaining(["id", "label", "source_url", "statute_links", "statutes_affected_table"]),
      );
      expect(version?.["statutes_affected_table"]?.description).toContain("Statutes Affected Table");
    });

    it("mentions the table in one sentence of the tool's description, which says it is about an index that holds the table", () => {
      const sentences = (get.description ?? "").split(/(?<=\.)\s+(?=[A-Z])/);
      const aboutTable = sentences.filter((sentence) => sentence.includes("Statutes Affected Table"));

      expect(aboutTable).toHaveLength(1);
      expect(aboutTable[0]).toMatch(/^When this index holds Legislative Counsel's Statutes Affected Table\b/);
    });
  });
});

describe("a table that cannot be had", () => {
  let rig: Rig;

  beforeAll(async () => {
    // Legislative Counsel has not published it: the server answers 404 to the first request.
    rig = await openRig({
      statutesAffectedTableUrl: tableUrlOn,
      olis: { documentFailures: { [publishedTableUrl]: [404] } },
    });
  }, 60_000);

  afterAll(async () => {
    await rig.close();
  });

  it("changes nothing while Legislative Counsel answers 404: not published yet", async () => {
    expect(tableRequests(rig.system)).toBe(1);
    expect(await rig.ask("SB 69")).toEqual(unsetAnswer);
    expect(tableReport(rig.system)).toEqual({
      source_url: tableUrlOn(rig.system.olis.origin),
      outcome: "not_published",
      held: false,
    });
  });

  it("changes nothing while the server fails, and says in the build report why the table was not fetched", async () => {
    // Three answers of 503 are the three attempts a file gets (the worker does not wait between them in a test).
    rig.system.olis.failDocuments(publishedTableUrl, [503, 503, 503]);
    await rig.system.pullAgain();

    expect(tableRequests(rig.system)).toBe(1 + 3);
    expect(await rig.ask("SB 69")).toEqual(unsetAnswer);
    expect(tableReport(rig.system)).toMatchObject({ outcome: "not_fetched", held: false });
    expect(String(tableReport(rig.system)?.["reason"])).toContain("503");
  });

  it("changes nothing when what the server gives is not a table: a PDF with text and no row of an ORS table", async () => {
    // SB 69's Introduced Version, served at the table's address: made up for the case.
    rig.system.olis.serveDocument(tablePath, fixture("measure-documents/SB69/Introduced.pdf"));
    await rig.system.pullAgain();

    expect(await rig.ask("SB 69")).toEqual(unsetAnswer);
    expect(tableReport(rig.system)).toMatchObject({ outcome: "not_read", held: false });
    expect(String(tableReport(rig.system)?.["reason"])).toContain("no row of an ORS table");
  });

  it("shows the table from the pull after it is there", async () => {
    rig.system.olis.serveDocument(tablePath, fixture("reports/artables2025R1.pdf"));
    rig.system.clock.set(nextDay);
    await rig.system.pullAgain();

    const table = linksOf(await rig.ask("SB 69")).statutes_affected_table;
    expect(table?.retrieved_at).toBe(nextDayPacific);
    expect(table?.lists_measure).toBe(true);
    expect(aEngrossed(linksOf(await rig.ask("SB 69"))).statutes_affected_table?.confirmed.amends.sections).toEqual(
      sb69Amends,
    );
    expect(tableReport(rig.system)).toMatchObject({ outcome: "loaded", held: true, unread_lines: 0 });
  });
});

// A MADE-UP TABLE, in place of the real one. Its rows are SB 69's, as the real table prints them ("SB 69 A" is the
// A-Engrossed Version), changed one by one:
//   653.616 R §8      the real table says A (amends): the same section and measure section, another kind
//   653.626 A §9      as the real table says it
//   Ch. 657B Add §1   as the real table says it
//   657B.070 A §2     the real table says §3: the same target and kind, another measure section
//   659A.150 A §4     a section SB 69 cites (in the range 659A.150 to 659A.186) and does not amend
//   657B.080 A §5 BCC a level that names no Version (a conference committee report)
//   657B.090 A §6 B   a level that names the B-Engrossed Version, which SB 69 does not have
// and it leaves out 659A.159 §4, 659A.165 §5, 657B.400 §6, 657B.060 §7 and 659A.156 §10, which the text amends.
const madeUpRows = [
  "653.616 R §8 SB 69 A",
  "653.626 A §9 SB 69 A",
  "Ch. 657B Add §1 SB 69 A",
  "657B.070 A §2 SB 69 A",
  "659A.150 A §4 SB 69 A",
  "657B.080 A §5 SB 69 BCC E",
  "657B.090 A §6 SB 69 B",
];

describe("a table that was loaded", () => {
  let rig: Rig;
  let first: LinksBySource;

  beforeAll(async () => {
    rig = await openRig({ statutesAffectedTableUrl: tableUrlOn });
    first = linksOf(await rig.ask("SB 69"));
  }, 60_000);

  afterAll(async () => {
    await rig.close();
  });

  it("was retrieved at the pull that found it", () => {
    expect(first.statutes_affected_table?.retrieved_at).toBe(firstPull);
    expect(tableReport(rig.system)).toMatchObject({ outcome: "loaded", held: true });
  });

  it("is read again only when its bytes change: the same file a day later leaves the retrieval time as it was", async () => {
    rig.system.clock.set(nextDay);
    await rig.system.pullAgain();

    expect(tableRequests(rig.system)).toBe(2);
    expect(tableReport(rig.system)).toMatchObject({ outcome: "unchanged", held: true });
    expect(linksOf(await rig.ask("SB 69"))).toEqual(first);
  });

  it("keeps its last copy when the server answers 404 after it was loaded", async () => {
    rig.system.olis.failDocuments(publishedTableUrl, [404]);
    rig.system.clock.set(dayAfterThat);
    await rig.system.pullAgain();

    expect(tableReport(rig.system)).toMatchObject({ outcome: "not_published", held: true });
    expect(linksOf(await rig.ask("SB 69"))).toEqual(first);
  });

  it("shows both sides of every disagreement unchanged, a link both sources have as confirmed, and the entries that name no Version apart (a made-up table)", async () => {
    const before = aEngrossed(first);
    expect(before.statutes_affected_table?.confirmed.amends.sections).toHaveLength(8);

    rig.system.olis.serveDocument(tablePath, madeUpTable(madeUpRows));
    rig.system.clock.set("2026-08-04T17:00:00Z");
    await rig.system.pullAgain();

    const links = linksOf(await rig.ask("SB 69"));
    const after = aEngrossed(links);
    expect(after.statutes_affected_table).toEqual({
      compared: true,
      not_compared_reason: null,
      // The table's rows for the A-Engrossed Version, by what they do and listed by measure section.
      entries: expectedChanges({
        amends: {
          sections: [
            sectionTarget("ors-657b.070", "2"),
            sectionTarget("ors-659a.150", "4"),
            sectionTarget("ors-653.626", "9"),
          ],
        },
        repeals: { sections: [sectionTarget("ors-653.616", "8")] },
        "adds-to": { chapters: [chapterTarget("ors-chapter-657b", "1")] },
      }),
      // Both sources have these two.
      confirmed: expectedChanges({
        amends: { sections: [sectionTarget("ors-653.626", "9")] },
        "adds-to": { chapters: [chapterTarget("ors-chapter-657b", "1")] },
      }),
      // The table says 653.616 is repealed in §8, 657B.070 is amended in §2 and 659A.150 is amended in §4; the text does not.
      only_in_table: expectedChanges({
        amends: { sections: [sectionTarget("ors-657b.070", "2"), sectionTarget("ors-659a.150", "4")] },
        repeals: { sections: [sectionTarget("ors-653.616", "8")] },
      }),
      // The text amends these seven, 653.616 in §8 (which the table says is repealed) and 657B.070 in §3 (which it says is §2)
      // among them, and the table has no entry for them.
      only_in_parsed_links: expectedChanges({
        amends: {
          sections: [
            sectionTarget("ors-657b.070", "3"),
            sectionTarget("ors-659a.159", "4"),
            sectionTarget("ors-659a.165", "5"),
            sectionTarget("ors-657b.400", "6"),
            sectionTarget("ors-657b.060", "7"),
            sectionTarget("ors-653.616", "8"),
            sectionTarget("ors-659a.156", "10"),
          ],
        },
      }),
    });
    // The parsed links of the Version are what they were before the table changed: nothing the table says overwrites them.
    expect(after.statute_links).toEqual(before.statute_links);
    expect(after.statute_links.amends.sections).toEqual(sb69Amends);

    // The bytes changed, so the new table was read and its retrieval time is the pull that found it.
    expect(links.statutes_affected_table?.retrieved_at).toBe("2026-08-04T10:00:00-07:00");
    expect(links.statutes_affected_table?.lists_measure).toBe(true);
    expect(links.statutes_affected_table?.other_entries).toEqual([
      {
        level: "BCC",
        version: null,
        reason: holding('"BCC"'),
        entries: expectedChanges({ amends: { sections: [sectionTarget("ors-657b.080", "5")] } }),
      },
      {
        level: "B",
        version: "B-Engrossed",
        reason: holding("B-Engrossed"),
        entries: expectedChanges({ amends: { sections: [sectionTarget("ors-657b.090", "6")] } }),
      },
    ]);
    for (const label of ["Introduced", "Enrolled"]) {
      expect(links.versions.find((entry) => entry.label === label)?.statutes_affected_table).toBeUndefined();
    }
    expect(tableReport(rig.system)).toMatchObject({ outcome: "loaded", held: true, entries: 7, unread_lines: 0 });
  });

  it("replaced the table it held: the made-up table has no row for HB 3795, which the real one has", async () => {
    const hb3795 = linksOf(await rig.ask("HB 3795"));

    expect(hb3795.statutes_affected_table?.lists_measure).toBe(false);
    expect(hb3795.versions.every((entry) => entry.statutes_affected_table === undefined)).toBe(true);
  });
});

// MADE UP, as get-measure-statute-links-pull.test.ts makes them up: rows for a B-Engrossed and a C-Engrossed Version of
// SB 69 (the feed has neither). B-Engrossed is served with the fixture's scan (Exhibit 288141, a PDF with no text layer), so
// that the index holds the Version and has read nothing of it. C-Engrossed's file is not served until the second case, and
// is a PDF the test builds: no Version of the fixture repeals an ORS section, and a repeal is the table's "R". A made-up
// table, served from the pull after, names each Version.
const versionRow = (description: string): Record<string, unknown> => ({
  SessionKey: "2025R1",
  MeasurePrefix: "SB",
  MeasureNumber: 69,
  VersionDescription: description,
  DocumentUrl: `https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/${description}`,
  CreatedDate: "2025-03-01T10:00:00",
  ModifiedDate: null,
});

describe("Versions this index could not read, and one made up to repeal", () => {
  let rig: Rig;

  beforeAll(async () => {
    rig = await openRig({
      statutesAffectedTableUrl: tableUrlOn,
      olis: {
        strayRows: { MeasureDocuments: [versionRow("B-Engrossed"), versionRow("C-Engrossed")] },
        strayDocuments: {
          "/liz/2025R1/Downloads/MeasureDocument/SB69/B-Engrossed": "committee-meeting-documents/288141.pdf",
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await rig.close();
  });

  it("lists the table's entries for a Version with no text layer and says there is nothing to set them beside, instead of calling every one a disagreement", async () => {
    rig.system.olis.serveDocument(tablePath, madeUpTable(["653.616 A §8 SB 69 B", "657B.090 A §6 SB 69 B"]));
    rig.system.clock.set(nextDay);
    await rig.system.pullAgain();

    const links = linksOf(await rig.ask("SB 69"));
    const scan = links.versions.find((entry) => entry.label === "B-Engrossed");
    expect(scan?.statutes_affected_table).toEqual({
      compared: false,
      not_compared_reason: holding("did not read"),
      entries: expectedChanges({
        amends: { sections: [sectionTarget("ors-657b.090", "6"), sectionTarget("ors-653.616", "8")] },
      }),
      confirmed: noChanges,
      only_in_table: noChanges,
      only_in_parsed_links: noChanges,
    });
    // The index holds the Version, so there is nothing left over for the entries to be listed apart.
    expect(links.statutes_affected_table?.other_entries).toEqual([]);
    // C-Engrossed is listed by the feed and its file did not come, so the table's entries for it (none yet) have no Version to go beside.
    expect(links.versions.map((entry) => entry.label)).not.toContain("C-Engrossed");
  });

  it("sets the table's R beside a repeal the text makes, its A beside an amendment, and shows a repeal only the table has", async () => {
    // The Version's text, one line to a row of the page: SECTION 1 repeals ORS 653.616, SECTION 2 amends ORS 653.626.
    rig.system.olis.serveDocument(
      "/liz/2025R1/Downloads/MeasureDocument/SB69/C-Engrossed",
      madeUpPdf([
        [
          "C-ENGROSSED SENATE BILL 69 (MADE UP)",
          "SECTION 1. ORS 653.616 is repealed.",
          "SECTION 2. ORS 653.626 is amended to read:",
          "653.626. An employee may use sick time.",
        ],
      ]),
    );
    rig.system.olis.serveDocument(
      tablePath,
      madeUpTable(["653.616 R §1 SB 69 C", "653.626 A §2 SB 69 C", "653.646 R §3 SB 69 C"]),
    );
    rig.system.clock.set(dayAfterThat);
    await rig.system.pullAgain();

    const links = linksOf(await rig.ask("SB 69"));
    const made = links.versions.find((entry) => entry.label === "C-Engrossed");
    expect(made?.statute_links.repeals.sections).toEqual([sectionTarget("ors-653.616", "1")]);
    expect(made?.statutes_affected_table).toEqual({
      compared: true,
      not_compared_reason: null,
      entries: expectedChanges({
        amends: { sections: [sectionTarget("ors-653.626", "2")] },
        repeals: { sections: [sectionTarget("ors-653.616", "1"), sectionTarget("ors-653.646", "3")] },
      }),
      confirmed: expectedChanges({
        amends: { sections: [sectionTarget("ors-653.626", "2")] },
        repeals: { sections: [sectionTarget("ors-653.616", "1")] },
      }),
      only_in_table: expectedChanges({ repeals: { sections: [sectionTarget("ors-653.646", "3")] } }),
      only_in_parsed_links: noChanges,
    });
  });
});
