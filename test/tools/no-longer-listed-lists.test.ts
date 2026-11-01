// Seam 1 (test/CLAUDE.md): what the tools that list rows do with one the feed no longer lists (ADR-0005, ADR-0030).
// Spec #1 and ADR-0005 say only that such a row leaves search results and stays fetchable by id. The other tools
// neither hide it nor show it as if nothing had happened: a row two complete pulls in a row have not listed is
// still in the list, with `no_longer_listed: true`. The flag is on the item and is left out of every item that is
// listed, so a list that nothing has left is the list it was.
//
// One system for each kind of MCP client is built and changed once (the feed stops listing seven rows and two
// complete pulls go by), and the cases read it, so the early Session's files are pulled twice and not twelve times.
// The rows are real ones of the fixture, named by their feed ids in the comments; `stopListing` is the fake's way
// of making OLIS stop listing one (test/support/unlisted-rows.ts).
//
// On a system of its own it also covers the Versions and postings of `get_measure`'s statute links.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";
import { stopListing } from "../support/unlisted-rows.ts";

// The analysis document is listed only once its file is fetched, so the system serves the documents: the files that
// exist on the first day are pulled once, which takes seconds and more with the other files' workers running beside it.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// 10:00 on 2025-02-12 in Oregon, which was on UTC-8, then the next two days: three nightly pulls. By then HB 3131 has
// all its 42 Testimony rows (the last was created on 2025-01-28), SB 983 exists (created 02-03) and so does the Fiscal
// Impact Statement 85869 (created 02-11), and the fixture's later rows, and the most of its 278 files, do not.
const firstPull = "2025-02-12T18:00:00Z";
const secondPull = "2025-02-13T18:00:00Z";
const thirdPull = "2025-02-14T18:00:00Z";

/** Two complete pulls in a row go by after `stop` has made the feed stop listing some rows. */
async function twoPullsWithout(system: System, stop: () => void): Promise<void> {
  stop();
  system.clock.set(secondPull);
  await system.pullAgain();
  system.clock.set(thirdPull);
  await system.pullAgain();
}

type Flagged = { id?: string; no_longer_listed?: boolean };
const flaggedIds = (items: readonly Flagged[]): (string | undefined)[] =>
  items.filter((item) => item.no_longer_listed === true).map((item) => item.id);

