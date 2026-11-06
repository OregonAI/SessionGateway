// Seam 1 (test/CLAUDE.md): the tools leave out every row created after the server's clock (ticket #151, ADR-0056), so an
// evaluation question sees the Session as it stood at its moment. A fake OLIS serves the committed fixture and its
// documents as the feed stands on 2026-08-05, when every row of it exists, and the worker pulls them. Each case then
// moves the one injected clock back to a moment before a row's CreatedDate and calls the tools, and moves it on to a
// moment after and calls them again: the database never changes, so what differs is the clock alone.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md, Database,
// Templates), the one get-document.test.ts reads. The cases only move the clock; no pull follows.
//
// Expected values are literals from the fixture's feed rows (test/fixtures/olis-2025R1/feed/), read as Pacific time
// (ADR-0056): each case names the row and its CreatedDate. A moment is written with the Pacific offset in force on its day
// (-08:00 in winter, -07:00 in summer), a second before or after the row's own time where the case is about the edge.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient, type ToolOutcome } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

// The cases make a few hundred calls on a clock that is moved back and forth, so the default ceiling of 120 a minute
// would refuse the last ones.
beforeAll(async () => {
  system = await startCopiedSystem({
    clockAt: "2026-08-05T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "100000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

const boli = "bureau-of-labor-and-industries";

/** The parts of get_measure's answer the cases of ticket #153 read. */
type MeasureView = {
  sponsors: { legislator_code: string }[];
  committee_sponsors: { committee_code: string }[];
  history: { text: string }[];
  floor_votes: { votes: unknown[] }[];
  committee_votes: { committee_code: string; votes: unknown[] }[];
};

/** Whether an answer names an id anywhere: in a field of its structured result or in its text. */
function names(outcome: ToolOutcome, id: string): boolean {
  return JSON.stringify(outcome.structured ?? null).includes(id) || outcome.text.includes(id);
}

describe.for(eras)("the tools at a clock before a row's CreatedDate and after it, for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  /** Moves the clock to a moment and asks one tool. */
  async function askAt(moment: string, tool: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    system.clock.set(moment);
    return callTool(connected, tool, args);
  }

  // SB 69's A-Engrossed Version: the MeasureDocuments row's CreatedDate is "2025-02-03T16:42:28.117", Pacific, which is
  // 2025-02-04T00:42:28Z. Its Introduced Version, created "2025-01-10T13:20:19.467", is shown at both moments as the
  // control. 16:50 on 2025-02-03 in Pacific time is already 2025-02-04 in UTC, so a clock read as if it were UTC would
  // hide the row for most of the day it was created on; the morning of that day is before it.
  describe("a Version", () => {
    const version = "version-2025r1-sb69-a-engrossed";
    const introduced = "version-2025r1-sb69-introduced";
    const before = "2025-02-03T08:00:00-08:00";
    const after = "2025-02-03T16:50:00-08:00";
    // find_measures names only the Versions with a link to the Agency, and the Introduced Version has none.
    const tools: [string, Record<string, unknown>, boolean][] = [
      ["find_measures", { agency: boli }, false],
      ["search", { query: "SB 69" }, true],
      ["get_measure", { measure: "SB 69" }, true],
    ];

    it.for(tools)(
      "is left out of %s before its CreatedDate and shown after it",
      async ([tool, args, namesIntroduced]) => {
        const early = await askAt(before, tool, args);
        expect(early.isError).toBe(false);
        expect(names(early, version)).toBe(false);
        expect(names(early, introduced)).toBe(namesIntroduced);

        const late = await askAt(after, tool, args);
        expect(late.isError).toBe(false);
        expect(names(late, version)).toBe(true);
        expect(names(late, introduced)).toBe(namesIntroduced);
      },
    );

    it("is not served by get_document before its CreatedDate, which answers as for an id the index does not know", async () => {
      const early = await askAt(before, "get_document", { id: version });
      const unknown = await askAt(before, "get_document", { id: "version-2025r1-sb69-z-engrossed" });

      expect(early.isError).toBe(true);
      expect(early.text).toBe(unknown.text.replace("version-2025r1-sb69-z-engrossed", version));
      // None of the document leaks: not its text, its address or its hash.
      expect(JSON.stringify(early.structured ?? null)).not.toContain("a-engrossed.pdf");
      expect(early.text).not.toContain("Downloads/MeasureDocument/SB69/A-Engrossed");

      const late = await askAt(after, "get_document", { id: version });
      expect(late.isError).toBe(false);
      expect(late.structured).toMatchObject({ id: version, kind: "version" });
    });

    it("is hidden to the second: at 16:42:28 it is not created yet, and at 16:42:29 it is", async () => {
      const second = await askAt("2025-02-03T16:42:28-08:00", "get_document", { id: version });
      expect(second.isError).toBe(true);

      const next = await askAt("2025-02-03T16:42:29-08:00", "get_document", { id: version });
      expect(next.isError).toBe(false);
    });

    it("is shown to a clock in summer time by the offset of its own day: SB 983's Enrolled Version, created 2025-06-17T17:21:27.18 Pacific", async () => {
      const early = await askAt("2025-06-17T17:21:27-07:00", "get_document", { id: "version-2025r1-sb983-enrolled" });
      expect(early.isError).toBe(true);

      const late = await askAt("2025-06-17T17:21:28-07:00", "get_document", { id: "version-2025r1-sb983-enrolled" });
      expect(late.isError).toBe(false);
    });
  });

  // SB 69's Proposed Amendment -2: its first posting is row 26286, created "2025-01-23T16:27:27.63" (CommitteeProposedAmendments.json),
  // posted to SLB's meeting of 2025-01-28; -1's first posting, 26284, was created "2025-01-17T16:39:33.207" and is the
  // control. Both -1 and -2 are posted again on 2025-01-23 to the meeting of 01-28 (rows 26285 and 26286).
  describe("a Proposed Amendment posting", () => {
    const amendment = "amendment-2025r1-sb69-2";
    const control = "amendment-2025r1-sb69-1";
    const before = "2025-01-23T09:00:00-08:00";
    const after = "2025-01-23T17:00:00-08:00";
    const tools: [string, Record<string, unknown>][] = [
      ["find_measures", { agency: boli }],
      ["search", { query: "SB 69-2" }],
      ["get_measure", { measure: "SB 69" }],
      ["meetings", { committee: "SLB", from: "2025-01-28", to: "2025-01-28" }],
    ];

    it.for(tools)("is left out of %s before its CreatedDate and shown after it", async ([tool, args]) => {
      const early = await askAt(before, tool, args);
      expect(early.isError).toBe(false);
      expect(names(early, amendment)).toBe(false);

      const late = await askAt(after, tool, args);
      expect(late.isError).toBe(false);
      expect(names(late, amendment)).toBe(true);
    });

    it("leaves -1 where it was: its first posting was created on 2025-01-17", async () => {
      const early = await askAt(before, "find_measures", { agency: boli });
      expect(names(early, control)).toBe(true);
      const meeting = await askAt(before, "meetings", { committee: "SLB", from: "2025-01-21", to: "2025-01-21" });
      expect(names(meeting, control)).toBe(true);
    });

    it("is not served by get_document before its CreatedDate, which answers as for an id the index does not know", async () => {
      const early = await askAt(before, "get_document", { id: amendment });
      const unknown = await askAt(before, "get_document", { id: "amendment-2025r1-sb69-9" });

      expect(early.isError).toBe(true);
      expect(early.text).toBe(unknown.text.replace("amendment-2025r1-sb69-9", amendment));

      const late = await askAt(after, "get_document", { id: amendment });
      expect(late.isError).toBe(false);
    });
  });

  // HB 3131's Testimony: 42 rows (41 support, 1 oppose) once all exist. The first 35 were created by 2025-01-23 and are all
  // support; the one oppose row, 117368, was created "2025-01-24T08:08:14.01" (CommitteePublicTestimonies.json).
  describe("Testimony", () => {
    it("lists the rows created by the clock: 35 on the morning of 2025-01-24, all support, then 42 with the one oppose", async () => {
      const early = await askAt("2025-01-24T00:00:00-08:00", "testimony", { measure: "HB 3131" });
      expect(early.structured).toMatchObject({ total: 35 });
      const earlyPositions = early.structured?.["positions"] as { position: string; count: number }[];
      expect(earlyPositions.map(({ position, count }) => [position, count])).toEqual([["support", 35]]);

      const late = await askAt("2026-08-05T10:00:00-07:00", "testimony", { measure: "HB 3131" });
      expect(late.structured).toMatchObject({ total: 42 });
      const positions = late.structured?.["positions"] as { position: string; count: number }[];
      expect(positions.map(({ position, count }) => [position, count])).toEqual([
        ["support", 41],
        ["oppose", 1],
      ]);
    });

    it("shows the oppose row from the second after it was created, and not at the second it was", async () => {
      const second = await askAt("2025-01-24T08:08:14-08:00", "testimony", { measure: "HB 3131" });
      expect(second.structured).toMatchObject({ total: 35 });

      const next = await askAt("2025-01-24T08:08:15-08:00", "testimony", { measure: "HB 3131" });
      expect(next.structured).toMatchObject({ total: 36 });
      expect(names(next, "testimony-2025r1-117368")).toBe(true);
    });

    it("is not served by get_document before its CreatedDate, and not as a row listed but not held", async () => {
      const early = await askAt("2025-01-24T08:08:14-08:00", "get_document", { id: "testimony-2025r1-117368" });
      const unknown = await askAt("2025-01-24T08:08:14-08:00", "get_document", { id: "testimony-2025r1-999999" });

      expect(early.isError).toBe(true);
      expect(early.text).toBe(unknown.text.replace("testimony-2025r1-999999", "testimony-2025r1-117368"));
      expect(early.text).not.toContain("is listed in the");
    });
  });

  // SLB's Exhibit 287879 (a Meeting Material of 2025-01-21): CommitteeMeetingDocuments row created "2025-01-17T16:19:17.2266922",
  // seven decimals, so a clock at 16:19:17 is before it and one at 16:19:18 after.
  describe("an Exhibit", () => {
    const exhibit = "exhibit-2025r1-287879";
    const args = { committee: "SLB", from: "2025-01-21", to: "2025-01-21" };

    it("is left out of meetings at the second it was created in and listed the second after", async () => {
      const early = await askAt("2025-01-17T16:19:17-08:00", "meetings", args);
      expect(early.isError).toBe(false);
      expect(names(early, "meeting-2025r1-slb-2025-01-21-0800")).toBe(true);
      expect(names(early, exhibit)).toBe(false);

      const late = await askAt("2025-01-17T16:19:18-08:00", "meetings", args);
      expect(names(late, exhibit)).toBe(true);
    });
  });

  // HALNRW's Recording Log of 2025-01-22, row 288741, was created "2025-01-29T13:13:06.5416935"; its second log, 289259 of
  // 2025-01-27, on "2025-02-03T11:07:10.8054981". Their speaker turns follow them: HB 3131 is taken up in both, and
  // get_measure lists a hearing for each log it is in.
  describe("a Recording Log and its speaker turns", () => {
    const first = "recording-log-2025r1-288741";
    const second = "recording-log-2025r1-289259";
    const args = { committee: "HALNRW", from: "2025-01-22", to: "2025-01-22" };

    it("is left out of meetings and of get_measure's hearings until it is created, and its turns with it", async () => {
      const early = await askAt("2025-01-29T13:13:06-08:00", "meetings", args);
      expect(names(early, "meeting-2025r1-halnrw-2025-01-22-0800")).toBe(true);
      expect(names(early, first)).toBe(false);
      const earlyHearings = await askAt("2025-01-29T13:13:06-08:00", "get_measure", { measure: "HB 3131" });
      expect(names(earlyHearings, first)).toBe(false);
      expect(names(earlyHearings, second)).toBe(false);

      const late = await askAt("2025-01-29T13:13:07-08:00", "meetings", args);
      expect(names(late, first)).toBe(true);
      const lateHearings = await askAt("2025-01-29T13:13:07-08:00", "get_measure", { measure: "HB 3131" });
      expect(names(lateHearings, first)).toBe(true);
      expect(names(lateHearings, second)).toBe(false);

      const both = await askAt("2025-02-03T11:07:11-08:00", "get_measure", { measure: "HB 3131" });
      expect(names(both, second)).toBe(true);
    });

    it("is not served by get_document, with its turns, before it is created", async () => {
      const early = await askAt("2025-01-29T13:13:06-08:00", "get_document", { id: first });
      expect(early.isError).toBe(true);
      expect(early.structured?.["speaker_turns"]).toBeUndefined();

      const late = await askAt("2025-01-29T13:13:07-08:00", "get_document", { id: first });
      expect(late.isError).toBe(false);
      expect(late.structured?.["speaker_turns"]).toBeDefined();
    });
  });

  // HALNRW's meeting of 2025-01-22 08:00: the CommitteeMeetings row's CreatedDate is "2025-01-17T14:16:07", Pacific, and
  // the row has the feed's only AgendaUrl for the meeting, so its agenda document (a document of its own, ADR-0056) is
  // created with the meeting's row. There is no agenda row with a time of its own (check #151: CommitteeAgendaItems rows
  // carry none, and the agenda is a column of the meeting).
  describe("an agenda", () => {
    const agenda = "agenda-2025r1-halnrw-2025-01-22-0800";
    const args = { committee: "HALNRW", from: "2025-01-22", to: "2025-01-22" };

    it("is left out of meetings the second before its meeting row was created and listed at the second it was", async () => {
      const early = await askAt("2025-01-17T14:16:06-08:00", "meetings", args);
      expect(early.isError).toBe(false);
      // Ticket #153: the meeting row is created at the same second as its agenda, so neither is there yet (it was listed here before).
      expect(names(early, "meeting-2025r1-halnrw-2025-01-22-0800")).toBe(false);
      expect(names(early, agenda)).toBe(false);

      const late = await askAt("2025-01-17T14:16:07-08:00", "meetings", args);
      expect(names(late, agenda)).toBe(true);
    });

    it("is not served by get_document before it is created, which answers as for an id the index does not know", async () => {
      const early = await askAt("2025-01-17T14:16:06-08:00", "get_document", { id: agenda });
      const unknown = await askAt("2025-01-17T14:16:06-08:00", "get_document", {
        id: "agenda-2025r1-halnrw-2025-01-22-0900",
      });
      expect(early.isError).toBe(true);
      expect(early.text).toBe(unknown.text.replace("agenda-2025r1-halnrw-2025-01-22-0900", agenda));

      const late = await askAt("2025-01-17T14:16:07-08:00", "get_document", { id: agenda });
      expect(late.isError).toBe(false);
    });
  });

  // Ticket #153: the rows of MeasureSponsors, MeasureHistoryActions, MeasureVotes, CommitteeVotes, CommitteeMeetings and
  // CommitteeAgendaItems carry a CreatedDate in the feed (FloorLetters carries none: see hide-future-rows-no-time.test.ts).
  // Each case names the row and its CreatedDate; a clock a second before it is the "before", the second itself the "after"
  // (a row created at the clock's instant is shown).
  const measureAt = async (moment: string, measure: string): Promise<MeasureView> => {
    const outcome = await askAt(moment, "get_measure", { measure });
    expect(outcome.isError, outcome.text).toBe(false);
    return outcome.structured as MeasureView;
  };

  describe("a sponsor", () => {
    // MeasureSponsors 148617: Sen Reynolds on SB 64, created "2025-01-23T08:49:51". Sen Hayden (142250, "2024-12-20T17:28:43") is the control.
    it("is left out of get_measure's sponsors a second before its CreatedDate and listed at it", async () => {
      const early = await measureAt("2025-01-23T08:49:50-08:00", "SB 64");
      const codes = (sponsors: { legislator_code: string }[]) => sponsors.map((sponsor) => sponsor.legislator_code);
      expect(codes(early.sponsors)).toContain("Sen Hayden");
      expect(codes(early.sponsors)).not.toContain("Sen Reynolds");

      const late = await measureAt("2025-01-23T08:49:51-08:00", "SB 64");
      expect(codes(late.sponsors)).toContain("Sen Reynolds");
    });

    // MeasureSponsors 149379: the committee SED on SB 983, created "2025-02-03T17:56:47".
    it("leaves a committee sponsor out the same way: SED on SB 983", async () => {
      const early = await measureAt("2025-02-03T17:56:46-08:00", "SB 983");
      expect(early.committee_sponsors).toEqual([]);
      const late = await measureAt("2025-02-03T17:56:47-08:00", "SB 983");
      expect(late.committee_sponsors).toEqual([{ committee_code: "SED" }]);
    });
  });

  describe("a history action", () => {
    // MeasureHistoryActions 620210 on SB 69: ActionDate "2025-02-03T10:37:16", CreatedDate "2025-02-03T10:41:38". A clock
    // between the two hides it: the row is not there until OLIS created it, whatever the action's own date.
    const texts = (measure: MeasureView) => measure.history.map((line) => line.text);

    it("is left out while the clock is before its CreatedDate, though after its ActionDate, and listed at it", async () => {
      const between = await measureAt("2025-02-03T10:40:00-08:00", "SB 69");
      expect(texts(between)).toContain("Referred to Labor and Business.");
      expect(texts(between)).not.toContain("Recommendation: Do pass with amendments.  (Printed A-Eng.)");

      const late = await measureAt("2025-02-03T10:41:38-08:00", "SB 69");
      expect(texts(late)).toContain("Recommendation: Do pass with amendments.  (Printed A-Eng.)");
      expect(texts(late)).not.toContain("Second reading.");
    });
  });

  describe("a floor vote", () => {
    // MeasureVotes of SB 69's Senate vote (MeasureHistoryId 620916): 30 entries, all created "2025-02-06T11:21:40"; its history
    // action, created "2025-02-06T11:21:34", is there before the vote.
    it("is left out of get_measure's floor_votes until its entries are created, when all 30 appear", async () => {
      const early = await measureAt("2025-02-06T11:21:39-08:00", "SB 69");
      expect((early.history as { text: string }[]).map((line) => line.text)).toContain(
        "Third reading.  Carried by Bonham.  Passed.",
      );
      expect(early.floor_votes).toEqual([]);

      const late = await measureAt("2025-02-06T11:21:40-08:00", "SB 69");
      expect(late.floor_votes).toHaveLength(1);
      expect(late.floor_votes[0]?.votes).toHaveLength(30);
    });
  });

  describe("a committee vote", () => {
    // CommitteeVotes of SB 69 at SLB: 5 entries (324937 to 324941), CreatedDate "2025-01-23T07:44:41", for the meeting of
    // "2025-01-30T08:00:00". OLIS creates a committee's vote rows before the meeting and fills in the votes at it (the
    // owner's decision of 2026-11-05; in the 2025R1 cache all 21,959 CommitteeVotes rows are created before their meeting's
    // start), so a vote counts from the later of the two: not at its CreatedDate, but at the meeting's start.
    it("is left out of get_measure's committee_votes from its CreatedDate up to the meeting's start, and all 5 appear at the meeting", async () => {
      const beforeCreated = await measureAt("2025-01-23T07:44:40-08:00", "SB 69");
      expect(beforeCreated.committee_votes).toEqual([]);

      const created = await measureAt("2025-01-23T07:44:41-08:00", "SB 69");
      expect(created.committee_votes).toEqual([]);

      const aSecondBefore = await measureAt("2025-01-30T07:59:59-08:00", "SB 69");
      expect(aSecondBefore.committee_votes).toEqual([]);

      const atMeeting = await measureAt("2025-01-30T08:00:00-08:00", "SB 69");
      expect(atMeeting.committee_votes).toHaveLength(1);
      expect(atMeeting.committee_votes[0]?.committee_code).toBe("SLB");
      expect(atMeeting.committee_votes[0]?.votes).toHaveLength(5);
    });

    // A floor vote and a history action keep their CreatedDate: SB 69's Senate vote of 2025-02-06 is shown at its CreatedDate
    // (see the case above), which is the same decision's other half.
  });

  describe("a meeting and its agenda items", () => {
    // SLB's meeting of 2025-01-21 08:00 was created "2025-01-15T13:40:11"; its agenda item 201898 (SB 69, an
    // Informational Meeting) "2025-01-17T15:12:24". The meeting of 2025-01-30 and its item 202165 were both created
    // "2025-01-23T07:44:41".
    const slb21 = { committee: "SLB", from: "2025-01-21", to: "2025-01-21" };
    const meeting21 = "meeting-2025r1-slb-2025-01-21-0800";

    it("leaves the meeting out of meetings before its row was created and lists it at the second it was", async () => {
      const early = await askAt("2025-01-15T13:40:10-08:00", "meetings", slb21);
      expect(names(early, meeting21)).toBe(false);
      const late = await askAt("2025-01-15T13:40:11-08:00", "meetings", slb21);
      expect(names(late, meeting21)).toBe(true);
    });

    it("leaves an agenda item out of meetings, and the meeting out of a search by Measure, until the item was created", async () => {
      const early = await askAt("2025-01-17T15:12:23-08:00", "meetings", slb21);
      expect(names(early, meeting21)).toBe(true);
      expect(early.structured?.["meetings"]).toMatchObject([{ id: meeting21, agenda_items: [] }]);
      const byMeasure = await askAt("2025-01-17T15:12:23-08:00", "meetings", {
        measure: "SB 69",
        from: "2025-01-21",
        to: "2025-01-21",
      });
      expect(names(byMeasure, meeting21)).toBe(false);

      const late = await askAt("2025-01-17T15:12:24-08:00", "meetings", slb21);
      expect(late.structured?.["meetings"]).toMatchObject([
        { id: meeting21, agenda_items: [{ measure_id: "measure-2025r1-sb69", meeting_type: "Informational Meeting" }] },
      ]);
      const lateByMeasure = await askAt("2025-01-17T15:12:24-08:00", "meetings", {
        measure: "SB 69",
        from: "2025-01-21",
        to: "2025-01-21",
      });
      expect(names(lateByMeasure, meeting21)).toBe(true);
    });
  });

  // The meaning side of search (owner decision A, 2026-11-05): one handler is asked at a late clock, which loads the
  // vectors of every document, and then at an early one. A hit the early clock hides is no hit, and no error names it.
  describe("search at a late clock and then at an early one, on one handler", () => {
    const version = "version-2025r1-sb69-a-engrossed";
    const queries = ["SB 69", "employer labor wages", "workers"];

    it.for(queries)("gives no hidden hit and no error for %s", async (query) => {
      const late = await askAt("2026-08-05T10:00:00-07:00", "search", { query });
      expect(late.isError).toBe(false);
      const early = await askAt("2025-02-03T08:00:00-08:00", "search", { query });
      expect(early.isError).toBe(false);
      expect(names(early, version)).toBe(false);
      expect(early.text).not.toContain("The index has no document");
      const again = await askAt("2025-02-03T16:50:00-08:00", "search", { query });
      expect(again.isError).toBe(false);
    });

    it("finds the document by meaning at a clock that has reached it, after a clock that had not", async () => {
      const early = await askAt("2025-02-03T08:00:00-08:00", "search", { query: "SB 69" });
      expect(names(early, version)).toBe(false);
      const late = await askAt("2025-02-03T16:50:00-08:00", "search", { query: "SB 69" });
      expect(names(late, version)).toBe(true);
    });
  });

  // Owner decision of 2026-11-05: the Measure's location is one value of the last pull, and the history does not carry
  // enough to derive where the Measure was at an earlier clock (a row has a chamber, a date and free text, no location). So at
  // a clock before the database's as_of the stored location is kept and marked as of the last pull, with the pull's time;
  // at or after as_of there is no marker. This database's pull ran at 2026-08-05T17:00:00Z (the beforeAll clock), which
  // get_measure gives as "2026-08-05T10:00:00-07:00"; SB 69's stored location is "Chapter Number Assigned".
  describe("a Measure's location at a clock before the last pull", () => {
    type Located = { as_of: string; location: { current: string; as_of?: string } };
    const located = async (moment: string): Promise<Located> => {
      const outcome = await askAt(moment, "get_measure", { measure: "SB 69" });
      expect(outcome.isError, outcome.text).toBe(false);
      return outcome.structured as Located;
    };

    it("is marked as of the last pull, with its time, at 2025-02-03T10:40-08:00", async () => {
      const early = await located("2025-02-03T10:40:00-08:00");
      expect(early.location).toMatchObject({ current: "Chapter Number Assigned", as_of: "2026-08-05T10:00:00-07:00" });
    });

    it("has no marker at the last pull's time or after it", async () => {
      const at = await located("2026-08-05T10:00:00-07:00");
      expect(at.location).toEqual({ current: "Chapter Number Assigned", committee_code: null });
      const after = await located("2026-08-06T10:00:00-07:00");
      expect(after.location).toEqual({ current: "Chapter Number Assigned", committee_code: null });
    });
  });

  // A Measure's own row is stamped too: SB 69's Measures row says "created" before every clock above. A clock before
  // it hides the Measure: it is no Measure the index knows.
  describe("a Measure", () => {
    it("is unknown to get_measure at a clock before its CreatedDate", async () => {
      const early = await askAt("2024-12-01T00:00:00-08:00", "get_measure", { measure: "SB 69" });
      expect(early.isError).toBe(true);
    });
  });
});
