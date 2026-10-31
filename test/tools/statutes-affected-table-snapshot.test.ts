// Seam 1: the Statutes Affected Table's series after the OregonAI snapshot changes between two pulls (ticket #51, ADR-0035
// and ADR-0034). A series in the table ("345.010 to 345.340") is expanded against the snapshot's ORS section list, as a
// range in a Version is, so the table is read again when the snapshot's commit changes even though its bytes do not.
//
// The table is MADE UP: one series, 345.010 to 345.340, that amends HB 3027 in section 2 (a row the real table does not
// have), and the snapshot is the made-up copy of test/tools/statute-links-snapshot.test.ts: the fixture's snapshot with
// ors-345.250 added and a version of its own. The fixture's snapshot holds 22 sections from 345.010 to 345.340, so the
// series gives 22 entries, and with the made-up section 23. The entries the Version's text does not have are listed in
// `only_in_table`, which cuts a list at a count and says how many it left out.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureCopy, type FixtureCopy } from "../support/made-up-snapshot.ts";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { madeUpTable, tablePath, tableUrlOn } from "../support/statutes-affected-table.ts";
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
  };
};

const madeUpSection = "ors-345.250";
const introduced = "version-2025r1-hb3027-introduced";

/** The entries of the table for HB 3027's Introduced Version that its text does not have, as get_measure counts them. */
async function entriesOnlyInTable(system: System, era: Era): Promise<{ count: number; shown: string[] }> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3027" });
    expect(outcome.isError, outcome.text).toBe(false);
    const measure = outcome.structured as unknown as Measure;
    const amends = measure.statute_links_by_source.versions.find((version) => version.id === introduced)
      ?.statutes_affected_table?.only_in_table?.amends;
    return {
      count: (amends?.sections.length ?? 0) + (amends?.sections_not_shown ?? 0),
      shown: (amends?.sections ?? []).map((section) => section.target_id),
    };
  } finally {
    await connected.close();
  }
}

describe.for(eras)("the Statutes Affected Table after the snapshot changes, for a %s client", (era) => {
  it("reads the table again with the new section list, though its bytes are the same: the series gains the new section", async () => {
    const snapshot: FixtureCopy = createFixtureCopy((copy) => {
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
    system.olis.serveDocument(tablePath, madeUpTable(["345.010 to)", "345.340 ) A §2 HB 3027"]));
    system.clock.set("2026-08-02T17:00:00Z");
    await system.pullAgain();
    expect((await entriesOnlyInTable(system, era)).count).toBe(22);

    snapshot.changeIt();
    system.clock.set("2026-08-03T17:00:00Z");
    await system.pullAgain();

    expect(await entriesOnlyInTable(system, era)).toMatchObject({ count: 23 });
  });
});
