// Seam 1 (test/CLAUDE.md): `meetings` as an agent sees it, with the whole system behind it. A fake
// OLIS serves the committed fixture and its 278 documents as the feed stood at noon Pacific on
// 2025-01-29 (rows created by then), the ingest worker pulls them into a database, and an MCP client
// calls the tool in-process. One database serves every case in this file because none of them
// changes it. The cases that need the Session after the fact are in meetings-past.test.ts, and the
// one that needs a row the fixture lacks is in meetings-recording-log.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // Spec #1 case (c): "with the clock at 2025-01-29". Noon in Oregon.
  system = await startSystem({ clockAt: "2025-01-29T20:00:00Z", documents: true });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("meetings for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Expected values are literals from outside the code: the meeting rows of SB 69 in
  // test/fixtures/olis-2025R1/feed/CommitteeAgendaItems.json and CommitteeMeetings.json, and spec #1's
  // case (c): "SLB's 2025-01-30 Public Hearing and Work Session, with -1 and -2 posted". The fixture
  // holds SB 69's later meetings too (HLWS, in April), but their rows were created after the clock.
  it("names SLB's 2025-01-30 Public Hearing and Work Session as the next meeting on SB 69", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 69" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["next_meeting_id"]).toBe("meeting-2025r1-slb-2025-01-30-0800");
    const meetings = outcome.structured?.["meetings"] as { id: string; upcoming: boolean }[];
    expect(meetings.map((meeting) => [meeting.id, meeting.upcoming])).toEqual([
      ["meeting-2025r1-slb-2025-01-21-0800", false],
      ["meeting-2025r1-slb-2025-01-28-0800", false],
      ["meeting-2025r1-slb-2025-01-30-0800", true],
    ]);
    expect(meetings[2]).toMatchObject({
      committee: { id: "committee-2025r1-slb", code: "SLB", name: "Labor and Business" },
      at: "2025-01-30T08:00:00-08:00",
      status: "Scheduled",
    });
  });

  // Spec #1 case (c): "-1 and -2 posted", and, from the spec's graph section, "SB 69's -1 was posted to
  // three meetings". Each posting is a document of its own (ADR-0011) with the feed's
  // ProposedAmendmentId (feed/CommitteeProposedAmendments.json: 26284 for 01-21, 26285 and 26286 for
  // 01-28, 26287 and 26288 for 01-30) and its own file. The fixture holds each row's final state
  // (test/support/fake-olis.ts), so the Meaning is what the feed says now, not what it said on
  // 2025-01-29: the committee adopted -2 on 2025-01-30.
  it("lists the Proposed Amendments posted to each meeting on SB 69, -1 at all three", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 69" });

    const meetings = outcome.structured?.["meetings"] as { id: string; proposed_amendments: unknown[] }[];
    expect(meetings.map((meeting) => [meeting.id, meeting.proposed_amendments.length])).toEqual([
      ["meeting-2025r1-slb-2025-01-21-0800", 1],
      ["meeting-2025r1-slb-2025-01-28-0800", 2],
      ["meeting-2025r1-slb-2025-01-30-0800", 2],
    ]);
    expect(meetings[2]?.proposed_amendments).toEqual([
      {
        id: "amendment-2025r1-sb69-1",
        number: "-1",
        measure_id: "measure-2025r1-sb69",
        meaning: "Proposed",
        document_id: "posting-2025r1-26287",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26287",
      },
      {
        id: "amendment-2025r1-sb69-2",
        number: "-2",
        measure_id: "measure-2025r1-sb69",
        meaning: "Adopted",
        document_id: "posting-2025r1-26288",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26288",
      },
    ]);
  });

  // The agenda items are the rows of feed/CommitteeAgendaItems.json (ids 201898, 202157 and 202165) as
  // they are written: the 01-21 item's Comments hold the witnesses, one to a line, tab-indented. The fixture
  // holds each row's final state, so the 01-30 Action is what the feed says now ("Heard and Reported Out
  // with Amendments", written when the committee had met), not what it said on 2025-01-29.
  it("lists each meeting's agenda items as the feed publishes them", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 69" });

    const meetings = outcome.structured?.["meetings"] as { id: string; agenda_items: unknown[] }[];
    expect(meetings.map((meeting) => [meeting.id, meeting.agenda_items])).toEqual([
      [
        "meeting-2025r1-slb-2025-01-21-0800",
        [
          {
            print_order: "7",
            measure_id: "measure-2025r1-sb69",
            meeting_type: "Informational Meeting",
            action: "Heard",
            comments:
              "Requires the Employment Department to study issues related to laws concerning job-protected leave from work.\n\tJosh Nasbe, Legislative Director, Oregon Bureau of Labor and Industries (BOLI)\n\tKaren Madden Humelbaugh, Paid Leave Oregon Division Director, Oregon Employment Department",
            board_name: null,
            executive_appointee: null,
          },
        ],
      ],
      [
        "meeting-2025r1-slb-2025-01-28-0800",
        [
          {
            print_order: "2",
            measure_id: "measure-2025r1-sb69",
            meeting_type: "Public Hearing",
            action: "Heard",
            comments:
              "Requires the Employment Department to study issues related to laws concerning job-protected leave from work.",
            board_name: null,
            executive_appointee: null,
          },
        ],
      ],
      [
        "meeting-2025r1-slb-2025-01-30-0800",
        [
          {
            print_order: "1",
            measure_id: "measure-2025r1-sb69",
            meeting_type: "Public Hearing and Work Session",
            action: "Heard and Reported Out with Amendments",
            comments:
              "Requires the Employment Department to study issues related to laws concerning job-protected leave from work.",
            board_name: null,
            executive_appointee: null,
          },
        ],
      ],
    ]);
  });

  // The Exhibits are the CommitteeMeetingDocuments rows of the three meetings (feed/CommitteeMeetingDocuments.json:
  // 287879 for 01-21, 288365 and 288569 for 01-28, 288650 for 01-30), with the type the feed gives each
  // ("DocumentType"). A row created after the clock is not there yet: the 01-30 Witness Registration list (289456)
  // was created on 02-04. Row 287879 is a report on SB 1515 that the row files under SB 69, so it is the Measure
  // the row names that the Exhibit carries.
  it("lists the Exhibits posted to each meeting on SB 69, with the type and Measure the feed gives each", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 69" });

    const meetings = outcome.structured?.["meetings"] as { id: string; exhibits: unknown[] }[];
    expect(meetings.map((meeting) => [meeting.id, meeting.exhibits])).toEqual([
      [
        "meeting-2025r1-slb-2025-01-21-0800",
        [
          {
            id: "exhibit-2025r1-287879",
            label: "Meeting Material",
            measure_id: "measure-2025r1-sb69",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/287879",
          },
        ],
      ],
      [
        "meeting-2025r1-slb-2025-01-28-0800",
        [
          {
            id: "exhibit-2025r1-288365",
            label: "Preliminary SMS",
            measure_id: "measure-2025r1-sb69",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/288365",
          },
          {
            id: "exhibit-2025r1-288569",
            label: "Witness Registration",
            measure_id: "measure-2025r1-sb69",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/288569",
          },
        ],
      ],
      [
        "meeting-2025r1-slb-2025-01-30-0800",
        [
          {
            id: "exhibit-2025r1-288650",
            label: "Preliminary SMS",
            measure_id: "measure-2025r1-sb69",
            source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/288650",
          },
        ],
      ],
    ]);
  });

  // A meeting's agenda is a document of its own (GLOSSARY.md): the file at the AgendaUrl of the meeting's row in
  // feed/CommitteeMeetings.json. Its id is named like the meeting's.
  it("links each meeting's agenda document", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 69" });

    const meetings = outcome.structured?.["meetings"] as { id: string; agenda: unknown }[];
    expect(meetings.map((meeting) => [meeting.id, meeting.agenda])).toEqual([
      [
        "meeting-2025r1-slb-2025-01-21-0800",
        {
          id: "agenda-2025r1-slb-2025-01-21-0800",
          label: "Agenda",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeAgenda/SLB/2025-01-21-08-00",
        },
      ],
      [
        "meeting-2025r1-slb-2025-01-28-0800",
        {
          id: "agenda-2025r1-slb-2025-01-28-0800",
          label: "Agenda",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeAgenda/SLB/2025-01-28-08-00",
        },
      ],
      [
        "meeting-2025r1-slb-2025-01-30-0800",
        {
          id: "agenda-2025r1-slb-2025-01-30-0800",
          label: "Agenda",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeAgenda/SLB/2025-01-30-08-00",
        },
      ],
    ]);
  });

  // The brief: "Every document a meeting lists has an id get_document resolves", and it is the document the
  // meeting says it is, at the address the meeting gives. A Proposed Amendment lists two: the amendment
  // (the node, which serves its latest posting) and the posting (the text posted to this meeting).
  it("lists only documents that get_document resolves, each at the source_url the meeting gives", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 69" });

    type Listed = { id: string; source_url: string };
    const meetings = outcome.structured?.["meetings"] as {
      agenda: Listed | null;
      exhibits: Listed[];
      recording_logs: Listed[];
      proposed_amendments: { id: string; document_id: string; source_url: string }[];
    }[];
    const listed: Listed[] = meetings.flatMap((meeting) => [
      ...(meeting.agenda === null ? [] : [meeting.agenda]),
      ...meeting.exhibits,
      ...meeting.recording_logs,
      ...meeting.proposed_amendments.map((amendment) => ({
        id: amendment.document_id,
        source_url: amendment.source_url,
      })),
    ]);
    // 3 agendas, 4 Exhibits and 5 postings (-1 three times, -2 twice).
    expect(listed).toHaveLength(12);
    for (const document of listed) {
      const served = await callTool(connected, "get_document", { id: document.id });
      expect(served.isError, document.id).toBe(false);
      expect(served.structured?.["source_url"], document.id).toBe(document.source_url);
    }
    const amendmentIds = [...new Set(meetings.flatMap((meeting) => meeting.proposed_amendments.map((a) => a.id)))];
    expect(amendmentIds).toEqual(["amendment-2025r1-sb69-1", "amendment-2025r1-sb69-2"]);
    for (const id of amendmentIds) {
      expect((await callTool(connected, "get_document", { id })).isError, id).toBe(false);
    }
  });

  // The URL form is docs/research/hearing-video.md section 2: /liz/{session}/Committees/{CommitteeCode}/
  // {yyyy-MM-dd-HH-mm}/Agenda, "exactly" the feed's CommitteeCode and MeetingDate. The 01-30 agenda link
  // in feed/CommitteeMeetings.json (.../Downloads/CommitteeAgenda/SLB/2025-01-30-08-00) writes the same
  // date and time. The service links the page and never opens it (spec #1, "Out of Scope"): the fake
  // OLIS answers every /liz/ request and lists it, and the page is not among them.
  it("links each meeting's OLIS page, built from its committee code and time, and never fetches it", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 69" });

    const meetings = outcome.structured?.["meetings"] as { id: string; olis_page_url: string }[];
    expect(meetings.map((meeting) => [meeting.id, meeting.olis_page_url])).toEqual([
      [
        "meeting-2025r1-slb-2025-01-21-0800",
        "https://olis.oregonlegislature.gov/liz/2025R1/Committees/SLB/2025-01-21-08-00/Agenda",
      ],
      [
        "meeting-2025r1-slb-2025-01-28-0800",
        "https://olis.oregonlegislature.gov/liz/2025R1/Committees/SLB/2025-01-28-08-00/Agenda",
      ],
      [
        "meeting-2025r1-slb-2025-01-30-0800",
        "https://olis.oregonlegislature.gov/liz/2025R1/Committees/SLB/2025-01-30-08-00/Agenda",
      ],
    ]);
    expect(system.olis.documentRequests().filter((path) => path.includes("/Committees/"))).toEqual([]);
  });

  // An unknown Measure is an expected outcome, so it is a tool error that tells the agent what to give
  // (src/CLAUDE.md, "Errors"). The fixture holds no SB 9999.
  it("answers a Measure the Session does not have with an error that says what to give", async () => {
    const outcome = await callTool(connected, "meetings", { measure: "SB 9999" });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('No Measure "SB 9999" in the 2025R1 Session.');
  });
});
