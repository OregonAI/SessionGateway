// Seam 1: what the Statute Links, and the Agency Links derived from them, are after the OregonAI snapshot changes between
// two pulls (ticket #51, ADR-0035). A range in a Version ("ORS 345.010 to 345.340") is expanded against the snapshot's
// ORS section list, so when the snapshot's commit changes the worker reads every stored Version and posting again, from
// the stored text and without fetching, before it reads the Agency Links again.
//
// The second snapshot is MADE UP from the committed fixture: the same registry, Chapter table and sections, a version of
// its own, and ONE ORS section the fixture lacks, ors-345.250, which sits inside the range HB 3027 cites. HB 3027's
// Introduced and Enrolled Versions say "Section 2 of this 2025 Act is added to and made a part of ORS 345.010 to 345.340"
// (pdftotext of measure-documents/HB3027/Introduced.pdf and Enrolled.pdf). The fixture's snapshot holds 22 sections from
// ORS 345.010 to 345.340 (counted in test/fixtures/oregonai-snapshot/snapshot.json), so the range gives 22 adds-to links,
// and with the made-up section 23. Each link that adds to a section of chapter 345 is one of "links_in_chapter" of the
// derived Agency Links (ADR-0027), so the Agency Links follow by their count: 22 before, 23 after. The made-up section is
// not any true ORS section.
//
// Each case's first pull is a copy of the run's template for the committed snapshot (test/CLAUDE.md, Database,
// Templates); the pull after the snapshot changes is a real one. It covers the range, the Agency Links derived from
// it, a pull of the same snapshot and what the overview reports, and a pull that stops part-way.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { createFakeEmbedder } from "../support/fake-embedder.ts";
import { readAgencyLinksWithOnlyTheStamp } from "../support/old-database.ts";
import { createFixtureCopy, type FixtureCopy } from "../support/made-up-snapshot.ts";
import { systemTemplate, type System, type SystemTemplate } from "../support/system.ts";

vi.setConfig({ testTimeout: 60_000 });

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Targets = { sections: { target_id: string; measure_sections: string[] }[] };
type Measure = {
  statute_links_by_source: { versions: { id: string; statute_links?: { "adds-to": Targets } }[] };
  agency_links: {
    agencies: {
      agency_id: string;
      evidence: { kind: string; examples: { document_id: string; links_in_chapter?: number }[] }[];
    }[];
  };
};

const newCommit = "0123456789abcdef0123456789abcdef01234567";
const madeUpSection = "ors-345.250";
const introduced = "version-2025r1-hb3027-introduced";
const hecc = "higher-education-coordinating-commission";

/** A made-up copy of the committed snapshot (test/support/made-up-snapshot.ts) that gains the made-up section and a version. */
function snapshotCopy(): FixtureCopy {
  const copy = createFixtureCopy((snapshot) => {
    snapshot.orsSections = [...snapshot.orsSections, madeUpSection].sort();
  });
  cleanups.push(copy.remove);
  return copy;
}

// Every case begins with the pull of the committed snapshot at a clock of its own, so the cases copy one database for each
// clock; the pull each case runs after `changeIt()` is the subject and is a real one (test/CLAUDE.md, "Database").
const templateAt = (clockAt: string): SystemTemplate =>
  systemTemplate({ clockAt, documents: true, serverEnv: { MCP_RATE_LIMIT: "1000" } });

async function startAt(snapshot: string, clockAt = "2026-08-01T17:00:00Z"): Promise<System> {
  const system = await templateAt(clockAt).start({ snapshot });
  cleanups.push(() => system.stop());
  return system;
}

async function asked(system: System, era: Era, tool: string, args: Record<string, unknown>) {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, tool, args);
    expect(outcome.isError, outcome.text).toBe(false);
    return outcome.structured ?? {};
  } finally {
    await connected.close();
  }
}

const hb3027 = async (system: System, era: Era): Promise<Measure> =>
  (await asked(system, era, "get_measure", { measure: "HB 3027" })) as unknown as Measure;

