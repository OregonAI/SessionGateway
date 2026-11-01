// Seam 1 (test/CLAUDE.md): the two-pull rule of ADR-0005, as an agent sees it through `search` and `get_document`.
// A row that two complete full pulls in a row did not list is no longer listed: it leaves search results and
// stays fetchable by id (spec #1, story 47). Each case builds its own system, because the pulls and what the fake
// OLIS lists at each are the thing under test, and reads it with both kinds of MCP client (test/CLAUDE.md,
// "MCP client"): the pulls are the cost of a case, and a call is not.
//
// The row is a real one: HB 3131's Testimony 117165 (Oregon Climate and Agriculture Network, a letter created
// 2025-01-17 15:16 Pacific; feed/CommitteePublicTestimonies.json). The fake OLIS stops listing it with
// `stopListing` (test/support/unlisted-rows.ts), which changes the row the way OLIS would have, from the pull
// after. The embedder is the fake: nothing here is about how well a meaning ranks.
//
// It covers a Testimony row the fake stops listing and the postings of SB 69-2, seen through `search` and
// `get_document` on an early clock with the fake embedder. The pulls move the clock an hour or a day at a time, so
// that each has an as-of time of its own.
// Which cases copy (test/CLAUDE.md, "Templates"): the first pull of each case, the state before the feed stops listing a row, is a copy of the run's template for its clock; the pulls after the change are real pulls, because the two-pull rule is the subject.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startCopiedSystem, startSystem, type System } from "../support/system.ts";
import { listAgain, stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];

// A case that serves the documents extracts the early Session's few files in each pull of a system of its own.
vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

// 17:00, 18:00, 19:00 and 20:00 on 2025-01-17 in Oregon, which was on UTC-8: pulls an hour apart, so that each
// has an as-of time of its own. Testimony 117165 was created at 15:16 that day, before the first.
const firstPull = "2025-01-18T01:00:00Z";
const secondPull = "2025-01-18T02:00:00Z";
const thirdPull = "2025-01-18T03:00:00Z";
const fourthPull = "2025-01-18T04:00:00Z";

const letter = "testimony-2025r1-117165";
const isLetter = (row: Record<string, unknown>): boolean => row["CommTestId"] === 117165;

async function start(clockAt: string = firstPull): Promise<System> {
  const system = await startCopiedSystem({ clockAt, documents: true });
  started.push(system);
  return system;
}

/** The ids of the hits for words only 117165 holds ("riparian planting and cover cropping"), in HB 3131's scope. */
async function idsFound(system: System, era: Era): Promise<string[]> {
  const connected = await connectClient(era, system.handler);
  try {
    const outcome = await callTool(connected, "search", {
      query: "riparian planting and cover cropping",
      measure: "HB 3131",
    });
    expect(outcome.isError).toBe(false);
    return (outcome.structured?.["results"] as { id: string }[]).map((hit) => hit.id);
  } finally {
    await connected.close();
  }
}

async function getDocument(system: System, era: Era, id: string) {
  const connected = await connectClient(era, system.handler);
  try {
    return await callTool(connected, "get_document", { id });
  } finally {
    await connected.close();
  }
}

/** Runs `check` once for each kind of MCP client, against the one system. */
async function everyClient(check: (era: Era) => Promise<void>): Promise<void> {
  for (const era of eras) await check(era);
}

/** Runs a complete full pull at `at`, as the worker does on a night. */
async function pullAt(system: System, at: string): Promise<void> {
  system.clock.set(at);
  await system.pullAgain();
}