describe.for(eras)("a list tool, for a %s client", (era) => {
  let system: System;
  let connected: ConnectedClient;

  // SLB's meetings (feed/CommitteeMeetings.json) of 2025-01-28 and 2025-01-30. The latter has one agenda item,
  // CommitteeAgendaItemId 202165 (SB 69, Public Hearing and Work Session); two Exhibits, CommitteeMeetingDocumentId
  // 288650 (the Preliminary SMS of SB 69-2) and 289456 (the witness registration); and two postings,
  // ProposedAmendmentId 26287 (-1, Proposed) and 26288 (-2, Adopted). The feed stops listing the former meeting's row
  // and, of the latter, the item, the Exhibit 288650 and the posting 26287; HB 3131's Testimony 117165 (the Oregon
  // Climate and Agriculture Network's letter) and Fiscal Impact Statement 85869; and the Measures row of SB 983.
  beforeAll(async () => {
    system = await startSystem({ clockAt: firstPull, documents: true });
    await twoPullsWithout(system, () => {
      const olis = system.olis;
      stopListing(olis, "CommitteePublicTestimonies", (row) => row["CommTestId"] === 117165);
      stopListing(olis, "MeasureAnalysisDocuments", (row) => row["MeasureAnalysisId"] === "85869");
      stopListing(olis, "Measures", (row) => row["MeasurePrefix"] === "SB" && row["MeasureNumber"] === 983);
      stopListing(olis, "CommitteeAgendaItems", (row) => row["CommitteeAgendaItemId"] === 202165);
      stopListing(olis, "CommitteeMeetingDocuments", (row) => row["CommitteeMeetingDocumentId"] === 288650);
      stopListing(olis, "CommitteeProposedAmendments", (row) => row["ProposedAmendmentId"] === 26287);
      stopListing(
        olis,
        "CommitteeMeetings",
        (row) => row["CommitteeCode"] === "SLB" && row["MeetingDate"] === "2025-01-28T08:00:00",
      );
    });
    connected = await connectClient(era, system.handler);
  }, 60_000);

  afterAll(async () => {
    await connected.close();
    await system.stop();
  });

  async function call(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const outcome = await callTool(connected, tool, args);
    expect(outcome.isError, outcome.text).toBe(false);
    return outcome.structured ?? {};
  }

  // `total` already says that a row OLIS has stopped listing is still counted (ticket #14): the row stays, and now
  // says so.
  it("testimony: lists a Testimony the feed no longer lists, flagged, and still counts it", async () => {
    const result = await call("testimony", { measure: "HB 3131" });

    expect(result["total"]).toBe(42);
    const items = (result["positions"] as { organizations: { items: Flagged[] }[] }[])
      .flatMap((position) => position.organizations)
      .flatMap((group) => group.items);
    expect(items).toHaveLength(42);
    expect(flaggedIds(items)).toEqual(["testimony-2025r1-117165"]);
  });

  it("meetings: lists an agenda item, an Exhibit and a posting the feed no longer lists, flagged", async () => {
    const result = await call("meetings", { committee: "SLB", from: "2025-01-30", to: "2025-01-30" });

    const [meeting] = result["meetings"] as (Flagged & {
      agenda: Flagged;
      agenda_items: Flagged[];
      exhibits: Flagged[];
      proposed_amendments: (Flagged & { document_id: string })[];
    })[];
    expect(meeting?.id).toBe("meeting-2025r1-slb-2025-01-30-0800");
    expect(meeting?.no_longer_listed).toBeUndefined();
    expect(meeting?.agenda.no_longer_listed).toBeUndefined();
    expect(meeting?.agenda_items).toHaveLength(1);
    expect(meeting?.agenda_items[0]?.no_longer_listed).toBe(true);
    expect(flaggedIds(meeting?.exhibits ?? [])).toEqual(["exhibit-2025r1-288650"]);
    expect(
      (meeting?.proposed_amendments ?? [])
        .filter((posting) => posting.no_longer_listed === true)
        .map((posting) => posting.document_id),
    ).toEqual(["posting-2025r1-26287"]);
  });

  // A meeting row the feed no longer lists takes its agenda with it: the agenda is the row's AgendaUrl.
  it("meetings: flags a meeting the feed no longer lists, and its agenda", async () => {
    const result = await call("meetings", { committee: "SLB", from: "2025-01-28", to: "2025-01-30" });

    const found = result["meetings"] as (Flagged & { agenda: Flagged })[];
    expect(found.map((meeting) => [meeting.id, meeting.no_longer_listed, meeting.agenda.no_longer_listed])).toEqual([
      ["meeting-2025r1-slb-2025-01-28-0800", true, true],
      ["meeting-2025r1-slb-2025-01-30-0800", undefined, undefined],
    ]);
  });

  it("get_measure: flags an analysis document the feed no longer lists", async () => {
    const result = await call("get_measure", { measure: "HB 3131" });

    const groups = (result["analysis_documents"] as { by_version: { documents: Flagged[] }[] }).by_version;
    expect(flaggedIds(groups.flatMap((group) => group.documents))).toEqual(["analysis-2025r1-85869"]);
    expect(result["no_longer_listed"]).toBeUndefined();
  });

  // The Measure is still fetchable by id, with when the feed last listed it.
  it("get_measure: serves a Measure the feed no longer lists, flagged and dated", async () => {
    const result = await call("get_measure", { measure: "SB 983" });

    expect(result).toMatchObject({
      id: "measure-2025r1-sb983",
      no_longer_listed: true,
      last_listed_at: "2025-02-12T10:00:00-08:00",
      as_of: "2025-02-14T10:00:00-08:00",
    });
    const other = await call("get_measure", { measure: "SB 69" });
    expect(other["no_longer_listed"]).toBeUndefined();
  });
});

