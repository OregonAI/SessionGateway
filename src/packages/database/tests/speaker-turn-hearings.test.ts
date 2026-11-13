// Seam 4 (test/CLAUDE.md): the hearings at which a Measure was taken up, through the writer's and the reader's entry points
// (ticket #127, ADR-0053's "get_measure lists the hearings", owner decision of 2026-11-05: a Measure's hearings are every
// Agenda item naming it). A WAL database in a temp directory of the test's own. Every value is MADE UP (made-up-index.ts):
// the Session 2099R1, SB 9001 and SB 9002, the log and its turns. The shape is that of the 2026R1 log 316088 (SEE
// 2026-02-25), the review's case: its lines "HB 4077 and HB 4076 A - Public Hearing" (1044 s), "HB 4076 A - Public Hearing"
// (2940 s), "HB 4077 - Public Hearing" (4444 s) and "HB 4077 - Work Session" (4859 s) are here "SB 9002 and SB 9001 - Public
// Hearing", "SB 9002 - Public Hearing", "SB 9001 - Public Hearing" and "SB 9001 - Work Session" at the same seconds, so
// that the order of the item texts is not the order of the recording. The real lines are seam 2's (turn-context.test.ts).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { measureIdOf, type MeasureId } from "#/packages/domain/index.ts";
import type { SpeakerTurn } from "#/packages/domain/speaker-turns.ts";
import {
  agendaItem,
  asOf,
  committee,
  measure,
  meetingOn,
  openMadeUpIndex,
  pullOf,
  recordingLogLink,
  searchRecordOf,
  session,
  storedOf,
  type MadeUpIndex,
} from "./made-up-index.ts";

let index: MadeUpIndex;
/** Any version above 0 will do: a reading is made again whenever the recorded version is not the one asked for (ADR-0066). */
const currentReader = 1;
const log = recordingLogLink();
const logId = log.id;
const meeting = meetingOn(10);

const sb9001 = measure;
const sb9002 = { ...measure, number: 9002 };
const sb9001Id = measureIdOf(sb9001);
const sb9002Id = measureIdOf(sb9002);
/** MADE UP: a Measure the index does not hold. */
const sb9003Id = measureIdOf({ ...measure, number: 9003 });

const text = "MADE UP COMMITTEE\n00:17:25 Pat Poe\n";

const turn = (offsetSeconds: number, agenda: string, measureId: MeasureId | null): SpeakerTurn => ({
  timecode: new Date(offsetSeconds * 1000).toISOString().slice(11, 19),
  offsetSeconds,
  offsetSource: "link",
  speaker: `Speaker at ${String(offsetSeconds)}`,
  legislatorCode: null,
  legislator: null,
  agendaItem: agenda,
  measureId,
  playerLink: `https://made-up.example/mediaplayer?clientID=1&eventID=2099010001&startStreamAt=${offsetSeconds}`,
});

const both = "SB 9002 and SB 9001 - Public Hearing";
const turns = [
  turn(1045, both, sb9002Id),
  turn(1100, both, sb9002Id),
  turn(2941, "SB 9002 - Public Hearing", sb9002Id),
  turn(4445, "SB 9001 - Public Hearing", sb9001Id),
  turn(4860, "SB 9001 - Work Session", sb9001Id),
];

function storeLog(): void {
  index.writer.recordFullPull(
    session,
    asOf(1),
    pullOf({
      Committees: [committee],
      CommitteeMeetings: [meeting],
      CommitteeMeetingDocuments: [log],
      CommitteeAgendaItems: [agendaItem],
      Measures: [sb9001, sb9002],
    }),
  );
  index.writer.storeDocument(session, storedOf(log, text), searchRecordOf(log, text, true));
  index.writer.storeSpeakerTurnIndex({
    readerVersion: 1,
    documentId: logId,
    outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns },
  });
}

/** What the worker derives from the item texts: the Measures each names, in the item's order (SB 9003 is not held). */
function storeItemMeasures(): void {
  index.writer.storeItemMeasures(
    logId,
    [
      { agendaItem: both, measures: [sb9002Id, sb9001Id, sb9003Id] },
      { agendaItem: "SB 9002 - Public Hearing", measures: [sb9002Id] },
      { agendaItem: "SB 9001 - Public Hearing", measures: [sb9001Id] },
      { agendaItem: "SB 9001 - Work Session", measures: [sb9001Id] },
    ],
    currentReader,
  );
}

beforeEach(() => {
  index = openMadeUpIndex();
});
afterEach(() => {
  index.close();
});

