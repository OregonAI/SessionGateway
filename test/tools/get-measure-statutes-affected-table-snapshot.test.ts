// Seam 1: the Statutes Affected Table's series after the OregonAI snapshot changes between two pulls (ticket #59,
// ADR-0044, which supersedes part of ADR-0034, and ADR-0035). A series in the table ("345.010 to 345.340") is expanded
// against the snapshot's ORS section list, as a range in a Version is, so the held table is read again when the
// snapshot's commit changes though its bytes do not; when the table cannot be fetched on that pull, or the server gives
// bytes that are refused as no table, the held copy's text is read again and nothing fetched is stored.
//
// Each case is a story of pulls, so it builds its own system (a real pull of the fixture's documents, about four seconds;
// a system with the table is never copied from a template). Each answer is asked for by a 2026-07-28 client and by a
// legacy client, and the two must be equal.
//
// The table is MADE UP, and stays so after ticket #54 added the real disagreements (HB 3723's and HB 3124's, which
// get-measure-statutes-affected-table.test.ts reads): the story needs a series of ORS sections that the Measure's text does
// not change, so that every entry of the series is in `only_in_table` and a changed section list changes the count. HB 3723's
// entries are single sections, and HB 3124's series of chapters (a series of chapters moves with the section list too) gives
// two entries here, where the story needs more than the 20 that the table block shows before it cuts. The real row for
// HB 3027's series is confirmed by the text, which the same snapshot expands to the same sections, so a changed section list would move both sides together. The
// table is one series, 345.010 to 345.340, that amends HB 3027 in section 2 (a row the real table does not
// have), served in place of the fixture's table from the second pull on. The snapshot is a MADE-UP copy of the fixture's
// (`createFixtureCopy`), which `changeIt()` rewrites with ors-345.250 added and a version of its own. The fixture's
// snapshot holds 22 sections from 345.010 to 345.340, so the series gives 22 entries, and with the made-up section 23.
// HB 3027's Introduced Version cites none of them, so every entry is listed in `only_in_table`, which cuts a list at a
// count and says how many it left out.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureCopy, type FixtureCopy } from "../support/made-up-snapshot.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { madeUpTable, publishedTableUrl, tablePath, tableUrlOn } from "../support/statutes-affected-table.ts";
import { startSystem, type System } from "../support/system.ts";

vi.setConfig({ testTimeout: 60_000 });

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Sections = { sections: { target_id: string }[]; sections_not_shown?: number };
type Measure = {
  statute_links_by_source: {
    versions: { id: string; statutes_affected_table?: { only_in_table: { amends: Sections } | null } }[];
    statutes_affected_table?: { retrieved_at: string };
  };
};

const madeUpSection = "ors-345.250";
const introduced = "version-2025r1-hb3027-introduced";
const madeUpRows = ["345.010 to)", "345.340 ) A §2 HB 3027"];

/** The second pull, which loads the made-up table, and the days after it. */
const secondPull = "2026-08-02T17:00:00Z";
const secondPullPacific = "2026-08-02T10:00:00-07:00";
const thirdPull = "2026-08-03T17:00:00Z";
const fourthPull = "2026-08-04T17:00:00Z";
const fifthPull = "2026-08-05T17:00:00Z";
const sixthPull = "2026-08-06T17:00:00Z";

/** Bytes that are no table (no PDF at all), which the worker refuses and remembers by their hash. */
const placeholder = new TextEncoder().encode("this is a placeholder, not a table");

/** What get_measure shows of the table for HB 3027: the entries its Introduced Version's text lacks, and the copy's time. */
type Seen = { count: number; shown: string[]; retrievedAt: string | undefined };

type Rig = {
  system: System;
  snapshot: FixtureCopy;
  seen(): Promise<Seen>;
  report(): Record<string, unknown> | undefined;
  tableRequests(): number;
};

/**
 * A system on the made-up copy of the snapshot whose second pull has loaded the made-up table with the fixture's
 * section list: the table block counts 22 entries.
 */
