// Seam 1 (test/CLAUDE.md): rows the feed no longer lists, whose files this index never fetched (ADR-0005, ADR-0030):
// `get_document` on them, and the count of the analysis documents `get_measure` says it has not fetched.
//
// `get_document` on a row the feed no longer lists, for each of the two
// things the index can hold of it. If it fetched the file while the feed listed the row, the file is served, flagged. If it
// never did, there is nothing to serve and no later pull will fetch the file, since the feed does not list the row any
// more: `get_document` answers with a tool error that says exactly that, and not that the id is unknown or that the
// next pull fetches it.
//
// The rows are real ones of the fixture, on the first day after they exist (10:00 on 2025-02-01 in Oregon, UTC-8):
// SB 69's Exhibit 288650 (the Preliminary SMS of SB 69-2, CommitteeMeetingDocuments) and its Proposed Amendment -2,
// postings 26286 and 26288 (CommitteeProposedAmendments). `stopListing` makes the fake OLIS stop listing a row; two
// complete pulls in a row then miss it.
//
// It also covers the `fetched` descriptions of the output schemas.
// Which cases copy (test/CLAUDE.md, "Templates"): the first pull of each case, the state before the feed stops listing
// a row, is a copy of the run's template for its clock; the pulls after the change are real pulls, because the two-pull
// rule is the subject.
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type Era } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

const started: System[] = [];

vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

const days = ["2025-02-01T18:00:00Z", "2025-02-02T18:00:00Z", "2025-02-03T18:00:00Z"] as const;

/** A system on the first day whose feed stops listing some rows, and two complete pulls in a row that miss them. */
async function afterTwoMissedPulls(documents: boolean, stop: (olis: System["olis"]) => void): Promise<System> {
  const system = await startCopiedSystem({ clockAt: days[0], documents });
  started.push(system);
  stop(system.olis);
  for (const day of days.slice(1)) {
    system.clock.set(day);
    await system.pullAgain();
  }
  return system;
}

async function getDocument(system: System, era: Era, id: string) {
  const connected = await connectClient(era, system.handler);
  try {
    return await callTool(connected, "get_document", { id });
  } finally {
    await connected.close();
  }
}

async function everyClient(check: (era: Era) => Promise<void>): Promise<void> {
  for (const era of eras) await check(era);
}

const exhibit = "exhibit-2025r1-288650";
const stopExhibit = (olis: System["olis"]): void => {
  stopListing(olis, "CommitteeMeetingDocuments", (row) => row["CommitteeMeetingDocumentId"] === 288650);
};

/** The error an agent is told: the id, that the feed lists the row no more, and that no pull will fetch the file. */
function expectNeverFetchedError(outcome: { isError: boolean; text: string }, id: string): void {
  expect(outcome.isError).toBe(true);
  expect(outcome.text).toContain(`"${id}"`);
  expect(outcome.text).toContain("was listed in the 2025R1 Session and is not any more");
  expect(outcome.text).toContain("never fetched its file");
  expect(outcome.text).toContain("no later pull will fetch it");
  expect(outcome.text).toContain("2025-02-01T10:00:00-08:00");
  expect(outcome.text).not.toContain("next pull fetches");
  expect(outcome.text).not.toContain("No document");
}

describe("an Exhibit the feed no longer lists", () => {
  it("is served, flagged, when this index fetched its file", async () => {
    const system = await afterTwoMissedPulls(true, stopExhibit);

    await everyClient(async (era) => {
      const outcome = await getDocument(system, era, exhibit);
      expect(outcome.isError, outcome.text).toBe(false);
      expect(outcome.structured).toMatchObject({
        id: exhibit,
        no_longer_listed: true,
        last_listed_at: "2025-02-01T10:00:00-08:00",
      });
    });
  });

  it("is a tool error that says its file was never fetched and no pull will fetch it, when it was not", async () => {
    const system = await afterTwoMissedPulls(false, stopExhibit);

    await everyClient(async (era) => {
      expectNeverFetchedError(await getDocument(system, era, exhibit), exhibit);
    });
  });
});