describe("a row two complete pulls in a row do not list", () => {
  it("leaves search but is still fetched by id, flagged and dated by the last pull that listed it", async () => {
    const system = await start();
    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);
    });

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);
    await pullAt(system, thirdPull);

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).not.toContain(letter);
      const document = await getDocument(system, era, letter);
      expect(document.isError).toBe(false);
      expect(document.structured).toMatchObject({
        id: letter,
        has_text_layer: true,
        no_longer_listed: true,
        last_listed_at: "2025-01-17T17:00:00-08:00",
        as_of: "2025-01-17T19:00:00-08:00",
      });
      expect(document.structured?.["text"]).toContain("riparian planting and cover cropping");
    });
  });

  // One missing pull is not a withdrawal (ADR-0005): the row is searchable, get_document does not flag it, and the
  // time it was last listed is the first pull's, since the second pull did not list it.
  it("stays searchable, and unflagged, after one complete pull misses it", async () => {
    const system = await start();

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);
      const document = await getDocument(system, era, letter);
      expect(document.structured).toMatchObject({
        id: letter,
        no_longer_listed: false,
        last_listed_at: "2025-01-17T17:00:00-08:00",
        as_of: "2025-01-17T18:00:00-08:00",
      });
    });
  });

  // "In a row": a pull that lists the row ends the count of pulls that missed it.
  it("stays searchable when the two pulls that missed it were not in a row", async () => {
    const system = await start();

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);
    listAgain(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, thirdPull);
    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, fourthPull);

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);
      const document = await getDocument(system, era, letter);
      expect(document.structured).toMatchObject({
        no_longer_listed: false,
        last_listed_at: "2025-01-17T19:00:00-08:00",
        as_of: "2025-01-17T20:00:00-08:00",
      });
    });
  });

  it("is listed again when a complete pull lists it again", async () => {
    const system = await start();
    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);
    await pullAt(system, thirdPull);
    await everyClient(async (era) => {
      expect(await idsFound(system, era)).not.toContain(letter);
    });

    listAgain(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, fourthPull);

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);
      const document = await getDocument(system, era, letter);
      expect(document.structured).toMatchObject({
        no_longer_listed: false,
        last_listed_at: "2025-01-17T20:00:00-08:00",
        as_of: "2025-01-17T20:00:00-08:00",
      });
    });
  });

  // The server holds the vectors in memory and reads them again when the index's as-of time or its generation moves
  // (ADR-0025). Three pulls at one instant share an as-of time, so only the generation can tell the server that a
  // document left the meaning side, and that it came back. The fake embedder puts every document of HB 3131 on the
  // meaning side of this query, so a hit that is found by "embedding" is a vector the server still holds.
  it("leaves the meaning side, and returns to it, though the pulls share an as-of time", async () => {
    const system = await start();
    const foundBy = async (era: Era): Promise<string[] | undefined> => {
      const connected = await connectClient(era, system.handler);
      try {
        const outcome = await callTool(connected, "search", {
          query: "riparian planting and cover cropping",
          measure: "HB 3131",
        });
        const hits = outcome.structured?.["results"] as { id: string; found_by: string[] }[];
        return hits.find((hit) => hit.id === letter)?.found_by;
      } finally {
        await connected.close();
      }
    };
    await everyClient(async (era) => {
      expect(await foundBy(era)).toEqual(["keyword", "embedding"]);
    });

    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await system.pullAgain();
    await system.pullAgain();
    await everyClient(async (era) => {
      expect(await foundBy(era)).toBeUndefined();
    });

    listAgain(system.olis, "CommitteePublicTestimonies", isLetter);
    await system.pullAgain();
    await everyClient(async (era) => {
      expect(await foundBy(era)).toEqual(["keyword", "embedding"]);
    });
  });
});

// A pull that is short of the feed's counts is refused whole (full-pull-report.test.ts): it is not a pull that missed
// the row, and it is not one that listed it. `withholdLastRows(1)` is a feed that counted its rows and paged one
// fewer of each set, so the last Testimony row of the early Session, 117166 (American Farmland Trust's letter,
// created 16:17), is the one it leaves out.
describe("a pull that is short of the feed's counts", () => {
  const otherLetter = "testimony-2025r1-117166";
  const incomplete = /counted \d+.*read \d+/;

  async function otherLetterFound(system: System, era: Era): Promise<boolean> {
    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "search", {
        query: "Natural Resources Conservation Service",
        measure: "HB 3131",
      });
      return (outcome.structured?.["results"] as { id: string }[]).some((hit) => hit.id === otherLetter);
    } finally {
      await connected.close();
    }
  }

  it("removes nothing, however many of them there are in a row", async () => {
    const system = await start();
    await everyClient(async (era) => {
      expect(await otherLetterFound(system, era)).toBe(true);
    });

    system.olis.withholdLastRows(1);
    system.clock.set(secondPull);
    await expect(system.pullAgain()).rejects.toThrow(incomplete);
    system.clock.set(thirdPull);
    await expect(system.pullAgain()).rejects.toThrow(incomplete);
    system.olis.withholdLastRows(0);

    await everyClient(async (era) => {
      expect(await otherLetterFound(system, era)).toBe(true);
      const document = await getDocument(system, era, otherLetter);
      expect(document.structured).toMatchObject({
        no_longer_listed: false,
        last_listed_at: "2025-01-17T17:00:00-08:00",
        as_of: "2025-01-17T17:00:00-08:00",
      });
    });
  });

  // The refused pull is neither a pull that missed the row nor one that listed it: between the two complete pulls
  // that missed 117165 it counts for nothing, and the second of them is still "two in a row" among complete pulls.
  it("is not one of the two pulls that must miss a row in a row", async () => {
    const system = await start();
    stopListing(system.olis, "CommitteePublicTestimonies", isLetter);
    await pullAt(system, secondPull);

    system.olis.withholdLastRows(1);
    system.clock.set(thirdPull);
    await expect(system.pullAgain()).rejects.toThrow(incomplete);
    system.olis.withholdLastRows(0);
    await everyClient(async (era) => {
      expect(await idsFound(system, era)).toContain(letter);
    });

    await pullAt(system, fourthPull);

    await everyClient(async (era) => {
      expect(await idsFound(system, era)).not.toContain(letter);
      const document = await getDocument(system, era, letter);
      expect(document.structured).toMatchObject({
        no_longer_listed: true,
        last_listed_at: "2025-01-17T17:00:00-08:00",
        as_of: "2025-01-17T20:00:00-08:00",
      });
    });
  });
});