async function openRig(): Promise<Rig> {
  const snapshot = createFixtureCopy((copy) => {
    copy.orsSections = [...copy.orsSections, madeUpSection].sort();
  });
  cleanups.push(snapshot.remove);
  const system = await startSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    snapshot: snapshot.path,
    statutesAffectedTableUrl: tableUrlOn,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
  cleanups.push(() => system.stop());
  const clients: ConnectedClient[] = [];
  for (const era of eras) clients.push(await connectClient(era, system.handler));
  cleanups.push(async () => {
    for (const client of clients) await client.close();
  });
  const seen = async (): Promise<Seen> => {
    const answers: Seen[] = [];
    for (const client of clients) {
      const outcome = await callTool(client, "get_measure", { measure: "HB 3027" });
      expect(outcome.isError, outcome.text).toBe(false);
      const links = (outcome.structured as unknown as Measure).statute_links_by_source;
      const amends = links.versions.find((version) => version.id === introduced)?.statutes_affected_table?.only_in_table
        ?.amends;
      answers.push({
        count: (amends?.sections.length ?? 0) + (amends?.sections_not_shown ?? 0),
        shown: (amends?.sections ?? []).map((section) => section.target_id),
        retrievedAt: links.statutes_affected_table?.retrieved_at,
      });
    }
    expect(answers[1]).toEqual(answers[0]);
    return answers[0] ?? { count: 0, shown: [], retrievedAt: undefined };
  };
  const rig: Rig = {
    system,
    snapshot,
    seen,
    report: () => system.buildReport()["statutes_affected_table"] as Record<string, unknown> | undefined,
    tableRequests: () => system.olis.documentRequests().filter((path) => path === tablePath).length,
  };
  system.olis.serveDocument(tablePath, madeUpTable(madeUpRows));
  system.clock.set(secondPull);
  await system.pullAgain();
  expect(rig.report()).toMatchObject({ outcome: "loaded", held: true, entries: 22 });
  expect(await seen()).toMatchObject({ count: 22, retrievedAt: secondPullPacific });
  return rig;
}

