// Seam 4 (test/CLAUDE.md): the speaker-turn index the worker stores for a Recording Log and the reader hands out (ticket
// #126, ADR-0048's second step). A WAL database in a temp directory of the test's own; a case arranges state through the
// writer's entry points and asserts what the reader's entry points return. Every value is MADE UP (made-up-index.ts):
// the log, its event ID, its turns. The real logs' turns are seam 1's.
import { afterEach, describe, expect, test } from "vitest";
import type { MeasureId } from "#/packages/domain/index.ts";
import type { LegislatorId } from "#/packages/domain/legislators.ts";
import type { SpeakerTurn } from "#/packages/domain/speaker-turns.ts";
import { openIndexReader } from "../reader.ts";
import { openIndexWriter } from "../writer.ts";
import { buildFrozenVersionOne, createIndexFile, type IndexFile } from "./arranged-files.ts";
import {
  agendaItem,
  asOf,
  committee,
  exhibitLink,
  meetingOn,
  openMadeUpIndex,
  pullOf,
  recordingLogLink,
  session,
  storeMadeUpDocument,
  type MadeUpIndex,
} from "./made-up-index.ts";

let index: MadeUpIndex;

const log = recordingLogLink();
const logId = log.id;
const meeting = meetingOn(10);

const turn = (offsetSeconds: number, parts: Partial<SpeakerTurn> = {}): SpeakerTurn => ({
  timecode: `00:00:${String(offsetSeconds).padStart(2, "0")}`,
  offsetSeconds,
  offsetSource: "link",
  speaker: `MADE UP speaker ${offsetSeconds}`,
  legislatorCode: null,
  legislator: null,
  agendaItem: null,
  measureId: null,
  playerLink: `https://made-up.example/mediaplayer?clientID=1&eventID=2099010001&startStreamAt=${offsetSeconds}`,
  ...parts,
});

function pulledWithLog(): void {
  index = openMadeUpIndex();
  index.writer.recordFullPull(
    session,
    asOf(1),
    pullOf({
      Committees: [committee],
      CommitteeMeetings: [meeting],
      CommitteeMeetingDocuments: [log, exhibitLink()],
      CommitteeAgendaItems: [agendaItem],
      legislators: [{ id: "legislator-2099r1-upp" as LegislatorId, name: "Maude Upp" }],
    }),
  );
  storeMadeUpDocument(index, log, "MADE UP recording log text");
}