// SB 69's -2 is one node with two postings (ADR-0011): ProposedAmendmentId 26286, posted to SLB's meeting of 2025-01-28
// and Proposed, and 26288, posted to the meeting of 2025-01-30 and Adopted (feed/CommitteeProposedAmendments.json).
// The amendment is listed while the feed lists any of its postings; `get_document` serves the node's latest posting as
// ADR-0011 says, and search offers the latest posting that is listed.
describe("a Proposed Amendment whose postings the feed stops listing", () => {
  const node = "amendment-2025r1-sb69-2";
  // 10:00 on 2025-02-01, 02-02 and 02-03 in Oregon: after both postings.
  const days = ["2025-02-01T18:00:00Z", "2025-02-02T18:00:00Z", "2025-02-03T18:00:00Z", "2025-02-04T18:00:00Z"];
  const isPosting = (id: number) => (row: Record<string, unknown>) => row["ProposedAmendmentId"] === id;

  async function hitFor(system: System, era: Era): Promise<{ id: string; document_id: string } | undefined> {
    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "search", { query: "SB 69-2" });
      return (outcome.structured?.["results"] as { id: string; document_id: string }[]).find((hit) => hit.id === node);
    } finally {
      await connected.close();
    }
  }

  it("is listed while any posting is, and is offered by its latest posting that is listed", async () => {
    const system = await start(days[0]);
    stopListing(system.olis, "CommitteeProposedAmendments", isPosting(26288));
    await pullAt(system, days[1] ?? "");
    await pullAt(system, days[2] ?? "");

    await everyClient(async (era) => {
      expect((await getDocument(system, era, node)).structured).toMatchObject({
        id: node,
        document_id: "posting-2025r1-26288",
        no_longer_listed: false,
        last_listed_at: "2025-02-03T10:00:00-08:00",
      });
      expect((await getDocument(system, era, "posting-2025r1-26288")).structured).toMatchObject({
        no_longer_listed: true,
        last_listed_at: "2025-02-01T10:00:00-08:00",
      });
      expect(await hitFor(system, era)).toMatchObject({ id: node, document_id: "posting-2025r1-26286" });
    });
  });

  it("is no longer listed when none of its postings is, and is served all the same", async () => {
    const system = await start(days[0]);
    stopListing(system.olis, "CommitteeProposedAmendments", isPosting(26288));
    stopListing(system.olis, "CommitteeProposedAmendments", isPosting(26286));
    await pullAt(system, days[1] ?? "");
    await pullAt(system, days[2] ?? "");

    await everyClient(async (era) => {
      expect((await getDocument(system, era, node)).structured).toMatchObject({
        id: node,
        document_id: "posting-2025r1-26288",
        no_longer_listed: true,
        last_listed_at: "2025-02-01T10:00:00-08:00",
      });
      expect(await hitFor(system, era)).toBeUndefined();
    });
  });

  // The amendment's state is its postings' feed rows, whether or not a posting's file is held. Here the file of 26288
  // (the posting listed, adopted by SLB on 2025-01-30) never came, 26286's is held and the feed stops listing 26286.
  // The amendment is listed because the feed lists 26288, so `get_document` and `meetings` say the same of it.
  it("is listed while the feed lists a posting whose file was never fetched, for get_document and meetings alike", async () => {
    const unfetched = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26288";
    const system = await startSystem({
      clockAt: days[0] ?? "",
      documents: true,
      olis: { documentFailures: { [unfetched]: [404, 404, 404] } },
    });
    started.push(system);
    stopListing(system.olis, "CommitteeProposedAmendments", isPosting(26286));
    await pullAt(system, days[1] ?? "");
    await pullAt(system, days[2] ?? "");

    await everyClient(async (era) => {
      expect((await getDocument(system, era, node)).structured).toMatchObject({
        id: node,
        document_id: "posting-2025r1-26286",
        no_longer_listed: false,
        last_listed_at: "2025-02-03T10:00:00-08:00",
      });
      expect((await getDocument(system, era, "posting-2025r1-26286")).structured).toMatchObject({
        no_longer_listed: true,
        last_listed_at: "2025-02-01T10:00:00-08:00",
      });

      const connected = await connectClient(era, system.handler);
      try {
        const outcome = await callTool(connected, "meetings", {
          committee: "SLB",
          from: "2025-01-28",
          to: "2025-01-30",
        });
        const postings = (
          outcome.structured?.["meetings"] as {
            proposed_amendments: { id: string; document_id: string; fetched: boolean; no_longer_listed?: boolean }[];
          }[]
        )
          .flatMap((meeting) => meeting.proposed_amendments)
          .filter((posting) => posting.id === node);
        expect(postings.map((posting) => [posting.document_id, posting.fetched, posting.no_longer_listed])).toEqual([
          ["posting-2025r1-26286", true, true],
          ["posting-2025r1-26288", false, undefined],
        ]);
      } finally {
        await connected.close();
      }
    });
  });
});