describe("a Proposed Amendment the feed no longer lists", () => {
  const stopPostings = (olis: System["olis"]): void => {
    stopListing(olis, "CommitteeProposedAmendments", (row) => row["ProposedAmendmentId"] === 26286);
    stopListing(olis, "CommitteeProposedAmendments", (row) => row["ProposedAmendmentId"] === 26288);
  };

  it("is a tool error for a posting and for the amendment, when no file of it was fetched", async () => {
    const system = await afterTwoMissedPulls(false, stopPostings);

    await everyClient(async (era) => {
      expectNeverFetchedError(await getDocument(system, era, "posting-2025r1-26286"), "posting-2025r1-26286");
      expectNeverFetchedError(await getDocument(system, era, "amendment-2025r1-sb69-2"), "amendment-2025r1-sb69-2");
    });
  });

  // Owner decision of 2026-11-07 (ticket #116, ADR-0059): every kind the feed lists before its file is fetched is a listed
  // row with no file. While the feed lists a posting, the posting and its amendment are such rows, not unknown ids.
  it("is a listed row with no file, not an unknown id, while the feed lists a posting", async () => {
    const system = await afterTwoMissedPulls(false, (olis) => {
      stopListing(olis, "CommitteeProposedAmendments", (row) => row["ProposedAmendmentId"] === 26286);
    });

    await everyClient(async (era) => {
      const posting = await getDocument(system, era, "posting-2025r1-26288");
      expect(posting.isError).toBe(true);
      expect(posting.text).toMatch(/listed .*holds no file/);
      expect(posting.text).not.toContain("No document");
      const amendment = await getDocument(system, era, "amendment-2025r1-sb69-2");
      expect(amendment.isError).toBe(true);
      expect(amendment.text).toMatch(/listed .*holds no file/);
      expect(amendment.text).not.toContain("No document");
    });
  });
});

// What an agent reads before it calls anything: the output schemas. A `fetched: false` on a row flagged `no_longer_listed`
// is a file no pull will fetch, and the schemas must not promise that a later pull does.
describe("the output schemas of testimony and meetings", () => {
  /** Every `fetched` property's description in a JSON Schema, wherever it is nested. */
  function fetchedDescriptions(schema: unknown): string[] {
    if (typeof schema !== "object" || schema === null) return [];
    const found: string[] = [];
    const entries: [string, unknown][] = Object.entries(schema);
    for (const [name, value] of entries) {
      if (name === "fetched" && typeof value === "object" && value !== null && "description" in value) {
        found.push(String(value.description));
      } else {
        found.push(...fetchedDescriptions(value));
      }
    }
    return found;
  }

  it("say, for every fetched flag, that no pull fetches the file of a row the feed no longer lists", async () => {
    const system = await startCopiedSystem({ clockAt: days[0], documents: false });
    started.push(system);
    for (const era of eras) {
      const connected = await connectClient(era, system.handler);
      try {
        const { tools } = await connected.client.listTools();
        for (const name of ["testimony", "meetings"]) {
          const descriptions = fetchedDescriptions(tools.find((tool) => tool.name === name)?.outputSchema);
          expect(descriptions.length, name).toBeGreaterThan(0);
          for (const description of descriptions) expect(description, name).toContain("no pull will fetch the file");
        }
      } finally {
        await connected.close();
      }
    }
  });
});

// `get_measure` counts the analysis documents the feed lists for a Measure and this index has not fetched. The count follows
// the two-pull rule like everything else: one complete pull that misses a row changes nothing, and a row that two complete
// pulls in a row have missed stops counting. HB 3131 at 10:00 on 2025-02-12 has two analysis rows, 85719 and 85869
// (feed/MeasureAnalysisDocuments.json); the files are off, so neither is fetched.
// The next row, 85989, is created on 02-13 at 16:33, after the pulls here.
describe("the not-held count of a Measure's analysis documents", () => {
  const hours = ["2025-02-12T18:00:00Z", "2025-02-12T19:00:00Z", "2025-02-12T20:00:00Z"] as const;

  async function notHeld(system: System, era: Era): Promise<unknown> {
    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });
      expect(outcome.isError, outcome.text).toBe(false);
      return (outcome.structured?.["analysis_documents"] as { not_held: number }).not_held;
    } finally {
      await connected.close();
    }
  }

  it("is unchanged by one pull that misses a row, and drops the row once two in a row have", async () => {
    const system = await startCopiedSystem({ clockAt: hours[0], documents: false });
    started.push(system);
    await everyClient(async (era) => {
      expect(await notHeld(system, era)).toBe(2);
    });

    stopListing(system.olis, "MeasureAnalysisDocuments", (row) => row["MeasureAnalysisId"] === "85869");
    system.clock.set(hours[1]);
    await system.pullAgain();
    await everyClient(async (era) => {
      expect(await notHeld(system, era)).toBe(2);
    });

    system.clock.set(hours[2]);
    await system.pullAgain();
    await everyClient(async (era) => {
      expect(await notHeld(system, era)).toBe(1);
    });
  });
});