describe("the speaker-turn index of a stored Recording Log", () => {
  afterEach(() => {
    index.close();
  });

  test("is read back whole, every field, in media-clock order whatever order it was stored in", () => {
    pulledWithLog();
    const first = turn(10, {
      legislatorCode: "Rep Upp",
      legislator: { id: "legislator-2099r1-upp" as LegislatorId, name: "Maude Upp" },
      agendaItem: "SB 9001 - Public Hearing",
      measureId: "measure-2099r1-sb9001" as MeasureId,
      offsetSource: "timecode",
    });
    const second = turn(30);
    const third = turn(30, { speaker: "MADE UP second turn at the same second" });
    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: {
        kind: "indexed",
        eventId: "2099010001",
        pagesReadByTimecode: [2, 3],
        turns: [second, third, first],
      },
    });

    expect(index.reader.speakerTurnIndexOf(logId)).toEqual({
      kind: "indexed",
      eventId: "2099010001",
      pagesReadByTimecode: [2, 3],
      turns: [first, second, third],
    });
  });

  test("a log OLIS gave no event ID, or two, is stored as that gap, with no turns", () => {
    pulledWithLog();
    index.writer.storeSpeakerTurnIndex({ documentId: logId, outcome: { kind: "no_event_id" } });
    expect(index.reader.speakerTurnIndexOf(logId)).toEqual({ kind: "no_event_id" });

    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "conflicting_event_ids", eventIds: ["2099010001", "2099010002"] },
    });
    expect(index.reader.speakerTurnIndexOf(logId)).toEqual({
      kind: "conflicting_event_ids",
      eventIds: ["2099010001", "2099010002"],
    });
  });

  test("storing it again replaces the turns, and a log with none stored has no index", () => {
    pulledWithLog();
    expect(index.reader.speakerTurnIndexOf(logId)).toBeUndefined();
    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns: [turn(1), turn(2)] },
    });
    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns: [turn(5)] },
    });

    expect(index.reader.speakerTurnIndexOf(logId)).toEqual({
      kind: "indexed",
      eventId: "2099010001",
      pagesReadByTimecode: [],
      turns: [turn(5)],
    });
  });

  test("the writer lists the stored Recording Logs that have no index yet, and no other document", () => {
    pulledWithLog();
    storeMadeUpDocument(index, exhibitLink(), "MADE UP exhibit text");
    expect(index.writer.recordingLogsWithoutIndex(session)).toEqual(new Set([logId]));

    index.writer.storeSpeakerTurnIndex({ documentId: logId, outcome: { kind: "no_event_id" } });

    expect(index.writer.recordingLogsWithoutIndex(session)).toEqual(new Set());
  });

  test("the meeting's listing says per Recording Log whether it has an index: its event ID and turn count", () => {
    pulledWithLog();
    const before = index.reader.meetingContents(meeting.id).recordingLogs;
    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns: [turn(1), turn(2), turn(3)] },
    });
    const indexed = index.reader.meetingContents(meeting.id).recordingLogs;
    index.writer.storeSpeakerTurnIndex({ documentId: logId, outcome: { kind: "no_event_id" } });
    const gap = index.reader.meetingContents(meeting.id).recordingLogs;

    expect(before.map((entry) => entry.speakerTurnIndex)).toEqual([null]);
    expect(indexed.map((entry) => entry.speakerTurnIndex)).toEqual([{ eventId: "2099010001", turnCount: 3 }]);
    expect(gap.map((entry) => entry.speakerTurnIndex)).toEqual([null]);
  });

  test("the writer reports for the build report the logs with a gap and the pages read by timecode, each with its source URL", () => {
    pulledWithLog();
    expect(index.writer.recordingLogReadingNotes(session)).toEqual({ gaps: [], readByTimecode: [] });

    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [2, 3], turns: [turn(1)] },
    });
    expect(index.writer.recordingLogReadingNotes(session)).toEqual({
      gaps: [],
      readByTimecode: [{ id: logId, sourceUrl: log.sourceUrl, pages: [2, 3] }],
    });

    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "conflicting_event_ids", eventIds: ["2099010001", "2099010002"] },
    });
    expect(index.writer.recordingLogReadingNotes(session)).toEqual({
      gaps: [
        { id: logId, sourceUrl: log.sourceUrl, kind: "conflicting_event_ids", eventIds: ["2099010001", "2099010002"] },
      ],
      readByTimecode: [],
    });

    index.writer.storeSpeakerTurnIndex({ documentId: logId, outcome: { kind: "no_event_id" } });
    expect(index.writer.recordingLogReadingNotes(session).gaps).toEqual([
      { id: logId, sourceUrl: log.sourceUrl, kind: "no_event_id", eventIds: [] },
    ]);
  });

  test("the writer hands over the meeting's Agenda items as the feed gave them", () => {
    pulledWithLog();

    expect(index.writer.agendaItemsOfMeeting(meeting.id)).toEqual([
      { measurePrefix: "SB", measureNumber: 9001, meetingType: "Public Hearing", action: null, comments: null },
    ]);
  });
});

describe("the second schema step", () => {
  const files: IndexFile[] = [];
  afterEach(() => {
    for (const file of files.splice(0)) file.remove();
  });

  test("upgrades a file built from version 1's frozen text, so it stores and reads an index", () => {
    const file = createIndexFile();
    files.push(file);
    buildFrozenVersionOne(file.path);

    const writer = openIndexWriter(file.path);
    try {
      writer.recordFullPull(
        session,
        asOf(1),
        pullOf({ Committees: [committee], CommitteeMeetings: [meeting], CommitteeMeetingDocuments: [log] }),
      );
      writer.storeSpeakerTurnIndex({
        documentId: logId,
        outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns: [turn(4)] },
      });
    } finally {
      writer.close();
    }
    const reader = openIndexReader(file.path);
    try {
      expect(reader.speakerTurnIndexOf(logId)).toEqual({
        kind: "indexed",
        eventId: "2099010001",
        pagesReadByTimecode: [],
        turns: [turn(4)],
      });
    } finally {
      reader.close();
    }
  });

  test("a file at version 1 is not one the reader serves any more: the server needs the worker's step first", () => {
    const file = createIndexFile();
    files.push(file);
    buildFrozenVersionOne(file.path);

    expect(() => openIndexReader(file.path)).toThrow(/version 1\b.*version 2\b/);
  });
});
