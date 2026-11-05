// Seam 4 (test/CLAUDE.md): the Passages of a Recording Log's speaker turns, through the writer's and search's entry points
// (ticket #127, ADR-0052's "Turns and Passages", schema step 3). A WAL database in a temp directory of the test's own; a case
// arranges state through the writer and asserts what the writer lists and what search reads back. Every value is MADE UP
// (made-up-index.ts): the log, its text, its turns. The real logs' turns are seam 1's.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { MeasureId } from "#/packages/domain/index.ts";
import type { LegislatorId } from "#/packages/domain/legislators.ts";
import type { Passage } from "#/packages/domain/search.ts";
import type { SpeakerTurn } from "#/packages/domain/speaker-turns.ts";
import { createHash } from "node:crypto";
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
const log = recordingLogLink();
const logId = log.id;
const meeting = meetingOn(10);

const header = "MADE UP COMMITTEE\n";
const first = "00:00:04 Co-Chair Upp\n";
const item = "00:00:30 SB 9001 - Public Hearing\n";
const second = "00:00:31 Pat Poe, Director, Made Up Agency\n";
const text = `${header}${first}${item}${second}`;

const turn = (
  offsetSeconds: number,
  timecode: string,
  speaker: string,
  parts: Partial<SpeakerTurn> = {},
): SpeakerTurn => ({
  timecode,
  offsetSeconds,
  offsetSource: "link",
  speaker,
  legislatorCode: null,
  legislator: null,
  agendaItem: null,
  measureId: null,
  playerLink: `https://made-up.example/mediaplayer?clientID=1&eventID=2099010001&startStreamAt=${offsetSeconds}`,
  ...parts,
});
const turns = [
  turn(4, "00:00:04", "Co-Chair Upp", {
    legislatorCode: "Rep Upp",
    legislator: { id: "legislator-2099r1-upp" as LegislatorId, name: "Maude Upp" },
  }),
  turn(31, "00:00:31", "Pat Poe, Director, Made Up Agency", {
    agendaItem: "SB 9001 - Public Hearing",
    measureId: "measure-2099r1-sb9001" as MeasureId,
  }),
];

function passageOf(start: number, end: number, turnPosition?: number): Passage {
  const passageText = text.slice(start, end);
  return {
    start,
    end,
    text: passageText,
    hash: createHash("sha256").update(passageText).digest("hex"),
    ...(turnPosition === undefined ? {} : { turn: turnPosition }),
  };
}

/** The log as the worker stores it first: its text cut as any text is (here, in one passage), Keyword-only. */
function storeLogWithIndex(): void {
  index.writer.recordFullPull(
    session,
    asOf(1),
    pullOf({
      Committees: [committee],
      CommitteeMeetings: [meeting],
      CommitteeMeetingDocuments: [log],
      CommitteeAgendaItems: [agendaItem],
      Measures: [measure],
      legislators: [{ id: "legislator-2099r1-upp" as LegislatorId, name: "Maude Upp" }],
    }),
  );
  index.writer.storeDocument(session, storedOf(log, text), {
    ...searchRecordOf(log, text, true),
    passages: [passageOf(0, text.length)],
    vectors: { modelId: "made-up-model", rows: [] },
  });
  index.writer.storeSpeakerTurnIndex({
    documentId: logId,
    outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns },
  });
}

const cut = (): Passage[] => [
  passageOf(0, header.length),
  passageOf(header.length, header.length + first.length, 0),
  passageOf(header.length + first.length, header.length + first.length + item.length),
  passageOf(text.length - second.length, text.length, 1),
];

beforeEach(() => {
  index = openMadeUpIndex();
});
afterEach(() => {
  index.close();
});

