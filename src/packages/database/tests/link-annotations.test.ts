// Seam 4 (test/CLAUDE.md): the link annotations the worker stores for a Recording Log and the reader hands out (ticket #160,
// ADR-0048's sixth step). A WAL database in a temp directory of the test's own; a case arranges state through the writer's
// entry points and asserts what the reader's entry points return. Every value is MADE UP (made-up-index.ts): the log, its
// addresses, its pages. The real log's annotations are the seam-2 table's (pdf-text/tests/link-annotations.test.ts) and
// the ingest package's (ingest/tests/read-speaker-turn-index.test.ts).
//
// What the cases pin: the annotations are a source of their own. A log's annotations are there with no speaker-turn index,
// and storing, replacing or dropping the index leaves them as they were; storing a log's annotations again replaces them.
import { afterEach, describe, expect, test } from "vitest";
import type { DocumentId, StoredLinkAnnotation } from "#/packages/domain/documents.ts";
import {
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
const exhibit = exhibitLink();

const made = (page: number, second: number): StoredLinkAnnotation => ({
  page,
  url: `https://made-up.example/mediaplayer?clientID=1&eventID=2099010001&startStreamAt=${String(second)}`,
});

function pulledWithLog(): void {
  index = openMadeUpIndex();
  index.writer.recordFullPull(
    session,
    asOf(1),
    pullOf({
      Committees: [committee],
      CommitteeMeetings: [meetingOn(10)],
      CommitteeMeetingDocuments: [log, exhibit],
    }),
  );
  storeMadeUpDocument(index, log, "MADE UP recording log text");
}

describe("the link annotations of a stored Recording Log", () => {
  afterEach(() => {
    index.close();
  });

  test("are read back as stored: the page and address of each, in the order given, a repeated address kept", () => {
    pulledWithLog();
    const annotations = [made(1, 5), made(1, 5), made(2, 9), made(1, 7)];
    index.writer.storeLinkAnnotations(logId, annotations);

    expect(index.reader.linkAnnotationsOf(logId)).toEqual(annotations);
  });

  test("a log nothing was stored for has none, and one log's are not another's", () => {
    pulledWithLog();
    index.writer.storeLinkAnnotations(logId, [made(1, 5)]);

    expect(index.reader.linkAnnotationsOf(exhibit.id)).toEqual([]);
    expect(index.reader.linkAnnotationsOf("recording-log-2099r1-1" as DocumentId)).toEqual([]);
  });

  test("storing them again replaces them, as a log read again is the file as it now is", () => {
    pulledWithLog();
    index.writer.storeLinkAnnotations(logId, [made(1, 5), made(1, 6), made(2, 7)]);
    index.writer.storeLinkAnnotations(logId, [made(1, 8)]);

    expect(index.reader.linkAnnotationsOf(logId)).toEqual([made(1, 8)]);
  });

  test("are stored with no speaker-turn index: the log has annotations and the index has none of it", () => {
    pulledWithLog();
    index.writer.storeLinkAnnotations(logId, [made(1, 5)]);

    expect(index.reader.speakerTurnIndexOf(logId)).toBeUndefined();
    expect(index.reader.linkAnnotationsOf(logId)).toEqual([made(1, 5)]);
  });

  test("do not follow the index: storing it, replacing it with a gap, and storing it again leave them as they were", () => {
    pulledWithLog();
    const annotations = [made(1, 5), made(1, 31), made(2, 40)];
    index.writer.storeLinkAnnotations(logId, annotations);

    for (const outcome of [
      {
        kind: "indexed" as const,
        eventId: "2099010001",
        pagesReadByTimecode: [],
        turns: [
          {
            timecode: "00:00:05",
            offsetSeconds: 5,
            offsetSource: "link" as const,
            speaker: "MADE UP speaker",
            legislatorCode: null,
            legislator: null,
            agendaItem: null,
            measureId: null,
            playerLink: made(1, 5).url,
          },
        ],
      },
      { kind: "no_event_id" as const },
      { kind: "conflicting_event_ids" as const, eventIds: ["2099010001", "2099010002"] },
    ]) {
      index.writer.storeSpeakerTurnIndex({ documentId: logId, outcome });
      expect(index.reader.linkAnnotationsOf(logId)).toEqual(annotations);
    }
  });
});
