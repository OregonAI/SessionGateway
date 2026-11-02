// Seam 1: the Statutes Affected Table's loading, and a disagreement between it and the parsed Statute Links (ticket #22,
// ADR-0033 and ADR-0034). The cases change what the fake OLIS serves at the table's address, or the pull, so they build
// systems of their own: a deployment that does not name the table; a table that cannot be had (404, a failing server, a
// file that is not a table, refused again without a second reading) until it can; a table that is loaded, fetched again,
// withdrawn and then changed; a Version whose text could not be read; and made-up tables in shapes the real one never
// shows (the last describe: a line the parser cannot read, a footer date in November, overturned vetoes, an E alone for a
// Measure with an E-Engrossed Version in the feed, which the real table never shows: HB 3723 and HB 3124 have an E alone and
// no E-Engrossed Version, and the case that has one is MADE UP). A system pulls the fixture's 280 documents, about four
// seconds, so a system serves several cases, which run in the order written and each take the table on from the one
// before. They are read from the top: a case that comes later relies on what the earlier ones did.
//
// The fixture's table disagrees with the parsed links of two Measures, both real (ticket #54): HB 3723, whose two repeals
// at §1 the parser does not read (until #55), and HB 3124, whose text names no chapter where the table adds to two
// (get-measure-statutes-affected-table.test.ts holds what each shows). Both disagreements are one-sided, entries the text
// lacks, so the cases that need a shape the real table never shows (a kind that differs, a measure section that differs, an
// entry at a level that names no Version of the Measure, a list long enough to cut) serve a MADE-UP TABLE in its place: a
// PDF the test builds (test/support/made-up-pdf.ts), whose rows are SB 69's with some changed, as each row says. Expected
// values about the real table are literals from `pdftotext -layout`.
//
// "Exactly as it is on main" is shown two ways: the answer carries no `statutes_affected_table` anywhere, and it is equal
// to the answer of a deployment that does not name the table (every other get_measure test runs without the table too).
// Each answer is asked for by a 2026-07-28 client and by a legacy client, and the two must be equal.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { madeUpPdf } from "../support/made-up-pdf.ts";
import { noLinks, type StatuteLinks } from "../support/statute-links.ts";
import {
  chapterTarget,
  confirmed,
  expectedChanges,
  expectedParsedChanges,
  madeUpTable,
  madeUpTablePages,
  publishedTableUrl,
  sectionTarget,
  tablePath,
  tableUrlOn,
  unconfirmed,
  type TableOfMeasure,
  type TableOfVersion,
} from "../support/statutes-affected-table.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

// A system serves the documents, which pulls the fixture's 280 files: about four seconds on its own and more beside the
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
/** The path a made-up Version's file is served at: where the fixture's rows put the Versions of a Measure. */
const versionPathOf = (prefix: string, number: number, description: string): string =>
  `/liz/2025R1/Downloads/MeasureDocument/${prefix}${String(number)}/${description}`;
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
        "The Measure's Versions that this index holds, in the order they were printed (a Version with no place in that order, such as a minority report's, comes last), each with the Statute Links read from its text, or with same_links_as when the text was read and its Statute Links are exactly those of the Version before it (an Enrolled Version that repeats the last Engrossed one). Each Version shows its own Statutes Affected Table block and its own no_longer_listed either way. A Printed Amendment is not a Version and is not read.",
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

  it("does not read the same refused bytes again at the next pull, whether they are a PDF with no table in it or no PDF at all", async () => {
    // The Version's file is still what the server gives at the table's address (the case before): the pull finds the bytes
    // it refused and says so, without extracting them again, as it does not read a table it holds again.
    await rig.system.pullAgain();
    expect(tableReport(rig.system)).toMatchObject({ outcome: "refused_unchanged", held: false });
    expect(String(tableReport(rig.system)?.["reason"])).toContain("no row of an ORS table");
    expect(await rig.ask("SB 69")).toEqual(unsetAnswer);

    // Bytes that are no PDF are refused at their first pull and not looked at again at the second.
    rig.system.olis.serveDocument(tablePath, new TextEncoder().encode("this is a placeholder, not a table"));
    await rig.system.pullAgain();
    expect(tableReport(rig.system)).toMatchObject({ outcome: "not_read", held: false });
    await rig.system.pullAgain();
    expect(tableReport(rig.system)).toMatchObject({ outcome: "refused_unchanged", held: false });
    expect(await rig.ask("SB 69")).toEqual(unsetAnswer);
  });

  it("shows the table from the pull after it is there", async () => {
    rig.system.olis.serveDocument(tablePath, fixture("reports/artables2025R1.pdf"));
    rig.system.clock.set(nextDay);
    await rig.system.pullAgain();

    const table = linksOf(await rig.ask("SB 69")).statutes_affected_table;
    expect(table?.retrieved_at).toBe(nextDayPacific);
    expect(table?.lists_measure).toBe(true);
    expect(
      aEngrossed(linksOf(await rig.ask("SB 69"))).statutes_affected_table?.parsed_changes?.amends.sections,
    ).toEqual(sb69Amends.map(confirmed));
    expect(tableReport(rig.system)).toMatchObject({ outcome: "loaded", held: true, unread_lines: 0 });
  });
});

