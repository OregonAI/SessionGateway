// Seam 1 (test/CLAUDE.md): a Recording Log file OLIS posts under a Meeting its header does not name, and only later under the
// Meeting it does (ticket #177). The pull after the second posting is the subject: the copy it indexed before, alone, is set
// aside, and the transcript it was given goes with it, so the file's transcript is stored once, for the Meeting the header
// names. recording-log-copies.test.ts has the copies that arrive together.
//
// THE MEETING AND ITS ROW ARE MADE UP; THE FILE IS REAL. A made-up CommitteeMeetings row for SLB 2025-01-22 13:00 (a Meeting
// that never happened) and CommitteeMeetingDocuments row 900305, "MADE UP copy", created "2025-01-29T10:00:00", serve the
// fixture's real log 288741 (documents/committee-meeting-documents/288741.pdf), whose header names HALNRW's Meeting of
// 2025-01-22 08:00 ("HOUSE COMMITTEE ON AGRICULTURE, LAND USE, NATURAL / RESOURCES, AND WATER", "08:00 AM"). The fixture's own
// row for 288741 was created "2025-01-29T13:13:06.5416935" (feed/CommitteeMeetingDocuments.json). The transcript is made up
// (test/support/made-up-transcript.ts, event 2025011038, the event of 288741's links), and its words "quokka laboratory" fall
// in Kurt Williams's turn of that log (transcripts-published.test.ts). HB 3131 is taken up in 288741, and the fixture's other
// logs that name it (289259, 292588) are created after both clocks here.
//
// Which cases copy (test/CLAUDE.md, "Templates"): the case copies the run's template for 2025-01-29 12:00 Oregon (before OLIS
// posted 288741) with the transcript folder, adds the made-up rows and file, and pulls (`startCopiedSystemWith`). Then it moves
// the clock to 14:00 Oregon, after 288741 was posted, and pulls again: that pull is the subject.
import { afterEach, expect, it } from "vitest";
import { halnrwEventId, halnrwSegments, madeUpTranscript } from "../support/made-up-transcript.ts";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystemWith, type System } from "../support/system.ts";

const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument";
const REAL_LOG = "recording-log-2025r1-288741";
const REAL_MEETING = "meeting-2025r1-halnrw-2025-01-22-0800";
const COPY = "recording-log-2025r1-900305";
const COPY_MEETING = "meeting-2025r1-slb-2025-01-22-1300";

const started: { system: System; connected: ConnectedClient }[] = [];

afterEach(async () => {
  for (const { system, connected } of started.splice(0)) {
    await connected.close();
    await system.stop();
  }
});

type Hit = { id: string; transcript?: { meeting: string } };

async function transcriptHits(connected: ConnectedClient): Promise<[string, string | undefined][]> {
  const outcome = await callTool(connected, "search", { query: "quokka laboratory" });
  expect(outcome.isError, outcome.text).toBe(false);
  return (outcome.structured?.["results"] as Hit[])
    .filter((hit) => hit.transcript !== undefined)
    .map((hit) => [hit.id, hit.transcript?.meeting]);
}

it("sets aside a copy indexed alone once the Meeting its header names gets the file, and its transcript with it", async () => {
  const system = await startCopiedSystemWith(
    {
      clockAt: "2025-01-29T20:00:00Z",
      documents: true,
      transcripts: {
        [`${halnrwEventId}.transcript.json`]: madeUpTranscript({ eventId: halnrwEventId, segments: halnrwSegments }),
      },
      serverEnv: { TRANSCRIPTS_PUBLISHED: "true" },
    },
    {
      rows: {
        CommitteeMeetings: [
          {
            SessionKey: "2025R1",
            CommitteeCode: "SLB",
            MeetingDate: "2025-01-22T13:00:00",
            Location: "HR B",
            PostedDate: "2025-01-17T14:39:27",
            AlternateLocation: null,
            AgendaUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeAgenda/SLB/MADE-UP",
            AgendaRevisionNumber: 0,
            MeetingStatusCode: "S",
            MeetingStatus: "Scheduled",
            MeetingGuid: "made-up-SLB-2025-01-22T13:00:00",
            CreatedDate: "2025-01-17T14:16:07",
            ModifiedDate: "2025-01-17T14:39:27",
          },
        ],
        CommitteeMeetingDocuments: [
          {
            CommitteeMeetingDocumentId: 900305,
            SessionKey: "2025R1",
            CommitteeCode: "SLB",
            MeetingDate: "2025-01-22T13:00:00",
            ExhibitReference: null,
            ExhibitTitle: "MADE UP copy (recording log)",
            Submitter: "staff",
            DocumentType: "Recording Log",
            MeasurePrefix: null,
            MeasureNumber: null,
            DocumentUrl: `${root}/900305`,
            CreatedDate: "2025-01-29T10:00:00",
            ModifiedDate: null,
          },
        ],
      },
      documents: { "/liz/2025R1/Downloads/CommitteeMeetingDocument/900305": "committee-meeting-documents/288741.pdf" },
    },
  );
  const connected = await connectClient("legacy", system.handler);
  started.push({ system, connected });
  // Alone, the copy is read as any log is: a file filed under one Meeting is not checked against its header.
  expect(await transcriptHits(connected)).toContainEqual([COPY, COPY_MEETING]);

  system.clock.set("2025-01-29T22:00:00Z");
  await system.pullAgain();

  const report = system.buildReport();
  expect(report["recording_log_gaps"]).toEqual([
    {
      id: COPY,
      source_url: `${root}/900305`,
      kind: "log_of_another_meeting",
      event_ids: [],
      meeting_id: COPY_MEETING,
      header: "HOUSE COMMITTEE ON AGRICULTURE, LAND USE, NATURAL RESOURCES, AND WATER 08:00 AM",
      same_file_as: [{ id: REAL_LOG, source_url: `${root}/288741`, meeting_id: REAL_MEETING }],
    },
  ]);
  expect((report["transcripts"] as { stored: number }).stored).toBe(1);
  const hits = await transcriptHits(connected);
  expect(hits).toContainEqual([REAL_LOG, REAL_MEETING]);
  expect(hits.every(([id, meeting]) => id === REAL_LOG && meeting === REAL_MEETING)).toBe(true);
  const measure = await callTool(connected, "get_measure", { measure: "HB 3131" });
  expect(measure.isError, measure.text).toBe(false);
  expect(
    (measure.structured?.["hearings"] as { meeting_id: string; recording_log_id: string }[]).map((hearing) => [
      hearing.meeting_id,
      hearing.recording_log_id,
    ]),
  ).toEqual([[REAL_MEETING, REAL_LOG]]);
});
