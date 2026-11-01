// Seam 1 (test/CLAUDE.md): a database built before the listing tables (ADR-0030, "Consequences"). Its rows were stored
// by pulls that kept no record of listing them, and the worker that upgrades the file creates the tables empty. A row
// that no complete pull has listed is read as listed, not yet checked: it is searchable, the tools show it with no flag,
// and nothing throws for it. `forgetListing` (test/support/old-database.ts) arranges the file; the assertions are the
// tools', read with both kinds of MCP client from one system for each case: a copy of the run's template for the clock, which
// is the state the first pull leaves (test/CLAUDE.md, "Templates"); the pulls after `forgetListing` are the subject.
//
// The rows are real ones of the fixture: HB 3131's Testimony 117165 (the Oregon Climate and Agriculture Network's
// letter, created 2025-01-17 15:16 Pacific) and 117166 (American Farmland Trust's, created 16:17), and SB 69's
// Proposed Amendment -2 (postings 26286 and 26288, feed/CommitteeProposedAmendments.json).
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { forgetListing } from "../support/old-database.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];

vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 17:00, 18:00 and 19:00 on 2025-01-17 in Oregon, which was on UTC-8.
const firstPull = "2025-01-18T01:00:00Z";
const secondPull = "2025-01-18T02:00:00Z";
const thirdPull = "2025-01-18T03:00:00Z";
// 10:00 on 2025-02-01: after both postings of SB 69-2.
const afterPostings = "2025-02-01T18:00:00Z";

const letter = "testimony-2025r1-117165";

async function start(clockAt: string, documents: boolean): Promise<System> {
  const system = await startCopiedSystem({ clockAt, documents });
  started.push(system);
  return system;
}

/** One call, for one kind of client. */
async function call(system: System, era: Era, tool: string, args: Record<string, unknown>) {
  const connected = await connectClient(era, system.handler);
  try {
    return await callTool(connected, tool, args);
  } finally {
    await connected.close();
  }
}

const idsFound = async (system: System, era: Era): Promise<string[]> => {
  const outcome = await call(system, era, "search", {
    query: "riparian planting and cover cropping",
    measure: "HB 3131",
  });
  expect(outcome.isError, outcome.text).toBe(false);
  return (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);
};

async function everyClient(check: (era: Era) => Promise<void>): Promise<void> {
  for (const era of eras) await check(era);
}

describe("a database whose rows no complete pull has listed", () => {
  it("serves every tool: the rows read as listed, not yet checked by a pull", async () => {
    const system = await start(firstPull, true);
    forgetListing(system.database.path);

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);

      const document = await call(system, era, "get_document", { id: letter });
      expect(document.isError, document.text).toBe(false);
      expect(document.structured).toMatchObject({ id: letter, no_longer_listed: false, last_listed_at: null });

      const testimony = await call(system, era, "testimony", { measure: "HB 3131" });
      expect(testimony.isError, testimony.text).toBe(false);
      expect(testimony.structured).toMatchObject({ total: 2 });
      expect(JSON.stringify(testimony.structured)).not.toContain("no_longer_listed");

      const measure = await call(system, era, "get_measure", { measure: "HB 3131" });
      expect(measure.isError, measure.text).toBe(false);
      expect(JSON.stringify(measure.structured)).not.toContain("no_longer_listed");

      const meetings = await call(system, era, "meetings", { measure: "HB 3131" });
      expect(meetings.isError, meetings.text).toBe(false);
      expect(JSON.stringify(meetings.structured)).not.toContain("no_longer_listed");
    });
  });

  it("serves a Proposed Amendment, whose listing is its postings'", async () => {
    const system = await start(afterPostings, true);
    forgetListing(system.database.path);

    await everyClient(async (era) => {
      const document = await call(system, era, "get_document", { id: "amendment-2025r1-sb69-2" });
      expect(document.isError, document.text).toBe(false);
      expect(document.structured).toMatchObject({
        document_id: "posting-2025r1-26288",
        no_longer_listed: false,
        last_listed_at: null,
      });
    });
  });

  it("says of a Testimony it never fetched what it said before: the next pull fetches it", async () => {
    const system = await start(firstPull, false);
    forgetListing(system.database.path);

    await everyClient(async (era) => {
      const document = await call(system, era, "get_document", { id: letter });
      expect(document.isError).toBe(true);
      expect(document.text).toContain("next pull fetches it");
    });
  });

  // The first complete pull after the upgrade lists the rows it reads. A row it does not read, because OLIS stopped
  // listing it before the upgrade, has no row of its own for it to age: it stays as it was, listed and not yet checked.
  it("keeps a row the first complete pull after the upgrade does not read listed, not yet checked", async () => {
    const system = await start(firstPull, true);
    forgetListing(system.database.path);
    stopListing(system.olis, "CommitteePublicTestimonies", (row) => row["CommTestId"] === 117165);
    system.clock.set(secondPull);
    await system.pullAgain();
    system.clock.set(thirdPull);
    await system.pullAgain();

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);
      const unread = await call(system, era, "get_document", { id: letter });
      expect(unread.isError, unread.text).toBe(false);
      expect(unread.structured).toMatchObject({ no_longer_listed: false, last_listed_at: null });
      const read = await call(system, era, "get_document", { id: "testimony-2025r1-117166" });
      expect(read.structured).toMatchObject({
        no_longer_listed: false,
        last_listed_at: "2025-01-17T19:00:00-08:00",
      });
      const testimony = await call(system, era, "testimony", { measure: "HB 3131" });
      expect(testimony.isError, testimony.text).toBe(false);
    });
  });
});