describe("the Statutes Affected Table after the snapshot changes", () => {
  it("reads the table again with the new section list, though its bytes are the same: the series gains the new section", async () => {
    const rig = await openRig();

    rig.snapshot.changeIt();
    rig.system.clock.set(thirdPull);
    await rig.system.pullAgain();

    expect(rig.report()).toMatchObject({ outcome: "loaded", held: true, entries: 23 });
    expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });
  });

  it("does not read the table again at a pull of the same snapshot and the same bytes", async () => {
    const rig = await openRig();
    rig.snapshot.changeIt();
    rig.system.clock.set(thirdPull);
    await rig.system.pullAgain();

    rig.system.clock.set(fourthPull);
    await rig.system.pullAgain();

    expect(rig.report()).toEqual({ source_url: tableUrlOn(rig.system.olis.origin), outcome: "unchanged", held: true });
    expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });
  });

  describe.for([
    { failure: "answers 404", statuses: [404], reason: "404" },
    // Three answers of 503 are the three attempts a file gets (the worker does not wait between them in a test).
    { failure: "keeps failing", statuses: [503, 503, 503], reason: "503" },
  ])("when the table $failure at the pull whose snapshot changed", ({ statuses, reason }) => {
    it("reads the held copy's text again with the new section list, without fetching, and keeps the copy as it was", async () => {
      const rig = await openRig();
      rig.snapshot.changeIt();
      rig.system.olis.failDocuments(publishedTableUrl, statuses);
      rig.system.clock.set(thirdPull);
      await rig.system.pullAgain();

      expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });
      expect(rig.report()).toMatchObject({
        source_url: tableUrlOn(rig.system.olis.origin),
        outcome: "read_again_from_held_copy",
        held: true,
        entries: 23,
      });
      expect(String(rig.report()?.["reason"])).toContain(reason);
    });

    it("reads the table no further while the snapshot and the bytes stay the same: the held copy's hash is the second pull's", async () => {
      const rig = await openRig();
      rig.snapshot.changeIt();
      rig.system.olis.failDocuments(publishedTableUrl, statuses);
      rig.system.clock.set(thirdPull);
      await rig.system.pullAgain();
      const requests = rig.tableRequests();

      // The server gives the table again, the same bytes as the second pull fetched.
      rig.system.clock.set(fourthPull);
      await rig.system.pullAgain();
      expect(rig.tableRequests()).toBe(requests + 1);
      expect(rig.report()).toEqual({
        source_url: tableUrlOn(rig.system.olis.origin),
        outcome: "unchanged",
        held: true,
      });
      expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });

      // And a pull that cannot fetch it again does not read the held copy again either.
      rig.system.olis.failDocuments(publishedTableUrl, statuses);
      rig.system.clock.set(fifthPull);
      await rig.system.pullAgain();
      expect(rig.report()).toMatchObject({
        outcome: statuses[0] === 404 ? "not_published" : "not_fetched",
        held: true,
      });
      expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });
    });
  });

  describe("when the server gives bytes refused as no table at the pull whose snapshot changed", () => {
    it("reads the held copy's text again with the new section list when it refuses the bytes on first sight (not_read), and keeps the copy and the refusal", async () => {
      const rig = await openRig();
      rig.snapshot.changeIt();
      rig.system.olis.serveDocument(tablePath, placeholder);
      rig.system.clock.set(thirdPull);
      await rig.system.pullAgain();

      expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });
      const refusal = rig.report();
      expect(refusal).toMatchObject({
        source_url: tableUrlOn(rig.system.olis.origin),
        outcome: "not_read",
        held: true,
        entries: 23,
      });
      expect(typeof refusal?.["reason"]).toBe("string");

      // The refusal is remembered: the same bytes with the same snapshot are refused again, and nothing is read again.
      rig.system.clock.set(fourthPull);
      await rig.system.pullAgain();
      expect(rig.report()).toEqual({
        source_url: tableUrlOn(rig.system.olis.origin),
        outcome: "refused_unchanged",
        held: true,
        reason: refusal?.["reason"],
      });
      expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });

      // The held copy's hash is the second pull's: its bytes, given again, are unchanged.
      rig.system.olis.serveDocument(tablePath, madeUpTable(madeUpRows));
      rig.system.clock.set(fifthPull);
      await rig.system.pullAgain();
      expect(rig.report()).toEqual({
        source_url: tableUrlOn(rig.system.olis.origin),
        outcome: "unchanged",
        held: true,
      });
      expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });
    });

    it("reads the held copy's text again with the new section list when the bytes were refused before (refused_unchanged), and keeps the copy and the refusal", async () => {
      const rig = await openRig();
      // A pull of the same snapshot refuses the placeholder and reads nothing again: the table block still counts 22.
      rig.system.olis.serveDocument(tablePath, placeholder);
      rig.system.clock.set(thirdPull);
      await rig.system.pullAgain();
      const refusal = rig.report();
      expect(typeof refusal?.["reason"]).toBe("string");
      expect(refusal).toEqual({
        source_url: tableUrlOn(rig.system.olis.origin),
        outcome: "not_read",
        held: true,
        reason: refusal?.["reason"],
      });
      expect(await rig.seen()).toMatchObject({ count: 22, retrievedAt: secondPullPacific });

      rig.snapshot.changeIt();
      rig.system.clock.set(fourthPull);
      await rig.system.pullAgain();

      expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });
      expect(rig.report()).toMatchObject({
        source_url: tableUrlOn(rig.system.olis.origin),
        outcome: "refused_unchanged",
        held: true,
        reason: refusal?.["reason"],
        entries: 23,
      });

      // A pull of the same snapshot reads the held copy no further, and the copy's hash is the second pull's.
      rig.system.clock.set(fifthPull);
      await rig.system.pullAgain();
      expect(rig.report()).toEqual({
        source_url: tableUrlOn(rig.system.olis.origin),
        outcome: "refused_unchanged",
        held: true,
        reason: refusal?.["reason"],
      });
      rig.system.olis.serveDocument(tablePath, madeUpTable(madeUpRows));
      rig.system.clock.set(sixthPull);
      await rig.system.pullAgain();
      expect(rig.report()).toEqual({
        source_url: tableUrlOn(rig.system.olis.origin),
        outcome: "unchanged",
        held: true,
      });
      expect(await rig.seen()).toMatchObject({ count: 23, retrievedAt: secondPullPacific });
    });
  });
});
