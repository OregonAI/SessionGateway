// Seam 1 (test/CLAUDE.md): what `search` tells an agent about a citation whose item the index holds and the feed no
// longer lists (ADR-0005, ADR-0030). Search leaves such a document out, so no hit is an exact match for the citation;
// `get_document` still serves it. The answer's note must not say the index has no such item, which is false: it names
// the item's id, says `get_document` still serves it, and gives the time the feed last listed it.
//
// Each case has a system of its own: the first pull is a copy of the run's template for its clock (test/CLAUDE.md,
// "Templates"), and the pulls after what the fake OLIS stops listing are real, because they are the thing under test.
// The case
// reads it with both kinds of MCP client. The rows are real ones of the fixture: SB 69's Proposed Amendment -2 (postings
// 26286 and 26288, feed/CommitteeProposedAmendments.json), and the Introduced Versions of SB 69 and SB 921, the only
// documents of the early Session whose text names ORS 192.245 (`pdftotext -raw`; search.test.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];

vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

type Outcome = { hits: { id: string; document_id: string }[]; notes: string[] };

async function searched(system: System, era: Era, query: string): Promise<Outcome> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "search", { query });
    expect(outcome.isError, outcome.text).toBe(false);
    return {
      hits: outcome.structured?.["results"] as Outcome["hits"],
      notes: outcome.structured?.["notes"] as string[],
    };
  } finally {
    await connected.close();
  }
}

async function everyClient(check: (era: Era) => Promise<void>): Promise<void> {
  for (const era of eras) await check(era);
}

describe("a Proposed Amendment the index holds and the feed no longer lists", () => {
  const isPosting = (id: number) => (row: Record<string, unknown>) => row["ProposedAmendmentId"] === id;
  // 10:00 on 2025-02-01, 02-02 and 02-03 in Oregon, which was on UTC-8: after both postings.
  const days = ["2025-02-01T18:00:00Z", "2025-02-02T18:00:00Z", "2025-02-03T18:00:00Z"] as const;

  async function startOnFirstDay(): Promise<System> {
    const system = await startCopiedSystem({ clockAt: days[0], documents: true });
    started.push(system);
    return system;
  }

  it("is cited in a note that names it, says get_document serves it and when it was last listed", async () => {
    const system = await startOnFirstDay();
    stopListing(system.olis, "CommitteeProposedAmendments", isPosting(26286));
    stopListing(system.olis, "CommitteeProposedAmendments", isPosting(26288));
    for (const day of days.slice(1)) {
      system.clock.set(day);
      await system.pullAgain();
    }

    await everyClient(async (era) => {
      const outcome = await searched(system, era, "SB 69-2");
      expect(outcome.hits.map((hit) => hit.id)).not.toContain("amendment-2025r1-sb69-2");
      expect(outcome.notes).toEqual([
        'The Proposed Amendment "SB 69-2" (amendment-2025r1-sb69-2) is in the index, but the Legislature\'s feed no longer lists it, so search leaves it out and no hit is an exact match for it. get_document still serves it; the feed last listed it 2025-02-01T10:00:00-08:00.',
      ]);
    });
  });

  it("is not cited in a note while the feed lists one of its postings", async () => {
    const system = await startOnFirstDay();
    stopListing(system.olis, "CommitteeProposedAmendments", isPosting(26288));
    for (const day of days.slice(1)) {
      system.clock.set(day);
      await system.pullAgain();
    }

    await everyClient(async (era) => {
      const outcome = await searched(system, era, "SB 69-2");
      expect(outcome.hits[0]).toMatchObject({ id: "amendment-2025r1-sb69-2", document_id: "posting-2025r1-26286" });
      expect(outcome.notes).toEqual([]);
    });
  });
});

describe("an ORS section that only documents the feed no longer lists name", () => {
  // 18:00 on 2025-01-17 in Oregon, then an hour apart.
  const hours = [
    "2025-01-18T02:00:00Z",
    "2025-01-18T03:00:00Z",
    "2025-01-18T04:00:00Z",
    "2025-01-18T05:00:00Z",
    "2025-01-18T06:00:00Z",
  ] as const;
  const isIntroduced = (number: number) => (row: Record<string, unknown>) =>
    row["MeasurePrefix"] === "SB" && row["MeasureNumber"] === number && row["VersionDescription"] === "Introduced";

  it("is cited in a note only once none of the documents that name it is listed", async () => {
    const system = await startCopiedSystem({ clockAt: hours[0], documents: true });
    started.push(system);

    // SB 69's Introduced Version goes first. SB 921's still names the section and is listed.
    stopListing(system.olis, "MeasureDocuments", isIntroduced(69));
    for (const hour of hours.slice(1, 3)) {
      system.clock.set(hour);
      await system.pullAgain();
    }
    await everyClient(async (era) => {
      const outcome = await searched(system, era, "ORS 192.245");
      expect(outcome.hits[0]).toMatchObject({ id: "version-2025r1-sb921-introduced" });
      expect(outcome.hits.map((hit) => hit.id)).not.toContain("version-2025r1-sb69-introduced");
      expect(outcome.notes).toEqual([]);
    });

    // Then SB 921's: the last pull that listed it was the third, at 20:00.
    stopListing(system.olis, "MeasureDocuments", isIntroduced(921));
    for (const hour of hours.slice(3)) {
      system.clock.set(hour);
      await system.pullAgain();
    }
    await everyClient(async (era) => {
      const outcome = await searched(system, era, "ORS 192.245");
      expect(outcome.hits.map((hit) => hit.id)).not.toContain("version-2025r1-sb921-introduced");
      expect(outcome.notes).toEqual([
        'No document the feed lists names "ORS 192.245" (ors-192.245), so no hit is an exact match for it. The index still holds 2 documents that name it and are no longer listed: get_document serves them, and the latest of them, version-2025r1-sb921-introduced, was last listed 2025-01-17T20:00:00-08:00.',
      ]);
    });
  });
});
