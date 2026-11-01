// Seam 1: what the Agency Links are after the OregonAI snapshot changes between two pulls (ticket #16 fix pass, F7; spec
// #1 story 56: "refreshed at build time and versioned with the database, so that I know which snapshot an answer used").
// The index reports the snapshot of the latest pull, so every Agency Link it holds has to have been read with that
// snapshot: the worker reads every stored document again when the snapshot's version changes, from the text it already
// stores, and fetches nothing. Testimony is matched again at every pull (ADR-0016), so it is not what shows this.
//
// The second snapshot is MADE UP from the committed fixture: the same registry, Chapter table and sections, a version of
// its own, and one alias the registry lacks: "ODHS" is taken away from the Department of Human Services. Until ERF
// 6c41efefb5 (ticket #49) the registry lacked the alias and this snapshot added it; the committed fixture has it now, so
// the change runs the other way and the test shows the same thing. "ODHS" is written once in the Digest of SB 64's
// Introduced Version (line 12 of pdftotext of measure-documents/SB64/Introduced.pdf: "The Act tells ODHS to seek a
// waiver"), two lines before "the Department of Human Services" (line 14), and in HB 3795's Introduced and A-Engrossed
// Versions. With the alias a Version's link of "named in the text" to the Department finds both terms, in the order they
// come in the text, and without it the one. The Versions are stored and read already, so only a second reading can show
// the change.
//
// Each case's first pull is a copy of the run's template for the committed snapshot (test/CLAUDE.md, Database,
// Templates); the pull after the snapshot changes is a real one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { createFixtureCopy, type FixtureCopy, type FixtureSnapshot } from "../support/made-up-snapshot.ts";
import { systemTemplate, type System } from "../support/system.ts";

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

/** A made-up copy of the committed snapshot (test/support/made-up-snapshot.ts) that gains a version and loses the alias "ODHS". */
function snapshotCopy(): FixtureCopy {
  return copyChangedBy((snapshot) => {
    const row = departmentRow(snapshot);
    if (!row.aliases.includes("ODHS"))
      throw new Error("The snapshot fixture's Department of Human Services lacks the alias ODHS");
    row.aliases = row.aliases.filter((alias) => alias !== "ODHS");
  });
}

/** A made-up copy that gains a version and the alias "DHS", which the committed snapshot's Department lacks. */
function snapshotCopyWithAliasDhs(): FixtureCopy {
  return copyChangedBy((snapshot) => {
    const row = departmentRow(snapshot);
    if (row.aliases.includes("DHS")) throw new Error("The snapshot fixture's Department of Human Services has DHS");
    row.aliases = [...row.aliases, "DHS"];
  });
}

function departmentRow(snapshot: FixtureSnapshot): FixtureSnapshot["agencies"][number] {
  const row = snapshot.agencies.find((agency) => agency.slug === dhs);
  if (row === undefined) throw new Error("The snapshot fixture has no row for the Department of Human Services");
  return row;
}

function copyChangedBy(change: (snapshot: FixtureSnapshot) => void): FixtureCopy {
  const copy = createFixtureCopy(change);
  cleanups.push(copy.remove);
  return copy;
}

// Every case begins with the pull of the committed snapshot, so they copy one database of it; the pull the case then
// runs, after `changeIt()`, is the subject and is a real one (test/CLAUDE.md, "Database").
const template = systemTemplate({
  clockAt: "2026-08-01T17:00:00Z",
  documents: true,
  serverEnv: { MCP_RATE_LIMIT: "1000" },
});

async function startAt(snapshot: string): Promise<System> {
  const system = await template.start({ snapshot });
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
  it("reads every stored document again with the new snapshot: a Version already read loses the alias from its terms", async () => {
    const snapshot = snapshotCopy();
    const system = await startAt(snapshot.path);
    const before = (await asked(system, era, "get_measure", { measure: "SB 64" }))["agency_links"] as AgencyLinks;
    const introducedBefore = namedInText(before)?.examples.find((example) => example.node_id === sb64Introduced);
    expect(introducedBefore?.terms).toEqual(["ODHS", "Department of Human Services"]);

    snapshot.changeIt();
    await system.pullAgain();

    const after = (await asked(system, era, "get_measure", { measure: "SB 64" }))["agency_links"] as AgencyLinks;
    const introducedAfter = namedInText(after)?.examples.find((example) => example.node_id === sb64Introduced);
    expect(introducedAfter?.terms).toEqual(["Department of Human Services"]);
    expect(namedInText(after)?.count).toBe(2);
  });

  // The other direction, with a made-up alias: HB 3795's A-Engrossed Version says "The Act tells DHS to submit an annual
  // report about a grant program" in its Digest (line 16 of pdftotext of measure-documents/HB3795/A-Engrossed.pdf). The
  // committed snapshot gives the Department the alias ODHS and not DHS, so the Version names the Department by its full
  // name and by ODHS, and the made-up second snapshot, which adds "DHS", adds the term.
  it("reads every stored document again with the new snapshot: a Version already read gains an alias found in its text", async () => {
    const snapshot = snapshotCopyWithAliasDhs();
    const system = await startAt(snapshot.path);
    const version = "version-2025r1-hb3795-a-engrossed";
    const before = (await asked(system, era, "get_measure", { measure: "HB 3795" }))["agency_links"] as AgencyLinks;
    const termsBefore = namedInText(before)?.examples.find((example) => example.node_id === version)?.terms;
    expect(termsBefore).toEqual(["ODHS", "Department of Human Services"]);

    snapshot.changeIt();
    await system.pullAgain();

    const after = (await asked(system, era, "get_measure", { measure: "HB 3795" }))["agency_links"] as AgencyLinks;
    const termsAfter = namedInText(after)?.examples.find((example) => example.node_id === version)?.terms;
    expect(termsAfter).toContain("DHS");
    expect(termsAfter).toEqual(expect.arrayContaining(["ODHS", "Department of Human Services"]));
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
    expect(aEngrossed?.terms).toEqual(["Department of Human Services"]);
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