const addsTo = (measure: Measure): string[] =>
  (
    measure.statute_links_by_source.versions.find((version) => version.id === introduced)?.statute_links?.["adds-to"]
      .sections ?? []
  ).map((section) => section.target_id);

const linksInChapter = (measure: Measure): number | undefined =>
  measure.agency_links.agencies
    .find((agency) => agency.agency_id === hecc)
    ?.evidence.find((group) => group.kind === "derived")
    ?.examples.find((example) => example.document_id === introduced)?.links_in_chapter;

describe.for(eras)("the Statute Links after the snapshot changes, for a %s client", (era) => {
  it("reads the range again with the new section list: the new section is in the range and the derived Agency Links count it", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);
    const before = await hb3027(system, era);
    expect(addsTo(before)).toHaveLength(22);
    expect(addsTo(before)).not.toContain(madeUpSection);
    expect(linksInChapter(before)).toBe(22);

    snapshot.changeIt();
    await system.pullAgain();

    const after = await hb3027(system, era);
    expect(addsTo(after)).toHaveLength(23);
    expect(addsTo(after)).toContain(madeUpSection);
    expect(linksInChapter(after)).toBe(23);
  });

  it("leaves everything alone when the snapshot has not changed: the second pull changes no answer and fetches nothing", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);
    const before = await hb3027(system, era);
    const requestsBefore = system.olis.documentRequests().length;

    await system.pullAgain();

    expect(await hb3027(system, era)).toEqual(before);
    expect(system.olis.documentRequests()).toHaveLength(requestsBefore);
  });

  it("fetches nothing when the snapshot changes either: the files are read again from the stored text", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);
    const requestsBefore = system.olis.documentRequests().length;

    snapshot.changeIt();
    await system.pullAgain();

    expect(system.olis.documentRequests()).toHaveLength(requestsBefore);
  });

  it("after a complete pull, the overview reports the new snapshot and the links read with it", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);

    snapshot.changeIt();
    await system.pullAgain();

    const overview = await asked(system, era, "session_overview", {});
    expect(overview["snapshot"]).toMatchObject({ commit: newCommit, commit_date: "2026-10-01T09:00:00-07:00" });
    const measure = await hb3027(system, era);
    expect(addsTo(measure)).toContain(madeUpSection);
    expect(linksInChapter(measure)).toBe(23);
  });

  it("keeps reporting the old snapshot while a pull that has seen the new one is not finished: the links are still the old ones", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path, "2025-01-29T17:00:00Z");
    const oldCommit = ((await asked(system, era, "session_overview", {}))["snapshot"] as { commit: string }).commit;
    expect(oldCommit).not.toBe(newCommit);

    // A later clock lists documents the first pull did not, and an embedder that fails on them stops the second pull
    // after the feed is stored and before the links are read again.
    snapshot.changeIt();
    system.clock.set("2025-07-15T17:00:00Z");
    const embedder = {
      ...(await createFakeEmbedder()),
      embedPassages: () => Promise.reject(new Error("embedder down")),
    };
    await expect(system.pullAgain({ embedder })).rejects.toThrow("embedder down");

    const overview = await asked(system, era, "session_overview", {});
    expect(overview["snapshot"]).toMatchObject({ commit: oldCommit });
  });

  it("derives the Agency Links again for a database that an older worker stamped with the new commit: the Statute Links it rewrites are the ones they are made from", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);
    expect(linksInChapter(await hb3027(system, era))).toBe(22);

    // The older worker pulled the new snapshot: it stamped the Agency Links with its commit and kept the old expansion.
    snapshot.changeIt();
    readAgencyLinksWithOnlyTheStamp(system.database.path, newCommit);
    await system.pullAgain();

    const after = await hb3027(system, era);
    expect(addsTo(after)).toContain(madeUpSection);
    expect(linksInChapter(after)).toBe(23);
  });
});