// A MADE-UP TABLE, in place of the real one. WHY IT STAYS (ticket #54): the real table's disagreements, HB 3723's and HB 3124's, are
// both entries the text lacks (a repeal list the parser misses, a chapter the text does not name). None has a kind that
// differs from the text's for the same section, a measure section that differs, an entry for a section the Measure cites and
// does not change, or an entry at a level that names no Version the Measure has, and a case about the shape of one needs a row
// of that shape. Its rows are SB 69's, as the real table prints them ("SB 69 A" is the
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

  // REAL ROWS (ticket #54), read while the real table is held. HB 3723's table rows repeal ORS 247.016 and 247.018 at §1, and
  // the text of its Introduced Version, which the parser does not read as a repeal until #55, has no repeal; HB 3124's row adds
  // to ORS chapters 496 and 501 at §1, and its text names no chapter. A table that overwrote the Version's links would show
  // in them. The expected links are read from the deployment that names no table, which has the same Versions and never saw one.
  // HB 3723's half is TODAY'S BEHAVIOUR, not the right answer: once #55 reads its repeal list, its repeals are no longer a
  // disagreement, the two asserts on it below (no parsed repeals, the repeals in only_in_table) move, and HB 3124 alone carries
  // the never-overwrite case, which stays true.
  it("leaves HB 3723's and HB 3124's parsed links as the text has them when the real table says otherwise: the table is beside them, never over them (HB 3723's half is today's behaviour; the parser fix is #55)", async () => {
    for (const measure of ["HB 3723", "HB 3124"]) {
      const shown = linksOf(await rig.ask(measure)).versions.map((entry) => [entry.label, entry.statute_links]);
      const onMain = linksOf(await unset.ask(measure)).versions.map((entry) => [entry.label, entry.statute_links]);

      expect(shown).toEqual(onMain);
    }
    const hb3723 = linksOf(await rig.ask("HB 3723")).versions[0];
    const hb3124 = linksOf(await rig.ask("HB 3124")).versions[0];
    // TODAY'S BEHAVIOUR (HB 3723, until #55):
    expect(hb3723?.statute_links.repeals).toEqual(noLinks.repeals);
    expect(hb3723?.statutes_affected_table?.only_in_table?.repeals.sections.map((target) => target.target_id)).toEqual([
      "ors-247.016",
      "ors-247.018",
    ]);
    // HB 3124, which stays a disagreement after #55:
    expect(hb3124?.statute_links["adds-to"]).toEqual(noLinks["adds-to"]);
    expect(
      hb3124?.statutes_affected_table?.only_in_table?.["adds-to"].chapters.map((target) => target.target_id),
    ).toEqual(["ors-chapter-496", "ors-chapter-501"]);
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
    expect(before.statutes_affected_table?.parsed_changes?.amends.sections).toHaveLength(8);

    rig.system.olis.serveDocument(tablePath, madeUpTable(madeUpRows));
    rig.system.clock.set("2026-08-04T17:00:00Z");
    await rig.system.pullAgain();

    const links = linksOf(await rig.ask("SB 69"));
    const after = aEngrossed(links);
    expect(after.statutes_affected_table).toEqual({
      compared: true,
      not_compared_reason: null,
      // The Version's parsed links that change the law, once each, and whether the table has an entry for each. The table
      // confirms 653.626 in §9 and ORS chapter 657B in §1 (as the real table says it); it has no entry for the other seven
      // (653.616 in §8 among them, which it says is repealed, and 657B.070 in §3, which it says is §2).
      parsed_changes: expectedParsedChanges({
        amends: {
          sections: [
            unconfirmed(sectionTarget("ors-657b.070", "3")),
            unconfirmed(sectionTarget("ors-659a.159", "4")),
            unconfirmed(sectionTarget("ors-659a.165", "5")),
            unconfirmed(sectionTarget("ors-657b.400", "6")),
            unconfirmed(sectionTarget("ors-657b.060", "7")),
            unconfirmed(sectionTarget("ors-653.616", "8")),
            confirmed(sectionTarget("ors-653.626", "9")),
            unconfirmed(sectionTarget("ors-659a.156", "10")),
          ],
        },
        "adds-to": { chapters: [confirmed(chapterTarget("ors-chapter-657b", "1"))] },
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
      entries_not_compared: null,
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

  // MADE UP: twenty-five rows for SB 69's A-Engrossed Version, for ORS sections its text does not amend (100.001 to
  // 100.025, all in §2). A list shows twenty targets, and says how many it left out.
  it("cuts a long list of the table's entries the text lacks at twenty targets, and says how many it left out (a made-up table)", async () => {
    rig.system.olis.serveDocument(
      tablePath,
      madeUpTable([
        "100.001 A §2 SB 69 A",
        "100.002 A §2 SB 69 A",
        "100.003 A §2 SB 69 A",
        "100.004 A §2 SB 69 A",
        "100.005 A §2 SB 69 A",
        "100.006 A §2 SB 69 A",
        "100.007 A §2 SB 69 A",
        "100.008 A §2 SB 69 A",
        "100.009 A §2 SB 69 A",
        "100.010 A §2 SB 69 A",
        "100.011 A §2 SB 69 A",
        "100.012 A §2 SB 69 A",
        "100.013 A §2 SB 69 A",
        "100.014 A §2 SB 69 A",
        "100.015 A §2 SB 69 A",
        "100.016 A §2 SB 69 A",
        "100.017 A §2 SB 69 A",
        "100.018 A §2 SB 69 A",
        "100.019 A §2 SB 69 A",
        "100.020 A §2 SB 69 A",
        "100.021 A §2 SB 69 A",
        "100.022 A §2 SB 69 A",
        "100.023 A §2 SB 69 A",
        "100.024 A §2 SB 69 A",
        "100.025 A §2 SB 69 A",
      ]),
    );
    rig.system.clock.set("2026-08-06T17:00:00Z");
    await rig.system.pullAgain();

    const shown = aEngrossed(linksOf(await rig.ask("SB 69"))).statutes_affected_table;

    expect(shown?.only_in_table?.amends.sections.map((target) => target.target_id)).toEqual([
      "ors-100.001",
      "ors-100.002",
      "ors-100.003",
      "ors-100.004",
      "ors-100.005",
      "ors-100.006",
      "ors-100.007",
      "ors-100.008",
      "ors-100.009",
      "ors-100.010",
      "ors-100.011",
      "ors-100.012",
      "ors-100.013",
      "ors-100.014",
      "ors-100.015",
      "ors-100.016",
      "ors-100.017",
      "ors-100.018",
      "ors-100.019",
      "ors-100.020",
    ]);
    expect(shown?.only_in_table?.amends.sections_not_shown).toBe(5);
    expect(shown?.only_in_table?.amends.chapters_not_shown).toBeUndefined();
    // The eight sections its text amends are listed whole, with the table's nine rows for them gone: nothing is cut there.
    expect(shown?.only_in_parsed_links?.amends.sections).toHaveLength(8);
    expect(shown?.only_in_parsed_links?.amends.sections_not_shown).toBeUndefined();
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
// is a PDF the test builds: no Version of the fixture has a parsed repeal of an ORS section (HB 3723 §1 repeals 247.016 and
// 247.018, which the parser does not read until #55), and a repeal is the table's "R". A made-up
// table, served from the pull after, names each Version.
const versionRowOf = (prefix: string, number: number, description: string): Record<string, unknown> => ({
  SessionKey: "2025R1",
  MeasurePrefix: prefix,
  MeasureNumber: number,
  VersionDescription: description,
  DocumentUrl: `https://olis.oregonlegislature.gov${versionPathOf(prefix, number, description)}`,
  CreatedDate: "2025-03-01T10:00:00",
  ModifiedDate: null,
});
const versionRow = (description: string): Record<string, unknown> => versionRowOf("SB", 69, description);

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
      parsed_changes: null,
      only_in_table: null,
      only_in_parsed_links: null,
      // With nothing parsed to set them beside, the table's entries for the Version are listed here and nowhere else.
      entries_not_compared: expectedChanges({
        amends: { sections: [sectionTarget("ors-657b.090", "6"), sectionTarget("ors-653.616", "8")] },
      }),
    });
    // The index holds the Version, so there is nothing left over for the entries to be listed apart.
    expect(links.statutes_affected_table?.other_entries).toEqual([]);
    // C-Engrossed is listed by the feed and its file did not come, so the table's entries for it (none yet) have no Version to go beside.
    expect(links.versions.map((entry) => entry.label)).not.toContain("C-Engrossed");
  });

  it("sets the table's R beside a repeal the text makes, its A beside an amendment, and shows a repeal only the table has", async () => {
    // MADE UP, and it stays made up (ticket #54): the row "653.646 R §3 SB 69 C" is a repeal only the table has, which HB 3723's
    // real §1 repeals are today. They are not a like-for-like replacement, because #55 makes the parser read them and they stop
    // being a disagreement, which would break this case; this one has to survive #55. It also needs the table's R beside a
    // repeal the text makes (653.616), which HB 3723's text, with no parsed repeal, cannot give.
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
      parsed_changes: expectedParsedChanges({
        amends: { sections: [confirmed(sectionTarget("ors-653.626", "2"))] },
        repeals: { sections: [confirmed(sectionTarget("ors-653.616", "1"))] },
      }),
      only_in_table: expectedChanges({ repeals: { sections: [sectionTarget("ors-653.646", "3")] } }),
      only_in_parsed_links: null,
      entries_not_compared: null,
    });
  });
});

