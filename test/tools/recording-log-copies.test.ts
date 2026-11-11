// Seam 1 (test/CLAUDE.md): one Recording Log file that OLIS posted under two Meetings (ticket #177). In 2026R1 OLIS filed the
// House Behavioral Health log of 2026-02-03 13:00 (316511) a second time under the Senate's SECBH Meeting of 08:00 (316540), and
// the Senate Judiciary log of 2026-02-04 12:45 (316510) under HED's Meeting of 08:00 (316512): the same bytes, so the worker
// indexed both copies, invented two hearings and attached each transcript twice. The owner's decision (2026-11-10): a log is
// indexed only under the Meeting whose committee and start time match the log's own header; the copy under the other Meeting
// has no turns and no transcript, and the build report names it; when no Meeting matches, none is indexed and each is named.
//
// THE MEETINGS AND ROWS BELOW ARE MADE UP; THE FILE IS REAL. The fixture has no copy, so this file adds CommitteeMeetings rows
// for Meetings that never happened (SLB 2025-01-22 13:00, HALNRW 2025-01-22 15:00, SHS 2025-01-22 15:00) and
// CommitteeMeetingDocuments rows 900301 to 900304, "MADE UP copy", each serving the fixture's real log 288741
// (documents/committee-meeting-documents/288741.pdf), whose header reads "HOUSE COMMITTEE ON AGRICULTURE, LAND USE, NATURAL /
// RESOURCES, AND WATER / January 22, 2025 Hearing Room D / 08:00 AM": HALNRW's Meeting of 2025-01-22 08:00, the one the fixture's
// row 288741 (created "2025-01-29T13:13:06.5416935") files it under. SLB's copy has another committee, HALNRW's 15:00 copy the
// same committee at another time, so each is a copy of another Meeting's log.
//
// Expected values come from the fixture and the made-up rows, never from a tool's output: HB 3131 is taken up in 288741, 289259
// and 292588 (search-speaker-turns.test.ts has the hand count); the made-up transcript (test/support/made-up-transcript.ts) is
// timed to 288741's turns and names event 2025011038, the event of that log's links, and its words "quokka laboratory" fall in
// Kurt Williams's turn (transcripts-published.test.ts).
//
// Which cases copy (test/CLAUDE.md, "Templates"): each describe copies the run's template for its options, adds the made-up
// rows and files (`startCopiedSystemWith`) and pulls, which fetches only what it adds, then only reads. The first is the
// fixture's whole clock (2026-08-05 10:00 Oregon) with the transcript folder and the gate on. The second is 2025-01-29 12:00
// Oregon, before OLIS posted 288741 at 13:13, so the only Meetings that hold the file are two made-up ones that match it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { halnrwEventId, halnrwSegments, madeUpTranscript } from "../support/made-up-transcript.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystemWith, type System } from "../support/system.ts";

const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument";
const REAL_LOG = "recording-log-2025r1-288741";
const REAL_MEETING = "meeting-2025r1-halnrw-2025-01-22-0800";
const HEADER = "HOUSE COMMITTEE ON AGRICULTURE, LAND USE, NATURAL RESOURCES, AND WATER 08:00 AM";

/** A MADE UP CommitteeMeetings row, shaped like the fixture's HALNRW row of 2025-01-22, for a Meeting that never happened. */
function madeUpMeeting(committee: string, at: string): Record<string, unknown> {
  return {
    SessionKey: "2025R1",
    CommitteeCode: committee,
    MeetingDate: at,
    Location: "HR D",
    PostedDate: "2025-01-17T14:39:27",
    AlternateLocation: null,
    AgendaUrl: `https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeAgenda/${committee}/MADE-UP`,
    AgendaRevisionNumber: 0,
    MeetingStatusCode: "S",
    MeetingStatus: "Scheduled",
    MeetingGuid: `made-up-${committee}-${at}`,
    CreatedDate: "2025-01-17T14:16:07",
    ModifiedDate: "2025-01-17T14:39:27",
  };
}

