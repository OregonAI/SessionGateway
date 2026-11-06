// Seam 4 (test/CLAUDE.md): the rule that a reader shows only the rows created at or before its clock (ticket #151,
// ADR-0055), through the writer's, the reader's and search's entry points. A WAL database in a temp directory of each
// case's own, and a clock the case moves under readers that stay open: the clock is read at each call, not when the reader
// is opened. Every value is MADE UP (made-up-index.ts): the Session 2099R1, SB 9001, the log and its turns, and the times.
// The real rows at the edges of the rule, and the tools' answers, are seam 1's (test/tools/hide-future-rows.test.ts).
//
// What a case arranges is the one thing the rule decides: a creation time, which the worker stores for each document the
// feed links (`createdAt` of its link) and for each Measure, always as the Pacific time with the offset of that day.
import { afterEach, describe, expect, test } from "vitest";
import type { DocumentId, DocumentLink } from "#/packages/domain/documents.ts";
import { measureIdOf } from "#/packages/domain/index.ts";
import type { SpeakerTurn } from "#/packages/domain/speaker-turns.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import {
  agendaItem,
  analysisLink,
  asOf,
  committee,
  measure,
  measureKey,
  meetingOn,
  modelId,
  openMadeUpIndex,
  pullOf,
  recordingLogLink,
  searchRecordOf,
  session,
  storedOf,
  storeMadeUpDocument,
  testimonyRecord,
  versionLink,
  type MadeUpIndex,
} from "./made-up-index.ts";

let index: MadeUpIndex;
afterEach(() => {
  index.close();
});

/** A clock a case moves by hand, to an instant written with an offset. */
function movableClock(start: string): { now(): Date; moveTo(instant: string): void } {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    moveTo(instant) {
      current = new Date(instant);
    },
  };
}

const stamped = <Link extends DocumentLink>(link: Link, createdAt: string): Link => ({
  ...link,
  createdAt: createdAt as Timestamp,
});

const word = '"zebracrossing"';
const text = "A zebracrossing is a made-up thing.";

/** What the reader serves of a document, and what search finds by the made-up word. */
function seen(id: DocumentId): { served: boolean; searchFinds: boolean; vectors: boolean } {
  return {
    served: index.reader.findDocument(id) !== undefined,
    searchFinds: index.search
      .keyword(word, { session, withTestimony: true }, 10)
      .some((match) => match.documentId === id),
    vectors: [...index.search.vectors(session, modelId)].some((row) => row.documentId === id),
  };
}

const shown = { served: true, searchFinds: true, vectors: true };
const hidden = { served: false, searchFinds: false, vectors: false };

