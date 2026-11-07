// The worker's pull and the link annotations of a Recording Log it stores (ticket #160, ADR-0058). Not seam 1 in the strict sense
// and not seam 4: no tool shows the annotations, so the cases read them back through the index reader's `linkAnnotationsOf`
// on the database the worker wrote (the evaluation's sources are SQL over stored columns, scripts/eval/questions/2026R1.yml, so
// a question can name them without a tool). The owner decided on 2026-11-06 that the cases move to a seam-4 test of the ingest
// package, and that was tried: the entry point of the worker is the whole pull, which needs the fake OLIS and the harness
// (`test/support/`), and a test under `src/packages/` that imports `test/` fails `test/scripts/oregonai-boundary.test.ts` (it lints
// a copy of `src/` alone), and the made-up Recording Logs below are built by `test/support/made-up-pdf.ts`, which no package test
// may import (src/packages/pdf-text/tests/links.test.ts says the same). So the file is a pull test, as `<tool>-pull.test.ts` files
// are. The database package's seam-4 tests (`database/tests/link-annotations.test.ts`, `speaker-turn-index.test.ts`,
// `created-before-clock.test.ts`) cover the writer's and the reader's rules at seam 4.
//
// Which cases copy (test/CLAUDE.md, "Templates"): each case starts from a copy of the run's template of the fixture's pull
// (documents served). The first describe only reads. The second adds MADE UP logs and pulls, which fetches only what it adds.
// The third makes the database look as one before the annotations were stored (`forgetLinkAnnotations`, `forgetSpeakerTurns`:
// SQL that only arranges) and pulls again: that pull, which fetches the logs once more, is the subject.
//
// Expected values are literals from the fixture, never from the worker's own output: the addresses of the real log 307521
// (SHS 2025-05-15, the fixture's smallest with player links, one page and 26 links) are the /URI(...) strings of its objects in
// the raw PDF, in its page's /Annots order (documents/committee-meeting-documents/307521.pdf; the seam-2 table
// src/packages/pdf-text/tests/link-annotations.test.ts says how they were read). The made-up logs' addresses are the ones the
// test writes into them, and are labelled so.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openIndexReader, type IndexReader } from "#/packages/database/reader.ts";
import type { DocumentId, StoredLinkAnnotation } from "#/packages/domain/documents.ts";
import { madeUpPdf } from "../support/made-up-pdf.ts";
import { forgetLinkAnnotations, forgetSpeakerTurns } from "../support/old-database.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const clockAt = "2026-08-05T17:00:00Z";
const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument";
const PLAYER = "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486";

const player = (event: string, second: number): StoredLinkAnnotation => ({
  page: 1,
  url: `${PLAYER}&eventID=${event}&startStreamAt=${String(second)}`,
});

/** The 26 links of the real log 307521, read from its raw bytes: the meeting's materials, then two player links for each timecode line. */
const log307521: StoredLinkAnnotation[] = [
  {
    page: 1,
    url: "https://olis.oregonlegislature.gov/liz/2025R1/Committees/SHS/2025-05-15-08-00/MeetingMaterials",
  },
  ...[
    1, 1, 2, 2, 42, 42, 43, 43, 370, 370, 484, 484, 485, 485, 486, 486, 526, 526, 542, 542, 542, 542, 542, 572, 572,
  ].map((second) => player("2025051185", second)),
];

function readerOf(system: System): IndexReader {
  return openIndexReader(system.database.path, system.clock);
}

describe("the real Recording Log 307521, pulled with the fixture", () => {
  let system: System;
  let reader: IndexReader;

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    reader = readerOf(system);
  }, 60_000);

  afterAll(async () => {
    reader.close();
    await system.stop();
  });

  it("holds the page and address of each of its 26 links, in the file's order", () => {
    expect(reader.linkAnnotationsOf("recording-log-2025r1-307521" as DocumentId)).toEqual(log307521);
  });

  it("holds the annotations of a log whose speaker-turn index is as the file's links give it, and the index is not what they come from", () => {
    // The index reads the same links, so its event ID is the one in every player address above: the stored list is the
    // file's, and the index is derived from it, not the other way round.
    expect(reader.speakerTurnIndexOf("recording-log-2025r1-307521" as DocumentId)).toMatchObject({
      kind: "indexed",
      eventId: "2025051185",
    });
  });

  it("holds none for an Exhibit, which is no Recording Log", () => {
    expect(reader.linkAnnotationsOf("exhibit-2025r1-287879" as DocumentId)).toEqual([]);
  });
});