/** A MADE UP CommitteeMeetingDocuments row posting a Recording Log under a Meeting, created before 288741's own row. */
function madeUpCopy(id: number, committee: string, at: string): Record<string, unknown> {
  return {
    CommitteeMeetingDocumentId: id,
    SessionKey: "2025R1",
    CommitteeCode: committee,
    MeetingDate: at,
    ExhibitReference: null,
    ExhibitTitle: "MADE UP copy (recording log)",
    Submitter: "staff",
    DocumentType: "Recording Log",
    MeasurePrefix: null,
    MeasureNumber: null,
    DocumentUrl: `${root}/${id}`,
    CreatedDate: "2025-01-29T10:00:00",
    ModifiedDate: null,
  };
}

/** The fake serves the real log 288741's bytes at each made-up row's address. */
function realLogAt(ids: readonly number[]): Record<string, string> {
  return Object.fromEntries(
    ids.map((id) => [`/liz/2025R1/Downloads/CommitteeMeetingDocument/${id}`, "committee-meeting-documents/288741.pdf"]),
  );
}

type Gap = Record<string, unknown> & { id: string };
type Hit = { id: string; transcript?: { meeting: string } };

describe("a real log posted again under two made-up Meetings that do not match its header", () => {
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystemWith(
      {
        clockAt: "2026-08-05T17:00:00Z",
        documents: true,
        transcripts: {
          [`${halnrwEventId}.transcript.json`]: madeUpTranscript({ eventId: halnrwEventId, segments: halnrwSegments }),
        },
        serverEnv: { TRANSCRIPTS_PUBLISHED: "true" },
      },
      {
        rows: {
          CommitteeMeetings: [
            madeUpMeeting("SLB", "2025-01-22T13:00:00"),
            madeUpMeeting("HALNRW", "2025-01-22T15:00:00"),
          ],
          CommitteeMeetingDocuments: [
            madeUpCopy(900301, "SLB", "2025-01-22T13:00:00"),
            madeUpCopy(900302, "HALNRW", "2025-01-22T15:00:00"),
          ],
        },
        documents: realLogAt([900301, 900302]),
      },
    );
  }, 120_000);

  afterAll(async () => {
    await system.stop();
  });

  it("the build report names each copy, the Meeting it is filed under, its header, and the logs of the same file", () => {
    const gaps = system.buildReport()["recording_log_gaps"] as Gap[];

    const sameFile = [
      { id: REAL_LOG, source_url: `${root}/288741`, meeting_id: REAL_MEETING },
      {
        id: "recording-log-2025r1-900301",
        source_url: `${root}/900301`,
        meeting_id: "meeting-2025r1-slb-2025-01-22-1300",
      },
      {
        id: "recording-log-2025r1-900302",
        source_url: `${root}/900302`,
        meeting_id: "meeting-2025r1-halnrw-2025-01-22-1500",
      },
    ];
    expect(gaps).toEqual([
      {
        id: "recording-log-2025r1-900301",
        source_url: `${root}/900301`,
        kind: "log_of_another_meeting",
        event_ids: [],
        meeting_id: "meeting-2025r1-slb-2025-01-22-1300",
        header: HEADER,
        same_file_as: sameFile.filter((log) => log.id !== "recording-log-2025r1-900301"),
      },
      {
        id: "recording-log-2025r1-900302",
        source_url: `${root}/900302`,
        kind: "log_of_another_meeting",
        event_ids: [],
        meeting_id: "meeting-2025r1-halnrw-2025-01-22-1500",
        header: HEADER,
        same_file_as: sameFile.filter((log) => log.id !== "recording-log-2025r1-900302"),
      },
    ]);
  });

  it("stores the made-up transcript once, for the Meeting the header names", () => {
    const transcripts = system.buildReport()["transcripts"] as { stored: number; unmatched_files: string[] };
    expect(transcripts.stored).toBe(1);
    expect(transcripts.unmatched_files).toEqual([]);
  });

  describe.for(eras)("for a %s client", (era) => {
    let connected: ConnectedClient;

    beforeAll(async () => {
      connected = await connectClient(era, system.handler);
    });

    afterAll(async () => {
      await connected.close();
    });

    it("get_measure lists HB 3131's hearings at the real Meetings only", async () => {
      const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

      expect(outcome.isError, outcome.text).toBe(false);
      const hearings = outcome.structured?.["hearings"] as { meeting_id: string; recording_log_id: string }[];
      expect(hearings.map((hearing) => [hearing.meeting_id, hearing.recording_log_id])).toEqual([
        [REAL_MEETING, REAL_LOG],
        ["meeting-2025r1-halnrw-2025-01-27-0800", "recording-log-2025r1-289259"],
        ["meeting-2025r1-halnrw-2025-02-12-0800", "recording-log-2025r1-292588"],
      ]);
    });

    it("search finds the transcript's words once, under the real Meeting and its log", async () => {
      const outcome = await callTool(connected, "search", { query: "quokka laboratory" });

      expect(outcome.isError, outcome.text).toBe(false);
      const found = (outcome.structured?.["results"] as Hit[]).filter((hit) => hit.transcript !== undefined);
      expect(found.map((hit) => [hit.id, hit.transcript?.meeting])).toContainEqual([REAL_LOG, REAL_MEETING]);
      expect(found.every((hit) => hit.id === REAL_LOG && hit.transcript?.meeting === REAL_MEETING)).toBe(true);
    });

    it("get_document says a copy has no turns because it is another Meeting's log", async () => {
      const outcome = await callTool(connected, "get_document", { id: "recording-log-2025r1-900301" });

      expect(outcome.isError, outcome.text).toBe(false);
      expect(outcome.structured?.["speaker_turns"]).toMatchObject({
        indexed: false,
        event_id: null,
        gap: "log_of_another_meeting",
        turn_count: 0,
        turns: [],
      });
    });
  });
});