describe("a document created after the clock", () => {
  test("is left out of the reader and of both sides of search, and comes back when the clock reaches its creation, to the millisecond", () => {
    const version = stamped(versionLink(), "2099-01-05T10:00:00.250-08:00");
    const clock = movableClock("2099-01-05T10:00:00.249-08:00");
    index = openMadeUpIndex(clock);
    index.writer.recordFullPull(session, asOf(1), pullOf({ MeasureDocuments: [version], Measures: [measure] }));
    storeMadeUpDocument(index, version, text);

    expect(seen(version.id)).toEqual(hidden);
    clock.moveTo("2099-01-05T10:00:00.250-08:00");
    expect(seen(version.id)).toEqual(shown);
    clock.moveTo("2099-01-05T09:59:00-08:00");
    expect(seen(version.id)).toEqual(hidden);
  });

  test("is shown from the clock's own Pacific day on: 16:50 on the day a row was created at 16:42 is not hidden by the UTC date", () => {
    // 16:50 Pacific on 2099-01-05 is 00:50 UTC on the 6th.
    const version = stamped(versionLink(), "2099-01-05T16:42:28.117-08:00");
    const clock = movableClock("2099-01-05T16:50:00-08:00");
    index = openMadeUpIndex(clock);
    index.writer.recordFullPull(session, asOf(1), pullOf({ MeasureDocuments: [version], Measures: [measure] }));
    storeMadeUpDocument(index, version, text);

    expect(seen(version.id)).toEqual(shown);
    // And in summer, by the offset of that day: 17:21:27.18 PDT is 00:21:27.18 UTC on the next day.
    const summer = stamped(versionLink("A-Engrossed"), "2099-06-17T17:21:27.18-07:00");
    index.writer.recordFullPull(session, asOf(2), pullOf({ MeasureDocuments: [version, summer], Measures: [measure] }));
    storeMadeUpDocument(index, summer, text);
    clock.moveTo("2099-06-17T17:21:27-07:00");
    expect(seen(summer.id)).toEqual(hidden);
    clock.moveTo("2099-06-17T17:21:28-07:00");
    expect(seen(summer.id)).toEqual(shown);
  });

  test("is compared as an instant across the change from daylight time: 01:30 PDT is before 01:15 PST on the day the hour repeats", () => {
    // 2099-11-01 is the day clocks go back (the first Sunday): the first 01:30 is PDT (08:30Z), the second 01:15 is PST (09:15Z).
    const version = stamped(versionLink(), "2099-11-01T01:30:00-07:00");
    const clock = movableClock("2099-11-01T01:15:00-08:00");
    index = openMadeUpIndex(clock);
    index.writer.recordFullPull(session, asOf(1), pullOf({ MeasureDocuments: [version], Measures: [measure] }));
    storeMadeUpDocument(index, version, text);

    expect(seen(version.id)).toEqual(shown);
    clock.moveTo("2099-11-01T01:29:59-07:00");
    expect(seen(version.id)).toEqual(hidden);
  });

  test("is not known as an id: a row the feed lists and no file is held for answers as an id the index has never heard of", () => {
    const version = stamped(versionLink(), "2099-01-05T10:00:00-08:00");
    const clock = movableClock("2099-01-05T09:00:00-08:00");
    index = openMadeUpIndex(clock);
    index.writer.recordFullPull(session, asOf(1), pullOf({ MeasureDocuments: [version], Measures: [measure] }));

    expect(index.reader.findDocument(version.id)).toBeUndefined();
    clock.moveTo("2099-01-05T10:00:00-08:00");
    expect(index.reader.findDocument(version.id)).toMatchObject({ held: false });
  });

  test("is left out of a Testimony list and not known as an id, and its row is shown when the clock reaches it", () => {
    const record = testimonyRecord(77);
    const early = { ...record, link: { ...record.link, createdAt: "2099-01-04T09:00:00-08:00" as Timestamp } };
    const late = testimonyRecord(78);
    const lateStamped = { ...late, link: { ...late.link, createdAt: "2099-01-06T09:00:00-08:00" as Timestamp } };
    const clock = movableClock("2099-01-05T00:00:00-08:00");
    index = openMadeUpIndex(clock);
    index.writer.recordFullPull(
      session,
      asOf(1),
      pullOf({ Measures: [measure], Committees: [committee], CommitteePublicTestimonies: [early, lateStamped] }),
    );

    expect(index.reader.findTestimony(measureKey).map((entry) => entry.id)).toEqual([early.link.id]);
    expect(index.reader.findDocument(lateStamped.link.id)).toBeUndefined();
    clock.moveTo("2099-01-06T09:00:00-08:00");
    expect(index.reader.findTestimony(measureKey).map((entry) => entry.id)).toEqual([
      early.link.id,
      lateStamped.link.id,
    ]);
  });
});

describe("a document with no creation time", () => {
  test("is shown at every clock: nothing says it is from after the clock", () => {
    const version = versionLink();
    const clock = movableClock("1999-01-01T00:00:00-08:00");
    index = openMadeUpIndex(clock);
    index.writer.recordFullPull(session, asOf(1), pullOf({ MeasureDocuments: [version], Measures: [] }));
    storeMadeUpDocument(index, version, text);

    expect(seen(version.id)).toEqual(shown);
  });
});

describe("a Measure created after the clock", () => {
  test("is not one the index knows, and the counts leave it out", () => {
    const clock = movableClock("2098-12-31T23:59:59-08:00");
    index = openMadeUpIndex(clock);
    index.writer.recordFullPull(session, asOf(1), pullOf({ Measures: [measure] }));

    expect(index.reader.findMeasure(measureKey)).toBeUndefined();
    expect(index.reader.counts(session).measures).toBe(0);
    clock.moveTo("2099-01-01T00:00:00-08:00");
    expect(index.reader.findMeasure(measureKey)?.createdAt).toBe("2099-01-01T00:00:00-08:00");
    expect(index.reader.counts(session).measures).toBe(1);
  });
});

