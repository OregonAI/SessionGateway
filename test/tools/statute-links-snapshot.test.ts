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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { snapshotFixturePath } from "../support/oregonai-snapshot.ts";
import { startSystem, type System } from "../support/system.ts";

vi.setConfig({ testTimeout: 60_000 });

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Snapshot = {
  version: { source: string; commit: string; commitDate: string };
  orsSections: string[];
};
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

/** A copy of the committed snapshot in a folder of its own, and a function that rewrites it with the made-up section and version. */
function snapshotCopy(): { path: string; changeIt: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "statute-snapshot-change-"));
  cleanups.push(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, "snapshot.json");
  const original = readFileSync(snapshotFixturePath, "utf8");
  writeFileSync(path, original);
  return {
    path,
    changeIt: () => {
      const snapshot = JSON.parse(original) as Snapshot;
      snapshot.version = { ...snapshot.version, commit: newCommit, commitDate: "2026-10-01T09:00:00-07:00" };
      snapshot.orsSections = [...snapshot.orsSections, madeUpSection].sort();
      writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
    },
  };
}

async function startAt(snapshot: string): Promise<System> {
  const system = await startSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    snapshot,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
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

  it("reports the new snapshot only when its Statute Links and Agency Links have all been read with it", async () => {
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
});
