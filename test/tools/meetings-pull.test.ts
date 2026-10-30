// Seam 1 (test/CLAUDE.md): `meetings` where a case needs a database of its own: a clock the shared
// databases of meetings.test.ts and meetings-past.test.ts do not have, a clock moved after the pull, or a
// row the committed fixture lacks. Each case builds its own system, and the harness serves a made-up row
// to that one worker; the committed fixture is never edited by hand (test/fixtures/CLAUDE.md). Every
// case runs for both kinds of MCP client, so the schema check of each one sees every shape here.
import { afterEach, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient, type Era } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: { system: System; connected: ConnectedClient }[] = [];

async function start(era: Era, options: SystemOptions): Promise<{ system: System; connected: ConnectedClient }> {
  const system = await startSystem(options);
  const entry = { system, connected: await connectClient(era, system.handler) };
  started.push(entry);
  return entry;
}

afterEach(async () => {
  for (const { system, connected } of started.splice(0)) {
    await connected.close();
    await system.stop();
  }
});

type MeetingOutput = { id: string; [field: string]: unknown };

// A made-up agenda item row, shaped like the feed's (the property is spelled `CommitteCode`), for SLB's meeting of
// 2025-01-30 unless `fields` says otherwise.
function agendaItemRow(id: number, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    CommitteeAgendaItemId: id,
    SessionKey: "2025R1",
    CommitteCode: "SLB",
    MeetingDate: "2025-01-30T08:00:00",
    MeasurePrefix: null,
    MeasureNumber: null,
    BoardName: null,
    ExecutiveAppointee: null,
    MeetingType: null,
    Action: null,
    PrintOrder: null,
    Comments: null,
    ...fields,
  };
}

async function meetingsOnSb69(connected: ConnectedClient): Promise<MeetingOutput[]> {
  const outcome = await callTool(connected, "meetings", { measure: "SB 69" });
  expect(outcome.isError).toBe(false);
  return outcome.structured?.["meetings"] as MeetingOutput[];
}