describe("an analysis document placed on a Version created after the clock", () => {
  test("is on no Version until the Version exists", () => {
    const version = stamped(versionLink(), "2099-01-05T10:00:00-08:00");
    const placed = analysisLink();
    // The worker points the analysis at the Version its label names when the feed lists that Version (domain/analysis.ts).
    const analysis = {
      ...placed,
      relations: [
        ...placed.relations,
        {
          relation: "version" as const,
          to: version.id,
          meaning: null,
          provenance: "MADE UP MeasureAnalysisDocuments row",
        },
      ],
    };
    const clock = movableClock("2099-01-05T09:00:00-08:00");
    index = openMadeUpIndex(clock);
    index.writer.recordFullPull(
      session,
      asOf(1),
      pullOf({
        Measures: [measure],
        Committees: [committee],
        MeasureDocuments: [version],
        MeasureAnalysisDocuments: [analysis],
      }),
    );
    storeMadeUpDocument(index, version, text);
    storeMadeUpDocument(index, analysis, "A made-up statement.");

    expect(index.reader.analysisDocuments(measureKey).map((stored) => stored.placedVersionId)).toEqual([null]);
    clock.moveTo("2099-01-05T10:00:00-08:00");
    expect(index.reader.analysisDocuments(measureKey).map((stored) => stored.placedVersionId)).toEqual([version.id]);
  });
});

describe("a Recording Log created after the clock", () => {
  const sb9001 = measureIdOf(measureKey);
  const turn: SpeakerTurn = {
    timecode: "00:17:25",
    offsetSeconds: 1045,
    offsetSource: "link",
    speaker: "Pat Poe",
    legislatorCode: null,
    legislator: null,
    agendaItem: "SB 9001 - Public Hearing",
    measureId: sb9001,
    playerLink: "https://made-up.example/mediaplayer?clientID=1&eventID=2099010001&startStreamAt=1045",
  };

  test("takes its speaker turns, its listing in the meeting and its hearings with it", () => {
    const log = stamped(recordingLogLink(), "2099-01-12T09:00:00-08:00");
    const clock = movableClock("2099-01-12T08:59:59-08:00");
    index = openMadeUpIndex(clock);
    index.writer.recordFullPull(
      session,
      asOf(1),
      pullOf({
        Committees: [committee],
        CommitteeMeetings: [meetingOn(10)],
        CommitteeMeetingDocuments: [log],
        CommitteeAgendaItems: [agendaItem],
        Measures: [measure],
      }),
    );
    const logText = "MADE UP COMMITTEE\n00:17:25 Pat Poe\n";
    index.writer.storeDocument(session, storedOf(log, logText), searchRecordOf(log, logText, true));
    index.writer.storeSpeakerTurnIndex({
      documentId: log.id,
      outcome: { kind: "indexed", eventId: "2099010001", pagesReadByTimecode: [], turns: [turn] },
    });
    index.writer.storeItemMeasures(log.id, [{ agendaItem: "SB 9001 - Public Hearing", measures: [sb9001] }]);

    expect(index.reader.speakerTurnIndexOf(log.id)).toBeUndefined();
    expect(index.reader.turnHearingsOf(sb9001)).toEqual([]);
    expect(index.reader.meetingContents(meetingOn(10).id).recordingLogs).toEqual([]);
    expect(index.reader.findDocument(log.id)).toBeUndefined();

    clock.moveTo("2099-01-12T09:00:00-08:00");
    expect(index.reader.speakerTurnIndexOf(log.id)).toMatchObject({ kind: "indexed", eventId: "2099010001" });
    expect(index.reader.turnHearingsOf(sb9001).map((hearing) => hearing.recordingLog)).toEqual([log.id]);
    expect(index.reader.meetingContents(meetingOn(10).id).recordingLogs.map((listed) => listed.id)).toEqual([log.id]);
  });
});
