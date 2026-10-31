// Seam 1: what the Agency Links are after the OregonAI snapshot changes between two pulls (ticket #16 fix pass, F7; spec
// #1 story 56: "refreshed at build time and versioned with the database, so that I know which snapshot an answer used").
// The index reports the snapshot of the latest pull, so every Agency Link it holds has to have been read with that
// snapshot: the worker reads every stored document again when the snapshot's version changes, from the text it already
// stores, and fetches nothing. Testimony is matched again at every pull (ADR-0016), so it is not what shows this.
//
// The second snapshot is MADE UP from the committed fixture: the same registry, Chapter table and sections, a version of
// its own, and one alias the registry lacks, "ODHS" for the Department of Human Services (ADR-0012 and the fixture's
// README leave it open whether OregonAI adds it). "ODHS" is written once in the Digest of SB 64's Introduced Version
// (line 12 of pdftotext of measure-documents/SB64/Introduced.pdf: "The Act tells ODHS to seek a waiver"), two lines before
// "the Department of Human Services" (line 14), and in HB 3795's Introduced and A-Engrossed Versions. Before the alias a
// Version's link of "named in the text" to the Department finds the one term, and after it the two, in the order they
// come in the text. The Versions are stored and read already, so only a second reading can show the alias.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { createFixtureCopy, type FixtureCopy } from "../support/made-up-snapshot.ts";
import { startSystem, type System } from "../support/system.ts";

vi.setConfig({ testTimeout: 60_000 });

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Example = { document_id: string; node_id: string; terms?: string[] };
type AgencyLinks = {
  agencies: { agency_id: string; evidence: { kind: string; count: number; examples: Example[] }[] }[];
};

const dhs = "department-of-human-services";
const sb64Introduced = "version-2025r1-sb64-introduced";
const newCommit = "0123456789abcdef0123456789abcdef01234567";

/** A made-up copy of the committed snapshot (test/support/made-up-snapshot.ts) that gains the made-up alias and a version. */
function snapshotCopy(): FixtureCopy {
  const copy = createFixtureCopy((snapshot) => {
    const row = snapshot.agencies.find((agency) => agency.slug === dhs);
    if (row === undefined) throw new Error("The snapshot fixture has no row for the Department of Human Services");
    row.aliases = [...row.aliases, "ODHS"];
  });
  cleanups.push(copy.remove);
  return copy;
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

const namedInText = (links: AgencyLinks): { count: number; examples: Example[] } | undefined =>
  links.agencies.find((agency) => agency.agency_id === dhs)?.evidence.find((group) => group.kind === "named-in-text");

describe.for(eras)("the Agency Links after the snapshot changes, for a %s client", (era) => {
  it("reads every stored document again with the new snapshot: a Version already read has the alias among its terms", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);
    const before = (await asked(system, era, "get_measure", { measure: "SB 64" }))["agency_links"] as AgencyLinks;
    const introducedBefore = namedInText(before)?.examples.find((example) => example.node_id === sb64Introduced);
    expect(introducedBefore?.terms).toEqual(["Department of Human Services"]);

    snapshot.changeIt();
    await system.pullAgain();

    const after = (await asked(system, era, "get_measure", { measure: "SB 64" }))["agency_links"] as AgencyLinks;
    const introducedAfter = namedInText(after)?.examples.find((example) => example.node_id === sb64Introduced);
    expect(introducedAfter?.terms).toEqual(["ODHS", "Department of Human Services"]);
    expect(namedInText(after)?.count).toBe(2);
  });

  it("changes the terms found in a Version that named the Agency already", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);

    snapshot.changeIt();
    await system.pullAgain();

    const links = (await asked(system, era, "get_measure", { measure: "HB 3795" }))["agency_links"] as AgencyLinks;
    const aEngrossed = namedInText(links)?.examples.find(
      (example) => example.node_id === "version-2025r1-hb3795-a-engrossed",
    );
    expect(aEngrossed?.terms).toContain("ODHS");
    expect(aEngrossed?.terms).toContain("Department of Human Services");
  });

  it("reports the snapshot the links were read with", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);

    snapshot.changeIt();
    await system.pullAgain();

    const overview = await asked(system, era, "session_overview", {});
    expect(overview["snapshot"]).toMatchObject({ commit: newCommit, commit_date: "2026-10-01T09:00:00-07:00" });
  });

  it("leaves a document alone when the snapshot has not changed: the second pull of the same snapshot changes no answer", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);
    const before = await asked(system, era, "get_measure", { measure: "HB 3795" });

    await system.pullAgain();

    const after = await asked(system, era, "get_measure", { measure: "HB 3795" });
    expect(after["agency_links"]).toEqual(before["agency_links"]);
  });
});