describe("made-up Recording Logs whose index is a gap", () => {
  let system: System;
  let reader: IndexReader;

  /** A MADE UP CommitteeMeetingDocuments row for a Recording Log of HALNRW 2025-01-22, the fixture's meeting. */
  function logRow(id: number): Record<string, unknown> {
    return {
      CommitteeMeetingDocumentId: id,
      SessionKey: "2025R1",
      CommitteeCode: "HALNRW",
      MeetingDate: "2025-01-22T08:00:00",
      ExhibitReference: null,
      ExhibitTitle: "MADE UP recording log",
      Submitter: "staff",
      DocumentType: "Recording Log",
      MeasurePrefix: null,
      MeasureNumber: null,
      DocumentUrl: `${root}/${id}`,
      CreatedDate: "2025-01-29T13:13:06.5416935",
      ModifiedDate: null,
    };
  }

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    system.olis.addRows("CommitteeMeetingDocuments", [logRow(999001), logRow(999002)]);
    const lines = ["MADE UP RECORDING LOG", "00:00:05 Meeting Called to Order", "00:01:00 Meeting Adjourned"];
    // 999001: links to two events, so the parser reports conflicting event IDs and the log has no index.
    system.olis.serveDocument(
      "/liz/2025R1/Downloads/CommitteeMeetingDocument/999001",
      madeUpPdf([lines], {
        links: [
          { page: 1, url: `${PLAYER}&eventID=2099000001&startStreamAt=5`, rect: [40, 750, 100, 762] },
          { page: 1, url: `${PLAYER}&eventID=2099000002&startStreamAt=60`, rect: [40, 726, 100, 738] },
        ],
      }),
    );
    // 999002: no player link at all, only a link to somewhere else, so the log has no event ID and no index.
    system.olis.serveDocument(
      "/liz/2025R1/Downloads/CommitteeMeetingDocument/999002",
      madeUpPdf([lines], {
        links: [{ page: 1, url: "https://made-up.example/materials", rect: [40, 750, 100, 762] }],
      }),
    );
    await system.pullAgain();
    reader = readerOf(system);
  }, 60_000);

  afterAll(async () => {
    reader.close();
    await system.stop();
  });

  it("a log whose links name two events has no index and has every link as the file holds it", () => {
    const id = "recording-log-2025r1-999001" as DocumentId;

    expect(reader.speakerTurnIndexOf(id)).toEqual({
      kind: "conflicting_event_ids",
      eventIds: expect.arrayContaining(["2099000001", "2099000002"]) as string[],
    });
    expect(reader.linkAnnotationsOf(id)).toEqual([
      { page: 1, url: `${PLAYER}&eventID=2099000001&startStreamAt=5` },
      { page: 1, url: `${PLAYER}&eventID=2099000002&startStreamAt=60` },
    ]);
  });

  it("a log with no player link has no index and still holds the one link it has", () => {
    const id = "recording-log-2025r1-999002" as DocumentId;

    expect(reader.speakerTurnIndexOf(id)).toEqual({ kind: "no_event_id" });
    expect(reader.linkAnnotationsOf(id)).toEqual([{ page: 1, url: "https://made-up.example/materials" }]);
  });
});

describe("a database a worker left before the annotations were stored", () => {
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    // No Recording Log has its annotations or its index, as the worker before this ticket left a log stored by #54's pull and
    // read once by #126; the worker fetches such a log again to read its links (ADR-0052).
    forgetSpeakerTurns(system.database.path);
    forgetLinkAnnotations(system.database.path);
    await system.pullAgain();
  }, 60_000);

  afterAll(async () => {
    await system.stop();
  });

  it("stores the annotations of a log it fetches again, with the index it stores beside them", () => {
    const reader = readerOf(system);
    try {
      expect(reader.linkAnnotationsOf("recording-log-2025r1-307521" as DocumentId)).toEqual(log307521);
      expect(reader.speakerTurnIndexOf("recording-log-2025r1-307521" as DocumentId)).toMatchObject({
        kind: "indexed",
        eventId: "2025051185",
      });
    } finally {
      reader.close();
    }
  });
});

// The re-fetch trigger (ADR-0058): a Recording Log that holds an index and no stored annotation is fetched again by the next
// pull, through the re-fetch path of ADR-0052 (fetch, hash check, `bytes_changed`, read), and one that holds annotations is not.
describe("which Recording Logs a pull fetches again for their annotations", () => {
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
  }, 60_000);

  afterAll(async () => {
    await system.stop();
  });

  it("does not fetch a log again that holds its index and its annotations", async () => {
    await system.pullAgain();

    expect(system.buildReport()["recording_log_refetches"]).toEqual({ attempted: 0, failed: [], bytes_changed: [] });
  });

  it("fetches again every log that holds an index and no annotations, and stores them, and then leaves it alone", async () => {
    forgetLinkAnnotations(system.database.path);
    await system.pullAgain();

    // The fixture's 34 stored Recording Logs (get-document-speaker-turns-pull.test.ts counts the same 34).
    expect(system.buildReport()["recording_log_refetches"]).toEqual({ attempted: 34, failed: [], bytes_changed: [] });
    const reader = readerOf(system);
    try {
      expect(reader.linkAnnotationsOf("recording-log-2025r1-307521" as DocumentId)).toEqual(log307521);
    } finally {
      reader.close();
    }

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual({ attempted: 0, failed: [], bytes_changed: [] });
  });
});