describe.for(eras)("meetings with a database of its own, for a %s client", (era) => {
  describe("a Recording Log", () => {
    // MADE UP FOR THIS TEST. The committed fixture has no Recording Log row: of the 86
    // CommitteeMeetingDocuments rows, none has the type "Recording Log" (#5 found it, and ADR-0011 says how
    // the row is read when there is one). The full 2025R1 feed has 1,492 of them, one for most meetings, and
    // adding one Measure's to the fixture is a download run the owner has to approve. So this case adds a row
    // of that shape, with the made-up id 900101, to SLB's meeting of 2025-01-30, and serves a fixture file
    // (Exhibit 288650's) as its document. It shows the wiring from the row to the tool, not a real log.
    const recordingLogUrl = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/900101";

    it("is listed with the meeting it belongs to, apart from the Exhibits (made-up row)", async () => {
      const { connected } = await start(era, {
        clockAt: "2025-01-29T20:00:00Z",
        documents: true,
        olis: {
          strayRows: {
            CommitteeMeetingDocuments: [
              {
                SessionKey: "2025R1",
                CommitteeMeetingDocumentId: 900101,
                CommitteeCode: "SLB",
                MeetingDate: "2025-01-30T08:00:00",
                DocumentType: "Recording Log",
                MeasurePrefix: null,
                MeasureNumber: null,
                DocumentUrl: recordingLogUrl,
              },
            ],
          },
          strayDocuments: { [new URL(recordingLogUrl).pathname]: "committee-meeting-documents/288650.pdf" },
        },
      });

      const meetings = await meetingsOnSb69(connected);

      const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
      expect(byId.get("meeting-2025r1-slb-2025-01-30-0800")?.["recording_logs"]).toEqual([
        { id: "recording-log-2025r1-900101", label: "Recording Log", source_url: recordingLogUrl, fetched: true },
      ]);
      // It is the meeting's Recording Log and not an Exhibit, and no other meeting has it.
      expect(
        (byId.get("meeting-2025r1-slb-2025-01-30-0800")?.["exhibits"] as { id: string }[]).map((exhibit) => exhibit.id),
      ).toEqual(["exhibit-2025r1-288650"]);
      expect(byId.get("meeting-2025r1-slb-2025-01-28-0800")?.["recording_logs"]).toEqual([]);
      // Its id is one get_document resolves, to a document of its own kind.
      const served = await callTool(connected, "get_document", { id: "recording-log-2025r1-900101" });
      expect(served.isError).toBe(false);
      expect(served.structured).toMatchObject({ kind: "recording_log", source_url: recordingLogUrl });
    });
  });

  describe("agenda items that name no Measure", () => {
    // MADE UP FOR THIS TEST. Every agenda item in the committed fixture is about a Measure, but 3,598 of the
    // 9,275 in the full 2025R1 feed are not (.cache/olis-2025R1/feed/CommitteeAgendaItems.json): executive
    // appointments with a BoardName and an ExecutiveAppointee (row 202186 is one), and notices with only
    // Comments. These three rows, with the made-up ids 900201 to 900203, are shaped like those and added to
    // SLB's meeting of 2025-01-30. The PrintOrder is a string: "10" comes after "2", and an item with none is last.
    it("shows an appointment's board and appointee, and puts the items in print order (made-up rows)", async () => {
      const { connected } = await start(era, {
        clockAt: "2025-01-29T20:00:00Z",
        documents: false,
        olis: {
          strayRows: {
            CommitteeAgendaItems: [
              agendaItemRow(900203, { Comments: "<b>A notice with no print order.</b>" }),
              agendaItemRow(900202, {
                PrintOrder: "10",
                Comments: '<b>A notice.</b>\n<a href="https://example.org/">link</a>',
              }),
              agendaItemRow(900201, {
                PrintOrder: "2",
                BoardName: "Commission on Example Affairs",
                ExecutiveAppointee: "PatExample",
                MeetingType: "Public Hearing and Work Session    (Executive Appointment)",
              }),
            ],
          },
        },
      });

      const outcome = await callTool(connected, "meetings", { committee: "SLB", from: "2025-01-30", to: "2025-01-30" });

      const meetings = outcome.structured?.["meetings"] as { id: string; agenda_items: unknown[] }[];
      expect(meetings.map((meeting) => meeting.id)).toEqual(["meeting-2025r1-slb-2025-01-30-0800"]);
      expect(meetings[0]?.agenda_items).toEqual([
        expect.objectContaining({ print_order: "1", measure_id: "measure-2025r1-sb69" }),
        {
          print_order: "2",
          measure_id: null,
          meeting_type: "Public Hearing and Work Session    (Executive Appointment)",
          action: null,
          comments: null,
          board_name: "Commission on Example Affairs",
          executive_appointee: "PatExample",
        },
        expect.objectContaining({
          print_order: "10",
          measure_id: null,
          comments: '<b>A notice.</b>\n<a href="https://example.org/">link</a>',
        }),
        expect.objectContaining({ print_order: null, measure_id: null }),
      ]);
    });
  });

  describe("a file this index has not fetched", () => {
    // OLIS's feed says what is posted to a meeting; the files are fetched after the feed is read (ADR-0011,
    // "Order of a pull"), and a fetch can fail (a 404, three timeouts) or not have been reached yet. The
    // feed row says -2 was posted to SLB's 2025-01-30 meeting and adopted there (feed/CommitteeProposedAmendments.json,
    // ProposedAmendmentId 26288), so spec #1 case (c), "-1 and -2 posted", holds whether or not its file is held.
    const posting26288 = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26288";

    it("still lists a posting whose file failed, with the feed's Meaning and a flag, until a later pull fetches it", async () => {
      const { system, connected } = await start(era, {
        clockAt: "2025-01-29T20:00:00Z",
        documents: true,
        olis: { documentFailures: { [posting26288]: [404] } },
      });
      const postedOn0130 = async (): Promise<unknown> => {
        const meetings = await meetingsOnSb69(connected);
        return meetings.find((meeting) => meeting.id === "meeting-2025r1-slb-2025-01-30-0800")?.["proposed_amendments"];
      };

      expect(await postedOn0130()).toEqual([
        {
          id: "amendment-2025r1-sb69-1",
          number: "-1",
          measure_id: "measure-2025r1-sb69",
          meaning: "Proposed",
          document_id: "posting-2025r1-26287",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26287",
          fetched: true,
        },
        {
          id: "amendment-2025r1-sb69-2",
          number: "-2",
          measure_id: "measure-2025r1-sb69",
          meaning: "Adopted",
          document_id: "posting-2025r1-26288",
          source_url: posting26288,
          fetched: false,
        },
      ]);
      // The flag says what get_document will do with the id.
      const unserved = await callTool(connected, "get_document", { id: "posting-2025r1-26288" });
      expect(unserved.isError).toBe(true);
      // The file is fetched by a later pull, and the same entry then says so.
      await system.pullAgain();
      expect(await postedOn0130()).toMatchObject([
        { number: "-1", fetched: true },
        { number: "-2", meaning: "Adopted", document_id: "posting-2025r1-26288", fetched: true },
      ]);
      expect((await callTool(connected, "get_document", { id: "posting-2025r1-26288" })).isError).toBe(false);
    });

    // A first pull that has reached no file: the fake serves none (documents: false), as an index in the
    // hours of its first pull would be. The feed's rows for SB 69's three meetings (Proposed Amendments
    // 26284 to 26288; Exhibits 287879, 288365, 288569 and 288650; the three agendas) are all listed, none held.
    it("lists what the feed lists for each meeting, every file flagged as not fetched, before the first file is in", async () => {
      const { connected } = await start(era, { clockAt: "2025-01-29T20:00:00Z", documents: false });

      const meetings = (await meetingsOnSb69(connected)) as (MeetingOutput & {
        agenda: { id: string; fetched: boolean } | null;
        proposed_amendments: { number: string; document_id: string; meaning: string; fetched: boolean }[];
        exhibits: { id: string; label: string; title: string; fetched: boolean }[];
      })[];

      expect(
        meetings.map((meeting) => [
          meeting.id,
          meeting.agenda,
          meeting.proposed_amendments.map((amendment) => [
            amendment.number,
            amendment.document_id,
            amendment.meaning,
            amendment.fetched,
          ]),
          meeting.exhibits.map((exhibit) => [exhibit.id, exhibit.label, exhibit.title, exhibit.fetched]),
        ]),
      ).toEqual([
        [
          "meeting-2025r1-slb-2025-01-21-0800",
          expect.objectContaining({ id: "agenda-2025r1-slb-2025-01-21-0800", fetched: false }),
          [["-1", "posting-2025r1-26284", "Proposed", false]],
          [["exhibit-2025r1-287879", "Meeting Material", "SB 1515 Report - Josh Nasbe (report)", false]],
        ],
        [
          "meeting-2025r1-slb-2025-01-28-0800",
          expect.objectContaining({ id: "agenda-2025r1-slb-2025-01-28-0800", fetched: false }),
          [
            ["-1", "posting-2025r1-26285", "Proposed", false],
            ["-2", "posting-2025r1-26286", "Proposed", false],
          ],
          [
            ["exhibit-2025r1-288365", "Preliminary SMS", "SB 69  -2 Preliminary SMS", false],
            ["exhibit-2025r1-288569", "Witness Registration", "SB 69 (witness registration)", false],
          ],
        ],
        [
          "meeting-2025r1-slb-2025-01-30-0800",
          expect.objectContaining({ id: "agenda-2025r1-slb-2025-01-30-0800", fetched: false }),
          [
            ["-1", "posting-2025r1-26287", "Proposed", false],
            ["-2", "posting-2025r1-26288", "Adopted", false],
          ],
          [["exhibit-2025r1-288650", "Preliminary SMS", "SB 69  -2 Preliminary SMS", false]],
        ],
      ]);
    });
  });

  describe("the next meeting", () => {
    // The clock is noon in Oregon on 2025-02-12. HHED's meeting of 2025-02-13 is ahead of it, and the feed's row
    // for it says "Cancelled" (feed/CommitteeMeetings.json; the fixture holds each row's final state, so the
    // row says what it says now). The committee's next meeting is the one on 2025-02-20, which is "Scheduled".
    it("is not a cancelled meeting, which is still listed as ahead", async () => {
      const { connected } = await start(era, { clockAt: "2025-02-12T20:00:00Z", documents: false });

      const outcome = await callTool(connected, "meetings", { committee: "HHED" });

      const meetings = outcome.structured?.["meetings"] as { id: string; status: string; upcoming: boolean }[];
      expect(meetings.map((meeting) => [meeting.id, meeting.status, meeting.upcoming])).toEqual([
        ["meeting-2025r1-hhed-2025-02-06-0800", "Scheduled", false],
        ["meeting-2025r1-hhed-2025-02-13-0800", "Cancelled", true],
        ["meeting-2025r1-hhed-2025-02-20-0800", "Scheduled", true],
      ]);
      expect(outcome.structured?.["next_meeting_id"]).toBe("meeting-2025r1-hhed-2025-02-20-0800");
    });
  });

  describe("the injected clock", () => {
    // The pull is at noon Oregon time on 2025-01-29, when SLB's meeting on SB 69 at 08:00 the next day is
    // ahead (spec #1 case (c)). The clock then moves, with no second pull, to 07:00 and to 09:00 on
    // 2025-01-30, and "upcoming" and the next meeting follow it: the as-of time stays the pull's. This is
    // what a live service sees, where an increment can be hours old.
    it("measures upcoming and the next meeting from the clock's time, not from the pull's", async () => {
      const { system, connected } = await start(era, { clockAt: "2025-01-29T20:00:00Z", documents: false });
      const upcomingOnSb69 = async (): Promise<{
        now: unknown;
        asOf: unknown;
        next: unknown;
        upcoming: [string, boolean][];
      }> => {
        const outcome = await callTool(connected, "meetings", { measure: "SB 69" });
        expect(outcome.isError).toBe(false);
        const meetings = outcome.structured?.["meetings"] as { id: string; upcoming: boolean }[];
        return {
          now: outcome.structured?.["now"],
          asOf: outcome.structured?.["as_of"],
          next: outcome.structured?.["next_meeting_id"],
          upcoming: meetings.map((meeting) => [meeting.id, meeting.upcoming]),
        };
      };

      expect(await upcomingOnSb69()).toEqual({
        now: "2025-01-29T12:00:00-08:00",
        asOf: "2025-01-29T12:00:00-08:00",
        next: "meeting-2025r1-slb-2025-01-30-0800",
        upcoming: [
          ["meeting-2025r1-slb-2025-01-21-0800", false],
          ["meeting-2025r1-slb-2025-01-28-0800", false],
          ["meeting-2025r1-slb-2025-01-30-0800", true],
        ],
      });

      system.clock.set("2025-01-30T15:00:00Z");
      expect(await upcomingOnSb69()).toMatchObject({
        now: "2025-01-30T07:00:00-08:00",
        asOf: "2025-01-29T12:00:00-08:00",
        next: "meeting-2025r1-slb-2025-01-30-0800",
      });

      system.clock.set("2025-01-30T17:00:00Z");
      expect(await upcomingOnSb69()).toEqual({
        now: "2025-01-30T09:00:00-08:00",
        asOf: "2025-01-29T12:00:00-08:00",
        // The pull was before the April meetings on SB 69 were scheduled, so none is ahead.
        next: null,
        upcoming: [
          ["meeting-2025r1-slb-2025-01-21-0800", false],
          ["meeting-2025r1-slb-2025-01-28-0800", false],
          ["meeting-2025r1-slb-2025-01-30-0800", false],
        ],
      });
    });
  });

  describe("a result too long for one page", () => {
    // MADE UP FOR THIS TEST. In the full 2025R1 feed an agenda item's Comments run to 18,499 characters
    // (.cache/olis-2025R1/feed/CommitteeAgendaItems.json) and a committee's 25 meetings to 116,000 characters
    // of agenda items; the committed fixture's items are short. These rows, with the made-up ids 900301
    // and 900302, give one meeting a 26,600-character Comments, longer than a page (20,000 characters, the size
    // of one get_document part, ADR-0011 "Parts"). A page is whole days of meetings, so that `from` the day
    // after the last meeting returned is exactly where the next page starts; a meeting is never cut short.
    const longComments = "Made-up witness, Made-up Organization\n".repeat(700);

    it("starts the next page at the meeting that would not fit, and never cuts a meeting short", async () => {
      const { connected } = await start(era, {
        clockAt: "2025-07-15T17:00:00Z",
        documents: false,
        olis: {
          strayRows: {
            CommitteeAgendaItems: [
              agendaItemRow(900301, { MeetingDate: "2025-01-28T08:00:00", Comments: longComments }),
            ],
          },
        },
      });
      const page = async (from?: string): Promise<{ ids: string[]; comments: unknown; rest: unknown }> => {
        const outcome = await callTool(connected, "meetings", {
          committee: "SLB",
          ...(from === undefined ? {} : { from }),
        });
        expect(outcome.isError).toBe(false);
        const meetings = outcome.structured?.["meetings"] as (MeetingOutput & {
          agenda_items: { comments: unknown }[];
        })[];
        return {
          ids: meetings.map((meeting) => meeting.id),
          comments: meetings
            .flatMap((meeting) => meeting.agenda_items.map((item) => item.comments))
            .find((text) => text === longComments),
          rest: { matching: outcome.structured?.["matching_meetings"], truncated: outcome.structured?.["truncated"] },
        };
      };

      // SLB's six meetings (feed/CommitteeMeetings.json). The first page stops before 01-28: with its long item
      // it would run past 20,000 characters.
      expect(await page()).toEqual({
        ids: ["meeting-2025r1-slb-2025-01-21-0800"],
        comments: undefined,
        rest: { matching: 6, truncated: true },
      });
      // The meeting with the long item is a page of its own, with its Comments exactly as published.
      expect(await page("2025-01-22")).toEqual({
        ids: ["meeting-2025r1-slb-2025-01-28-0800"],
        comments: longComments,
        rest: { matching: 5, truncated: true },
      });
      expect(await page("2025-01-29")).toEqual({
        ids: [
          "meeting-2025r1-slb-2025-01-30-0800",
          "meeting-2025r1-slb-2025-03-11-0800",
          "meeting-2025r1-slb-2025-03-13-0800",
          "meeting-2025r1-slb-2025-03-18-0800",
        ],
        comments: undefined,
        rest: { matching: 4, truncated: false },
      });
    });

    // SED's and SFR's meetings of 2025-03-17 are both at 08:00. SFR's has the long item, so the day does not fit
    // after the two SLB meetings before it, and neither of its meetings is on the first page.
    it("keeps the meetings of one day together", async () => {
      const { connected } = await start(era, {
        clockAt: "2025-07-15T17:00:00Z",
        documents: false,
        olis: {
          strayRows: {
            CommitteeAgendaItems: [
              agendaItemRow(900302, {
                CommitteCode: "SFR",
                MeetingDate: "2025-03-17T08:00:00",
                Comments: longComments,
              }),
            ],
          },
        },
      });
      const idsOf = async (from: string, to: string): Promise<{ ids: string[]; truncated: unknown }> => {
        const outcome = await callTool(connected, "meetings", { from, to });
        const meetings = outcome.structured?.["meetings"] as MeetingOutput[];
        return { ids: meetings.map((meeting) => meeting.id), truncated: outcome.structured?.["truncated"] };
      };

      expect(await idsOf("2025-03-11", "2025-03-18")).toEqual({
        ids: ["meeting-2025r1-slb-2025-03-11-0800", "meeting-2025r1-slb-2025-03-13-0800"],
        truncated: true,
      });
      expect(await idsOf("2025-03-14", "2025-03-18")).toEqual({
        ids: ["meeting-2025r1-sed-2025-03-17-0800", "meeting-2025r1-sfr-2025-03-17-0800"],
        truncated: true,
      });
      expect(await idsOf("2025-03-18", "2025-03-18")).toEqual({
        ids: ["meeting-2025r1-slb-2025-03-18-0800"],
        truncated: false,
      });
    });
  });

  describe("the tool-call rate limit", () => {
    // The MCP specification requires servers to rate-limit tool calls, over every tool together
    // (get-measure-rate-limit.test.ts shows the other three). A third `meetings` call in a limit of two is refused.
    it("counts meetings calls with the others, and refuses the one past the limit", async () => {
      const { connected } = await start(era, {
        clockAt: "2025-01-29T20:00:00Z",
        documents: false,
        serverEnv: { MCP_RATE_LIMIT: "2", MCP_RATE_WINDOW_SECONDS: "60" },
      });

      const first = await callTool(connected, "meetings", { measure: "SB 69" });
      const second = await callTool(connected, "get_measure", { measure: "SB 69" });
      const refused = await callTool(connected, "meetings", { measure: "SB 69" });

      expect([first.isError, second.isError]).toEqual([false, false]);
      expect(refused.isError).toBe(true);
      expect(refused.structured).toBeUndefined();
      expect(refused.text).toMatch(/rate limit/i);
    });
  });
});