describe("a real log posted under two made-up Meetings before its own, neither of which matches its header", () => {
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystemWith(
      {
        clockAt: "2025-01-29T20:00:00Z",
        documents: true,
        transcripts: {
          [`${halnrwEventId}.transcript.json`]: madeUpTranscript({ eventId: halnrwEventId, segments: halnrwSegments }),
        },
      },
      {
        rows: {
          CommitteeMeetings: [madeUpMeeting("SLB", "2025-01-22T13:00:00"), madeUpMeeting("SHS", "2025-01-22T15:00:00")],
          CommitteeMeetingDocuments: [
            madeUpCopy(900303, "SLB", "2025-01-22T13:00:00"),
            madeUpCopy(900304, "SHS", "2025-01-22T15:00:00"),
          ],
        },
        documents: realLogAt([900303, 900304]),
      },
    );
  }, 120_000);

  afterAll(async () => {
    await system.stop();
  });

  it("indexes neither, names both in the build report, and attaches no transcript", () => {
    const report = system.buildReport();
    const gaps = report["recording_log_gaps"] as Gap[];

    expect(gaps).toEqual([
      {
        id: "recording-log-2025r1-900303",
        source_url: `${root}/900303`,
        kind: "log_of_another_meeting",
        event_ids: [],
        meeting_id: "meeting-2025r1-slb-2025-01-22-1300",
        header: HEADER,
        same_file_as: [
          {
            id: "recording-log-2025r1-900304",
            source_url: `${root}/900304`,
            meeting_id: "meeting-2025r1-shs-2025-01-22-1500",
          },
        ],
      },
      {
        id: "recording-log-2025r1-900304",
        source_url: `${root}/900304`,
        kind: "log_of_another_meeting",
        event_ids: [],
        meeting_id: "meeting-2025r1-shs-2025-01-22-1500",
        header: HEADER,
        same_file_as: [
          {
            id: "recording-log-2025r1-900303",
            source_url: `${root}/900303`,
            meeting_id: "meeting-2025r1-slb-2025-01-22-1300",
          },
        ],
      },
    ]);
    const transcripts = report["transcripts"] as { stored: number; unmatched_files: string[] };
    expect(transcripts.stored).toBe(0);
    expect(transcripts.unmatched_files).toEqual([`${halnrwEventId}.transcript.json`]);
  });
});
