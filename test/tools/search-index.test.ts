// Seam 1 (test/CLAUDE.md): what the ingest worker makes of the passages it stores, as an operator reads it in
// build-report.json, and what the server finds once a pull has stored them. Each case builds its own system and
// pulls more than once, moving the clock between pulls. The embedder is the fake (test/support/fake-embedder.ts):
// the cases are about how often a passage is embedded and whether the server sees a new pull, not about how
// well anything ranks.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

const systems: System[] = [];

afterEach(async () => {
  for (const system of systems.splice(0)) await system.stop();
});

async function start(clockAt: string): Promise<System> {
  const system = await startSystem({ clockAt, documents: true });
  systems.push(system);
  return system;
}

type SearchIndexReport = {
  model: string;
  passages: number;
  keyword_only_passages: number;
  embedded: number;
  reused: number;
};

function searchIndexOf(system: System): SearchIndexReport {
  return system.buildReport()["search_index"] as SearchIndexReport;
}

// SB 64's Testimony 117286 and 117289 are byte-identical files (`cmp` finds no difference), a letter from the Oregon
// Center for Public Policy on SB 438 of 2023. The feed created 117286 on 2025-01-22 at 14:14:53 Pacific, 117288 at
// 14:35:58 and 117289 at 14:36:45 (CommitteePublicTestimonies rows), and no document at any time in between.
describe("identical Testimony", () => {
  const firstPull = "2025-01-22T22:36:00Z"; // 14:36 Pacific: 117286 is in, 117289 is not
  const secondPull = "2025-01-22T22:37:00Z"; // 14:37 Pacific: 117289 is the only document the feed created since

  it("is embedded once: a pull that stores the twin of a letter the index holds embeds none of its passages", async () => {
    const system = await start(firstPull);

    const first = searchIndexOf(system);
    expect(first.passages).toBeGreaterThan(0);
    expect(first.embedded).toBeGreaterThan(0);
    expect(first.embedded + first.reused + first.keyword_only_passages).toBe(first.passages);

    system.clock.set(secondPull);
    await system.pullAgain();

    const second = searchIndexOf(system);
    expect(second.passages).toBeGreaterThan(0);
    expect(second.embedded).toBe(0);
    expect(second.reused).toBe(second.passages);
    expect(second.keyword_only_passages).toBe(0);
  }, 60_000);

  it("embeds nothing when a pull finds nothing new: an unchanged passage is never embedded again", async () => {
    const system = await start(firstPull);
    const model = searchIndexOf(system).model;

    await system.pullAgain();

    expect(searchIndexOf(system)).toEqual({
      model,
      passages: 0,
      keyword_only_passages: 0,
      embedded: 0,
      reused: 0,
    });
  }, 60_000);

  it("is still found by meaning, each letter by its own id, and the server sees the second letter once the pull has stored it", async () => {
    const system = await start(firstPull);
    const connected = await connectClient("2026-07-28", system.handler);
    // Words of the letter ("implement monthly disbursement of state tax credits"), and one that no document has,
    // so that no passage holds all of them and only the meaning of the passages can bring the letter up.
    const query = {
      query: "plan to implement monthly disbursement of state tax credits household eligibility zzqx",
      measure: "SB 64",
      kind: "testimony",
    };
    const idsOf = (outcome: { structured: Record<string, unknown> | undefined }): string[] =>
      (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);

    const before = await callTool(connected, "search", query);
    expect(idsOf(before)).toContain("testimony-2025r1-117286");
    expect(idsOf(before)).not.toContain("testimony-2025r1-117289");

    system.clock.set(secondPull);
    await system.pullAgain();

    const after = await callTool(connected, "search", query);
    expect(idsOf(after)).toEqual(expect.arrayContaining(["testimony-2025r1-117286", "testimony-2025r1-117289"]));
    const hits = after.structured?.["results"] as { id: string; found_by: string[] }[];
    expect(hits.find((hit) => hit.id === "testimony-2025r1-117289")?.found_by).toEqual(["embedding"]);
    expect(after.structured?.["as_of"]).toBe("2025-01-22T14:37:00-08:00");
    await connected.close();
  }, 60_000);
});