describe.for(eras)("get_document on a Testimony no pull fetched, for a %s client", (era) => {
  // The files are off, so the worker fetched none: HB 3131's Testimony 117165 is a row the feed listed and the index
  // holds no file for. While the feed lists it, get_document says the next pull fetches it (testimony-made-up.test.ts);
  // once the feed does not, no pull will, and it says that instead.
  it("says plainly that a Testimony the feed no longer lists was never fetched", async () => {
    const system = await startSystem({ clockAt: firstPull });
    try {
      await twoPullsWithout(system, () => {
        stopListing(system.olis, "CommitteePublicTestimonies", (row) => row["CommTestId"] === 117165);
      });
      const connected = await connectClient(era, system.handler);
      try {
        const outcome = await callTool(connected, "get_document", { id: "testimony-2025r1-117165" });

        expect(outcome.isError).toBe(true);
        expect(outcome.text).toContain("testimony-2025r1-117165");
        expect(outcome.text).toContain("is not any more");
        expect(outcome.text).toContain("never fetched its file");
        expect(outcome.text).toContain("no later pull will fetch it");
        expect(outcome.text).not.toContain("next pull fetches");
      } finally {
        await connected.close();
      }
    } finally {
      await system.stop();
    }
  });
});

// The Versions and postings that `get_measure` shows in statute_links_by_source carry ids that `get_document` resolves, and
// `get_document` says of them that the feed no longer lists them; so `get_measure` flags them as it flags its other
// lists. SB 69 on 10:00 on 2025-02-01 has one Version (Introduced) and two current amendments: -1, posted as 26284 (SLB,
// 2025-01-21), 26285 (01-28) and 26287 (01-30), and -2, posted as 26286 and 26288. The feed stops listing the Introduced Version
// (MeasureDocuments) and posting 26287, and two complete pulls go by. Compare_amendment shows the same postings.
describe("get_measure's statute links, when the feed stops listing a Version and a posting", () => {
  const days = ["2025-02-01T18:00:00Z", "2025-02-02T18:00:00Z", "2025-02-03T18:00:00Z"] as const;

  it("flags the Version and the posting, and no other", async () => {
    const system = await startSystem({ clockAt: days[0], documents: true });
    try {
      stopListing(
        system.olis,
        "MeasureDocuments",
        (row) =>
          row["MeasurePrefix"] === "SB" && row["MeasureNumber"] === 69 && row["VersionDescription"] === "Introduced",
      );
      stopListing(system.olis, "CommitteeProposedAmendments", (row) => row["ProposedAmendmentId"] === 26287);
      for (const day of days.slice(1)) {
        system.clock.set(day);
        await system.pullAgain();
      }

      for (const era of eras) {
        const connected = await connectClient(era, system.handler);
        try {
          const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });
          expect(outcome.isError, outcome.text).toBe(false);
          const links = outcome.structured?.["statute_links_by_source"] as {
            versions: Flagged[];
            proposed_amendments: { id: string; postings: Flagged[] }[];
          };
          expect(links.versions.map((version) => [version.id, version.no_longer_listed])).toEqual([
            ["version-2025r1-sb69-introduced", true],
          ]);
          expect(
            links.proposed_amendments.flatMap((amendment) =>
              amendment.postings.map((posting) => [amendment.id, posting.id, posting.no_longer_listed]),
            ),
          ).toEqual([
            ["amendment-2025r1-sb69-1", "posting-2025r1-26284", undefined],
            ["amendment-2025r1-sb69-1", "posting-2025r1-26285", undefined],
            ["amendment-2025r1-sb69-1", "posting-2025r1-26287", true],
            ["amendment-2025r1-sb69-2", "posting-2025r1-26286", undefined],
            ["amendment-2025r1-sb69-2", "posting-2025r1-26288", undefined],
          ]);
        } finally {
          await connected.close();
        }
      }
    } finally {
      await system.stop();
    }
  });
});
