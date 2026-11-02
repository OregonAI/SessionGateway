// Seam 1 (test/CLAUDE.md): the two-pull rule of ticket #18 (ADR-0005, ADR-0030) seen through what ticket #16 added:
// find_measures, search's Agency filter and get_measure's same_links_as. A row two complete pulls in a row have not listed
// leaves search, whatever the filters, and stays in every list, flagged.
//
// One system, as the feed stood on 2026-08-01 with its documents, is changed once: the feed stops listing SB 69's Enrolled
// Version (its MeasureDocuments row, created 2025-05-05) and two complete pulls go by, a day apart. What both kinds of
// client read before the change is kept and compared with what they read after it. The Bureau of Labor and Industries has
// an Agency Link to SB 69's Enrolled Version through the chapters its changes reach (657B, 659A and 653) and through its
// text (find-measures.test.ts); the Version amends ORS 653.616 in SECTION 8; and its links are the A-Engrossed Version's,
// to the last measure section (get-measure-statute-links.test.ts). The embedder is the fake (search-agency.test.ts): which
// documents a filter keeps does not depend on how a meaning ranks.
// Which cases copy (test/CLAUDE.md, "Templates"): the first pull of each case, the state before the feed stops listing
// a row, is a copy of the run's template for its clock; the pulls after the change are real pulls, because the two-pull
// rule is the subject.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import type { StatuteLinks } from "../support/statute-links.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

// The system serves the documents, which pulls the fixture's 280 files: seconds, more beside the other files' workers.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const boli = "bureau-of-labor-and-industries";
const enrolledId = "version-2025r1-sb69-enrolled";
const aEngrossedId = "version-2025r1-sb69-a-engrossed";

type Item = { id: string; no_longer_listed?: boolean };
type Found = { groups: { evidence_kind: string; items: Item[] }[] };
type Hit = { id: string };
type VersionEntry = {
  id: string;
  no_longer_listed?: boolean;
  same_links_as?: string;
  text_read?: boolean;
  statute_links?: StatuteLinks;
};

/** What one kind of client reads of the four questions the cases ask. */
type Read = { byAgency: Found; bySection: Found; hits: Hit[]; versions: VersionEntry[] };

let system: System;
const clients: ConnectedClient[] = [];
const before = new Map<ConnectedClient, Read>();
const after = new Map<ConnectedClient, Read>();

async function call(client: ConnectedClient, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const outcome = await callTool(client, tool, args);
  expect(outcome.isError, outcome.text).toBe(false);
  return outcome.structured;
}

async function readAll(client: ConnectedClient): Promise<Read> {
  const byAgency = (await call(client, "find_measures", { agency: boli })) as Found;
  const bySection = (await call(client, "find_measures", { ors_section: "ORS 653.616" })) as Found;
  const searched = (await call(client, "search", { query: "sick time paid leave", agency: boli, limit: 50 })) as {
    results: Hit[];
  };
  const measure = (await call(client, "get_measure", { measure: "SB 69" })) as {
    statute_links_by_source: { versions: VersionEntry[] };
  };
  return { byAgency, bySection, hits: searched.results, versions: measure.statute_links_by_source.versions };
}

beforeAll(async () => {
  system = await startCopiedSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "100000" },
  });
  for (const era of eras) clients.push(await connectClient(era, system.handler));
  for (const client of clients) before.set(client, await readAll(client));
  stopListing(
    system.olis,
    "MeasureDocuments",
    (row) => row["MeasurePrefix"] === "SB" && row["MeasureNumber"] === 69 && row["VersionDescription"] === "Enrolled",
  );
  system.clock.set("2026-08-02T17:00:00Z");
  await system.pullAgain();
  system.clock.set("2026-08-03T17:00:00Z");
  await system.pullAgain();
  for (const client of clients) after.set(client, await readAll(client));
});

afterAll(async () => {
  for (const client of clients) await client.close();
  await system.stop();
});

/** Every item of every group, as [group, id, flagged]. */
const itemsOf = (found: Found): [string, string, boolean][] =>
  found.groups.flatMap((group) =>
    group.items.map((item): [string, string, boolean] => [
      group.evidence_kind,
      item.id,
      item.no_longer_listed === true,
    ]),
  );

function readOf(reads: Map<ConnectedClient, Read>, client: ConnectedClient): Read {
  const read = reads.get(client);
  if (read === undefined) throw new Error("The client read nothing");
  return read;
}

describe.for(eras)("a Version the feed no longer lists, for a %s client", (era) => {
  const clientOf = (): ConnectedClient => {
    const client = clients[eras.indexOf(era)];
    if (client === undefined) throw new Error(`No ${era} client`);
    return client;
  };

  it("find_measures by Agency keeps the Version in each of its groups, flagged, and flags nothing else", () => {
    const was = itemsOf(readOf(before, clientOf()).byAgency);
    const now = itemsOf(readOf(after, clientOf()).byAgency);

    expect(was.filter(([, , flagged]) => flagged)).toEqual([]);
    // The same items in the same groups and order: the row stays in the list.
    expect(now.map(([group, id]) => [group, id])).toEqual(was.map(([group, id]) => [group, id]));
    expect(now.filter(([, id]) => id === enrolledId).map(([group]) => group)).toEqual(["derived", "named-in-text"]);
    expect(now.filter(([, , flagged]) => flagged).map(([, id]) => id)).toEqual([enrolledId, enrolledId]);
  });

  it("find_measures by ORS section keeps the Version, flagged", () => {
    const was = itemsOf(readOf(before, clientOf()).bySection);
    const now = itemsOf(readOf(after, clientOf()).bySection);

    expect(was.map(([, id]) => id)).toContain(enrolledId);
    expect(now.map(([group, id]) => [group, id])).toEqual(was.map(([group, id]) => [group, id]));
    expect(now.filter(([, , flagged]) => flagged).map(([, id]) => id)).toEqual([enrolledId]);
  });

  it("search's Agency filter never brings the Version back, and still finds the Versions the feed lists", () => {
    const was = readOf(before, clientOf()).hits.map((hit) => hit.id);
    const now = readOf(after, clientOf()).hits.map((hit) => hit.id);

    expect(was).toContain(enrolledId);
    expect(now).not.toContain(enrolledId);
    expect(now).toContain(aEngrossedId);
  });

  it("get_measure says the Version's links are the A-Engrossed Version's beside its own flag (ADR-0036)", () => {
    const was = readOf(before, clientOf()).versions.find((version) => version.id === enrolledId);
    const versions = readOf(after, clientOf()).versions;
    const enrolled = versions.find((version) => version.id === enrolledId);
    const aEngrossed = versions.find((version) => version.id === aEngrossedId);

    expect(was?.same_links_as).toBe(aEngrossedId);
    expect(was?.no_longer_listed).toBeUndefined();
    // Its links are still the A-Engrossed Version's, so they are not listed again; the flag is its own and is shown.
    expect(enrolled?.no_longer_listed).toBe(true);
    expect(enrolled?.same_links_as).toBe(aEngrossedId);
    expect(enrolled?.text_read).toBeUndefined();
    expect(enrolled?.statute_links).toBeUndefined();
    expect(aEngrossed?.no_longer_listed).toBeUndefined();
    expect(aEngrossed?.text_read).toBe(true);
  });
});