describe("the hearings of a Measure", () => {
  test("a log's hearings of a Measure are in the order of the recording when each line names one Measure (review fix 1)", () => {
    // The item texts sort as "Public Hearing" before "Work Session"; the recording takes the work session first.
    storeLog();
    index.writer.storeSpeakerTurnIndex({
      readerVersion: 1,
      documentId: logId,
      outcome: {
        kind: "indexed",
        eventId: "2099010001",
        pagesReadByTimecode: [],
        turns: [turn(100, "SB 9001 - Work Session", sb9001Id), turn(200, "SB 9001 - Public Hearing", sb9001Id)],
      },
    });
    index.writer.storeItemMeasures(
      logId,
      [
        { agendaItem: "SB 9001 - Work Session", measures: [sb9001Id] },
        { agendaItem: "SB 9001 - Public Hearing", measures: [sb9001Id] },
      ],
      currentReader,
    );

    expect(
      index.reader.turnHearingsOf(sb9001Id).map((hearing) => [hearing.agendaItem, hearing.firstTurn.offsetSeconds]),
    ).toEqual([
      ["SB 9001 - Work Session", 100],
      ["SB 9001 - Public Hearing", 200],
    ]);
  });

  test("a log's hearings of a Measure are in the order of the recording, not of the item texts", () => {
    storeLog();
    storeItemMeasures();

    expect(
      index.reader.turnHearingsOf(sb9001Id).map((hearing) => [hearing.agendaItem, hearing.firstTurn.offsetSeconds]),
    ).toEqual([
      [both, 1045],
      ["SB 9001 - Public Hearing", 4445],
      ["SB 9001 - Work Session", 4860],
    ]);
  });

  test("an Agenda item that names several Measures is a hearing of each, with the first turn under it, and lists the Measures the index holds", () => {
    storeLog();
    storeItemMeasures();

    const second = index.reader.turnHearingsOf(sb9002Id);

    expect(second.map((hearing) => [hearing.agendaItem, hearing.firstTurn.offsetSeconds])).toEqual([
      [both, 1045],
      ["SB 9002 - Public Hearing", 2941],
    ]);
    // The turn keeps its first Measure; the item lists all it names that the index holds (SB 9003 it does not).
    expect(second[0]).toMatchObject({
      meeting: meeting.id,
      recordingLog: logId,
      eventId: "2099010001",
      measureIds: [sb9002Id, sb9001Id],
      firstTurn: { measureId: sb9002Id },
    });
  });

  test("an Agenda item the store has read no Measures of is a hearing of none until the worker has read them, and the log is listed", () => {
    storeLog();

    expect(index.reader.turnHearingsOf(sb9001Id)).toEqual([]);
    expect(index.writer.recordingLogsWithoutItemMeasures(session, currentReader)).toEqual([
      {
        id: logId,
        agendaItems: [both, "SB 9002 - Public Hearing", "SB 9001 - Public Hearing", "SB 9001 - Work Session"],
      },
    ]);

    storeItemMeasures();

    expect(index.writer.recordingLogsWithoutItemMeasures(session, currentReader)).toEqual([]);
  });

  test("storing the log's index again forgets the Measures read from the old one, and lists the log again", () => {
    storeLog();
    storeItemMeasures();

    index.writer.storeSpeakerTurnIndex({
      readerVersion: 1,
      documentId: logId,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns: turns.slice(0, 2) },
    });

    expect(index.reader.turnHearingsOf(sb9001Id)).toEqual([]);
    expect(index.writer.recordingLogsWithoutItemMeasures(session, currentReader).map((listed) => listed.id)).toEqual([
      logId,
    ]);
  });
});

describe("the Agenda items' Measures' reader version (ticket #187, ADR-0066)", () => {
  test("a log whose items were read by an older reader is listed again though its index is the same, and reading them again records the current version", () => {
    storeLog();
    index.writer.storeItemMeasures(logId, [{ agendaItem: both, measures: [sb9001Id] }], currentReader - 1);

    expect(index.writer.recordingLogsWithoutItemMeasures(session, currentReader).map((listed) => listed.id)).toEqual([
      logId,
    ]);

    storeItemMeasures();

    expect(index.writer.recordingLogsWithoutItemMeasures(session, currentReader)).toEqual([]);
    expect(
      index.writer.recordingLogsWithoutItemMeasures(session, currentReader + 1).map((listed) => listed.id),
      "the version written is the current one: the next version finds it unread",
    ).toEqual([logId]);
  });

  test("a log whose items were read by the current reader is not listed", () => {
    storeLog();
    storeItemMeasures();

    expect(index.writer.recordingLogsWithoutItemMeasures(session, currentReader)).toEqual([]);
  });

  test("a bump of the items' version lists no log for its turn Passages", () => {
    storeLog();
    index.writer.replacePassages(logId, [], 0, currentReader);
    index.writer.storeItemMeasures(logId, [], currentReader - 1);

    expect(index.writer.recordingLogsWithoutItemMeasures(session, currentReader)).toHaveLength(1);
    expect(index.writer.recordingLogsWithoutTurnPassages(session, currentReader)).toEqual([]);
  });
});