// MADE UP TABLES, in shapes the 2025R1 table never shows (its ORS table has no line the parser cannot read, no page dated
// in November, no overturned veto and no engrossing level past C). Each case serves a table of its own to one system, as the
// rows say, and asks of the Measures of the fixture the rows name. The pull that follows reads the new bytes; the build
// report says how many lines the parser left unread. The first pull finds the table not published (404), so nothing of the
// real table is loaded.
describe("a made-up table in shapes the 2025R1 table never shows", () => {
  let rig: Rig;
  let day = 10;

  beforeAll(async () => {
    rig = await openRig({
      statutesAffectedTableUrl: tableUrlOn,
      olis: { documentFailures: { [publishedTableUrl]: [404] } },
    });
  }, 60_000);

  afterAll(async () => {
    await rig.close();
  });

  /** Serves a table, pulls it on a later day, and returns what a client reads of each Measure asked for. */
  async function serve(bytes: Uint8Array, measures: readonly string[]): Promise<Record<string, LinksBySource>> {
    rig.system.olis.serveDocument(tablePath, bytes);
    day += 1;
    rig.system.clock.set(`2026-08-${String(day)}T17:00:00Z`);
    await rig.system.pullAgain();
    const read: Record<string, LinksBySource> = {};
    for (const measure of measures) read[measure] = linksOf(await rig.ask(measure));
    return read;
  }

  const lists = (links: LinksBySource | undefined): boolean | undefined =>
    links?.statutes_affected_table?.lists_measure;

  /** The table's entries for a Version as [kind, target, measure section], whether or not the text agrees: the confirmed links and the ones only in the table. */
  function tableEntriesOf(links: LinksBySource | undefined, label: string): [string, string, string | undefined][] {
    const block = links?.versions.find((entry) => entry.label === label)?.statutes_affected_table;
    const kinds = ["amends", "repeals", "adds-to"] as const;
    const asEntries = (
      kind: string,
      targets: readonly { target_id: string; measure_sections: (string | null)[] }[],
    ): [string, string, string | undefined][] =>
      targets.flatMap((target) =>
        target.measure_sections.map((section): [string, string, string | undefined] => [
          kind,
          target.target_id,
          section ?? undefined,
        ]),
      );
    const confirmedByTable = kinds.flatMap((kind) => {
      const parsed = block?.parsed_changes?.[kind];
      return asEntries(
        kind,
        [...(parsed?.sections ?? []), ...(parsed?.chapters ?? [])].filter((t) => t.confirmed_by_table),
      );
    });
    const onlyInTable = kinds.flatMap((kind) => {
      const listed = block?.only_in_table?.[kind];
      return asEntries(kind, [...(listed?.sections ?? []), ...(listed?.chapters ?? [])]);
    });
    return [...confirmedByTable, ...onlyInTable];
  }

  // An ORS row the parser cannot read (two levels after the Measure, which the legend has no form for; four tokens, which
  // no row has), and a series that is begun and never closed. The rows after each, which omit their ORS number, belong to
  // the number the unread row printed, which is not known: they are left unread, not filed under the row before.
  it("leaves the continuation rows of an unread row unread, and files none of them under the row before it", async () => {
    const read = await serve(
      madeUpTable([
        "653.601 A §3 HB 3795 B",
        "653.616 A §8 SB 69 B C",
        "A §1 SB 121 A",
        "A §2 HB 3027",
        "653.626 A §9 SB 69 A",
        "A §4 SB 983 A",
        "653.646 A §7 SB 69 A B C D",
        "A §3 SB 64",
        "659A.150 to)",
        "A §5 SB 983 A",
      ]),
      ["SB 69", "SB 121", "HB 3027", "SB 983", "SB 64"],
    );

    // Not filed under 653.601, 653.626 or any other number: a Measure whose only rows came after an unread row has none.
    expect(lists(read["SB 121"])).toBe(false);
    expect(lists(read["HB 3027"])).toBe(false);
    expect(lists(read["SB 64"])).toBe(false);
    // The row that follows an unread row and has its own number is read, and so is its continuation row.
    const sb983 = aEngrossed(read["SB 983"] as LinksBySource).statutes_affected_table;
    expect(sb983?.only_in_table?.amends.sections).toEqual([sectionTarget("ors-653.626", "4")]);
    expect(
      aEngrossed(read["SB 69"] as LinksBySource).statutes_affected_table?.parsed_changes?.amends.sections,
    ).toContainEqual(confirmed(sectionTarget("ors-653.626", "9")));
    // Three entries were read (653.601 HB 3795, 653.626 SB 69, 653.626 SB 983), and seven lines left unread.
    expect(tableReport(rig.system)).toMatchObject({ outcome: "loaded", entries: 3, unread_lines: 7 });
  });

  // The footer of every page of the table is its date, which PDF.js writes straight after the last row. A date with a
  // one- or two-digit month or day can be mistaken for the end of the Measure number before it ("SB 69" and "11/3/2027"
  // are "SB 6911/3/2027", which also ends in the date "1/3/2027"). The date every page ends with is the table's.
  it("reads the last row of each page when the table is dated in November: the 1 of 11/3/2027 is the month's, not the Measure number's", async () => {
    // MADE UP: two pages, each ending in a Measure and 11/3/2027 with no line end, as 2025R1's 8/19/2025 does:
    // "SB 6911/3/2027" and "HB 313111/3/2027" (HB 2464 and SB 69 are the review's; the fixture holds SB 69 and HB 3131).
    const read = await serve(
      madeUpTablePages(
        [
          ["409.711 A §1 HB 3795 B", "653.626 A §9 SB 69"],
          ["418.808 A §2 HB 3795 B", "659A.159 A §4 HB 3131"],
        ],
        "11/3/2027",
      ),
      ["SB 69", "HB 3131", "HB 3795"],
    );

    expect(tableEntriesOf(read["SB 69"], "Introduced")).toEqual([["amends", "ors-653.626", "9"]]);
    expect(tableEntriesOf(read["HB 3131"], "Introduced")).toEqual([["amends", "ors-659a.159", "4"]]);
    expect(tableEntriesOf(read["HB 3795"], "B-Engrossed")).toEqual([
      ["amends", "ors-409.711", "1"],
      ["amends", "ors-418.808", "2"],
    ]);
    expect(tableReport(rig.system)).toMatchObject({ outcome: "loaded", entries: 4, unread_lines: 0 });
  });

  // This is the case a row of table-entries.test.ts made up (a table dated 1/19/2025, pages ending "SB 11/19/2025" and
  // "SB 21/19/2025"), which seam 2 could not keep: a row of that table quotes only real text. Here the date is the one
  // most pages end in, because "11/19/2025" ends only the page whose Measure ends in 1.
  it("reads the last row of each page when the table is dated 1/19/2025 and a Measure number ends in 1: the date most pages end in settles it", async () => {
    // MADE UP: "HB 31311/19/2025" ends in 1/19/2025 and also in 11/19/2025; "SB 691/19/2025" ends in 1/19/2025 only.
    const read = await serve(
      madeUpTablePages(
        [
          ["409.711 A §1 HB 3795 B", "653.626 A §9 HB 3131"],
          ["418.808 A §2 HB 3795 B", "659A.159 A §4 SB 69"],
        ],
        "1/19/2025",
      ),
      ["SB 69", "HB 3131", "HB 3795"],
    );

    expect(tableEntriesOf(read["HB 3131"], "Introduced")).toEqual([["amends", "ors-653.626", "9"]]);
    expect(tableEntriesOf(read["SB 69"], "Introduced")).toEqual([["amends", "ors-659a.159", "4"]]);
    expect(tableReport(rig.system)).toMatchObject({ outcome: "loaded", entries: 4, unread_lines: 0 });
  });

  // The table's own legend (page 1 of the fixture file, lines 11-13 of its PDF.js text): "(b) The section number and
  // current session measure number or previous session measure number if a measure was repassed over the Governor’s
  // veto, followed by “OV” for a current session overturned veto or “OVP” for a previous session overturned veto".
  // The 2025R1 table prints no such row (every "OV" in its text is in the legend), so the rows are MADE UP.
  it("reads a current-session overturned veto ('OV') as the Measure's row, and keeps a previous session's ('OVP') apart: it is never filed under this Session's Measure of that number", async () => {
    const read = await serve(
      madeUpTable(["653.616 A §8 SB 69 A OV", "653.626 A §9 SB 69 A OV E", "659A.159 A §4 SB 69 OVP", "A §1 SB 121 A"]),
      ["SB 69", "SB 121"],
    );

    // OV: this Session's SB 69, at the level beside it (A-Engrossed), and an "E" after it is the emergency clause.
    expect(tableEntriesOf(read["SB 69"], "A-Engrossed")).toEqual([
      ["amends", "ors-653.616", "8"],
      ["amends", "ors-653.626", "9"],
    ]);
    // OVP: the previous Session's SB 69 is not this Session's SB 69, whatever its level: the Introduced Version has no row.
    expect(
      read["SB 69"]?.versions.find((entry) => entry.label === "Introduced")?.statutes_affected_table,
    ).toBeUndefined();
    // The text of this Session's SB 69 amends 659A.159 in §4, and the table, which has no row for this Session's SB 69 there, does not confirm it.
    const sb69 = aEngrossed(read["SB 69"] as LinksBySource).statutes_affected_table;
    expect(sb69?.only_in_parsed_links?.amends.sections.map((target) => target.target_id)).toContain("ors-659a.159");
    // The row that omits its ORS number after the OVP row belongs to 659A.159 all the same, and is read.
    expect(lists(read["SB 121"])).toBe(true);
    expect(tableReport(rig.system)).toMatchObject({
      outcome: "loaded",
      entries: 3,
      previous_session_entries: 1,
      unread_lines: 0,
    });
  });

  // The legend (lines 17 and 25 of the PDF.js text of page 1): "The engrossing level is printed next to the measure number
  // if the measure has been engrossed (such as “C” to indicate the C-engrossed version ...)" and "(4) An “E” if an
  // emergency clause applies to the amendment, repeal or addition." Column (4) is not in PDF.js's text, so an E alone
  // after the Measure number is the emergency clause of a row at the Introduced Version, or the level of an E-Engrossed
  // Version, and the feed says which Versions a Measure has (ADR-0033). The 2025R1 feed lists no E-Engrossed Version of
  // any Measure (none of its 6,178 MeasureDocuments rows; its latest level is C), so every one of the 819 entries of the
  // table that end in an E alone (180 Measures, measured 2026-10-30 in the cached feed and the fixture's copy of the table)
  // is the emergency clause. Since ticket #54 the fixture has two real Measures with such rows, HB 3723 and HB 3124, whose
  // Introduced Versions get_measure-statutes-affected-table.test.ts reads against the real table. The rows below stay MADE
  // UP, for SB 983 and SB 69: a case needs a Measure whose Versions it can give an E-Engrossed Version, and the two cases after
  // the first need that Version too, which is made up as well.
  const eAloneRows = ["244.120 A §1 SB 983 E", "244.350 R §2 SB 983 E", "653.626 A §9 SB 69 A E"];
  const eAloneTable = madeUpTable(eAloneRows);
  const otherEntriesOfEAlone = [
    {
      level: "E",
      version: null,
      reason: holding("lists an E-Engrossed Version"),
      entries: expectedChanges({
        amends: { sections: [sectionTarget("ors-244.120", "1")] },
        repeals: { sections: [sectionTarget("ors-244.350", "2")] },
      }),
    },
  ];
  const versionOf = (links: LinksBySource | undefined, label: string): VersionEntry | undefined =>
    links?.versions.find((entry) => entry.label === label);

  it("reads an E alone as the emergency clause of the Introduced Version when the feed lists no E-Engrossed Version of the Measure, and compares the entry with the Introduced Version's links", async () => {
    // SB 983's Introduced Version amends ORS 244.120 in SECTION 1 (and so does its A-Engrossed Version). The row for 244.120
    // ends in an E alone, which can only be the emergency clause: SB 983 has no E-Engrossed Version. The text repeals no
    // section, so the repeal of 244.350 is the table's alone. "SB 69 A E" is a level and an emergency clause after it.
    const read = await serve(eAloneTable, ["SB 983", "SB 69"]);

    expect(versionOf(read["SB 983"], "Introduced")?.statutes_affected_table).toEqual({
      compared: true,
      not_compared_reason: null,
      parsed_changes: expectedParsedChanges({ amends: { sections: [confirmed(sectionTarget("ors-244.120", "1"))] } }),
      only_in_table: expectedChanges({ repeals: { sections: [sectionTarget("ors-244.350", "2")] } }),
      only_in_parsed_links: null,
      entries_not_compared: null,
    });
    // No entry names the A-Engrossed Version, whatever its text amends: the E alone names the Introduced Version only.
    expect(versionOf(read["SB 983"], "A-Engrossed")?.statutes_affected_table).toBeUndefined();
    expect(read["SB 983"]?.statutes_affected_table?.other_entries).toEqual([]);
    // A level and an E after it are known as before: the A-Engrossed Version.
    expect(tableEntriesOf(read["SB 69"], "A-Engrossed")).toEqual([["amends", "ors-653.626", "9"]]);
    expect(versionOf(read["SB 69"], "Introduced")?.statutes_affected_table).toBeUndefined();
    expect(tableReport(rig.system)).toMatchObject({
      outcome: "loaded",
      entries: 3,
      lone_e_entries: 2,
      lone_e_with_e_engrossed_version: 0,
      unread_lines: 0,
    });
  });

  it("leaves the same entries unknown once the feed lists an E-Engrossed Version of the Measure: the E may be that Version's level, and the table is not read again", async () => {
    // MADE UP: a row for SB 983's E-Engrossed Version, served with a PDF the test builds. The table's bytes are the ones
    // of the case before, so what changes the answer is the Version the feed lists.
    rig.system.olis.addRows("MeasureDocuments", [versionRowOf("SB", 983, "E-Engrossed")]);
    rig.system.olis.serveDocument(
      versionPathOf("SB", 983, "E-Engrossed"),
      madeUpPdf([
        [
          "E-ENGROSSED SENATE BILL 983 (MADE UP)",
          "SECTION 1. ORS 244.120 is amended to read:",
          "244.120. A made-up text.",
        ],
      ]),
    );
    const read = await serve(eAloneTable, ["SB 983"]);

    expect(versionOf(read["SB 983"], "E-Engrossed")?.label).toBe("E-Engrossed");
    for (const label of ["Introduced", "A-Engrossed", "E-Engrossed"]) {
      expect(versionOf(read["SB 983"], label)?.statutes_affected_table).toBeUndefined();
    }
    expect(read["SB 983"]?.statutes_affected_table?.other_entries).toEqual(otherEntriesOfEAlone);
    expect(tableReport(rig.system)).toMatchObject({ outcome: "unchanged", held: true });
  });

  it("leaves them unknown too when the feed lists the E-Engrossed Version and its file never came: the listing says the Version exists, whether or not the index holds it", async () => {
    // MADE UP: a row for HB 3131's E-Engrossed Version, whose file is not served, so the worker lists it as not fetched.
    // SB 69 has no E-Engrossed Version, so its E alone is read at the Introduced Version, whose text amends nothing.
    rig.system.olis.addRows("MeasureDocuments", [versionRowOf("HB", 3131, "E-Engrossed")]);
    const read = await serve(madeUpTable([...eAloneRows, "653.616 A §8 SB 69 E", "659A.159 A §4 HB 3131 E"]), [
      "SB 983",
      "SB 69",
      "HB 3131",
    ]);

    expect(versionOf(read["HB 3131"], "E-Engrossed")).toBeUndefined();
    expect(versionOf(read["HB 3131"], "Introduced")?.statutes_affected_table).toBeUndefined();
    expect(read["HB 3131"]?.statutes_affected_table?.other_entries).toEqual([
      {
        level: "E",
        version: null,
        reason: holding("lists an E-Engrossed Version"),
        entries: expectedChanges({ amends: { sections: [sectionTarget("ors-659a.159", "4")] } }),
      },
    ]);
    expect(read["SB 983"]?.statutes_affected_table?.other_entries).toEqual(otherEntriesOfEAlone);
    expect(versionOf(read["SB 69"], "Introduced")?.statutes_affected_table).toEqual({
      compared: true,
      not_compared_reason: null,
      parsed_changes: null,
      only_in_table: expectedChanges({ amends: { sections: [sectionTarget("ors-653.616", "8")] } }),
      only_in_parsed_links: null,
      entries_not_compared: null,
    });
    expect(read["SB 69"]?.statutes_affected_table?.other_entries).toEqual([]);
    // Four entries end in an E alone (SB 983's two, SB 69's and HB 3131's); the feed lists an E-Engrossed Version for three.
    expect(tableReport(rig.system)).toMatchObject({
      outcome: "loaded",
      entries: 5,
      lone_e_entries: 4,
      lone_e_with_e_engrossed_version: 3,
      unread_lines: 0,
    });
  });
});