describe("the Passages of a log's turns", () => {
  test("the writer lists a log that has an index and no turn Passages, with its text and its turns' timecodes and speakers", () => {
    storeLogWithIndex();

    expect(index.writer.recordingLogsWithoutTurnPassages(session)).toEqual([
      {
        id: logId,
        text,
        turns: [
          { timecode: "00:00:04", speaker: "Co-Chair Upp" },
          { timecode: "00:00:31", speaker: "Pat Poe, Director, Made Up Agency" },
        ],
      },
    ]);
  });

  test("a log whose turns are given Passages is not listed again, and its text is kept whole as the Passages cover it", () => {
    storeLogWithIndex();

    index.writer.replacePassages(logId, cut(), 0);

    expect(index.writer.recordingLogsWithoutTurnPassages(session)).toEqual([]);
    expect(
      index.writer
        .passagesOf(logId)
        .map((passage) => passage.text)
        .join(""),
    ).toBe(text);
  });

  test("search finds a turn by its words, and says which turn: its position, speaker, Legislator, Meeting, Agenda item and Measure", () => {
    storeLogWithIndex();
    index.writer.replacePassages(logId, cut(), 0);

    const [found, ...rest] = index.search.keyword("Poe", { session, withTestimony: false }, 10);

    expect(rest).toEqual([]);
    expect(found).toMatchObject({ documentId: logId, turnPosition: 1 });
    expect(index.search.details(found ?? { passageId: null, documentId: logId }).turn).toEqual({
      ...turns[1],
      meeting: meeting.id,
    });
  });

  test("a word of a line that is not a turn is found with no turn", () => {
    storeLogWithIndex();
    index.writer.replacePassages(logId, cut(), 0);

    const [found] = index.search.keyword("MADE UP COMMITTEE", { session, withTestimony: false }, 10);

    expect(found).toMatchObject({ documentId: logId, turnPosition: null });
    expect(index.search.details(found ?? { passageId: null, documentId: logId }).turn).toBeNull();
  });

  test("a turn's Legislator is read from the Legislators the store holds, as get_document reads it", () => {
    storeLogWithIndex();
    index.writer.replacePassages(logId, cut(), 0);

    const [found] = index.search.keyword("Upp", { session, withTestimony: false }, 10);

    expect(index.search.details(found ?? { passageId: null, documentId: logId }).turn).toMatchObject({
      legislatorCode: "Rep Upp",
      legislator: { id: "legislator-2099r1-upp", name: "Maude Upp" },
    });
  });

  test("storing the log's index again leaves its Passages cut as plain text and lists it, so they are cut again around the new turns", () => {
    storeLogWithIndex();
    index.writer.replacePassages(logId, cut(), 0);

    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns: [turns[1] as SpeakerTurn] },
    });

    expect(index.writer.recordingLogsWithoutTurnPassages(session).map((listed) => listed.id)).toEqual([logId]);
    const [found] = index.search.keyword("Poe", { session, withTestimony: false }, 10);
    expect(found).toMatchObject({ turnPosition: null });
  });

  test("a log with no turns, or no index, is not listed", () => {
    storeLogWithIndex();
    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns: [] },
    });
    expect(index.writer.recordingLogsWithoutTurnPassages(session)).toEqual([]);

    index.writer.storeSpeakerTurnIndex({ documentId: logId, outcome: { kind: "no_event_id" } });
    expect(index.writer.recordingLogsWithoutTurnPassages(session)).toEqual([]);
  });

  test("a log none of whose turns the text places is cut once: it is not listed again, and the build report counts its turns", () => {
    storeLogWithIndex();
    // Both turns are left in the text between the turns (a turn the text does not hold, or longer than a Passage may be).
    index.writer.replacePassages(logId, [passageOf(0, text.length)], 2);

    expect(index.writer.recordingLogsWithoutTurnPassages(session)).toEqual([]);
    expect(index.writer.recordingLogReadingNotes(session).turnsWithoutPassage).toEqual([
      { id: logId, sourceUrl: log.sourceUrl, turns: 2 },
    ]);
  });

  test("a log whose turns all have Passages is not in the build report's count, and storing its index again takes it out of the count", () => {
    storeLogWithIndex();
    index.writer.replacePassages(logId, [passageOf(0, text.length)], 2);

    index.writer.storeSpeakerTurnIndex({
      documentId: logId,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns },
    });

    expect(index.writer.recordingLogReadingNotes(session).turnsWithoutPassage).toEqual([]);
    expect(index.writer.recordingLogsWithoutTurnPassages(session).map((listed) => listed.id)).toEqual([logId]);

    index.writer.replacePassages(logId, cut(), 0);

    expect(index.writer.recordingLogReadingNotes(session).turnsWithoutPassage).toEqual([]);
  });
});
