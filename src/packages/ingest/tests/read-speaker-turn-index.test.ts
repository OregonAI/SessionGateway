// Seam 4 (test/CLAUDE.md): the ingest worker's step that reads a fetched Recording Log, `readSpeakerTurnIndex` (ticket #160,
// ADR-0058, ADR-0009), called at the ingest package's entry point with its real collaborators: the Recording Log parser, the
// PDF reader, a real database writer and the reader on one WAL file in a temp directory of the case's own. No fake OLIS and no
// pull; the bytes are given to the step as the worker's fetch would give them. State is read back through the reader's entry
// points (`linkAnnotationsOf`, `speakerTurnIndexOf`). The pull itself (which logs are fetched again) is shown by
// test/tools/recording-log-link-annotations-pull.test.ts.
//
// The real case reads the fixture's Recording Log 307521 (SHS 2025-05-15) from its file by path. Its expected values are the
// addresses the seam-2 table quotes from the raw PDF (pdf-text/tests/link-annotations.test.ts): the meeting's materials, then
// two player links to event 2025051185 for each timecode line. The gap cases are MADE UP files (made-up-pdf.ts), labelled so.
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { openIndexReader, type IndexReader } from "#/packages/database/reader.ts";
import { openIndexWriter, type IndexWriter } from "#/packages/database/writer.ts";
import type { DocumentId, DocumentLink, StoredLinkAnnotation } from "#/packages/domain/documents.ts";
import { parseSessionKey } from "#/packages/domain/index.ts";
import { createLegislatorResolver } from "#/packages/legislators/resolver.ts";
import { LINK_ANNOTATIONS_READER_VERSION, extractPdfText } from "#/packages/pdf-text/index.ts";
import { readSpeakerTurnIndex, rereadLinkAnnotations } from "../index.ts";
import { madeUpPdf } from "./made-up-pdf.ts";

const session = parseSessionKey("2025R1") ?? fail("2025R1 is a Session key");
function fail(message: string): never {
  throw new Error(message);
}
const PLAYER = "https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486";
const FIXTURE = new URL(
  "../../../../test/fixtures/olis-2025R1/documents/committee-meeting-documents/307521.pdf",
  import.meta.url,
);

type Rig = { writer: IndexWriter; reader: IndexReader; close(): void };
let rig: Rig;

function openRig(): Rig {
  const directory = mkdtempDisposableSync(join(tmpdir(), "session-gateway-ingest-"));
  const path = join(directory.path, "index.db");
  const writer = openIndexWriter(path);
  const reader = openIndexReader(path, { now: () => new Date("2026-08-05T17:00:00Z") });
  return {
    writer,
    reader,
    close: () => {
      reader.close();
      writer.close();
      directory.remove();
    },
  };
}

afterEach(() => {
  rig.close();
});

/** The Recording Log's link, as the feed's row gives it, with no meeting or committee relation (the step reads none of it from here). */
function logLink(id: string): DocumentLink {
  return {
    id: id as DocumentId,
    nodeId: id as DocumentId,
    kind: "recording_log",
    label: "Recording Log",
    sourceUrl: `https://made-up.example/${id}.pdf`,
    postedAt: null,
    date: null,
    relations: [],
  };
}

async function readLog(id: string, bytes: Uint8Array) {
  const extraction = await extractPdfText(bytes);
  if (extraction.kind !== "read") throw new Error(`${id} could not be read: ${extraction.reason}`);
  const resolver = createLegislatorResolver({ session, rows: [], aliases: [] });
  const outcome = await readSpeakerTurnIndex(
    { session, writer: rig.writer, resolver },
    logLink(id),
    bytes,
    extraction.pdf.text,
  );
  rig.writer.storeSpeakerTurnIndex({ documentId: id as DocumentId, outcome });
  return outcome;
}

const player = (event: string, second: number): StoredLinkAnnotation => ({
  page: 1,
  url: `${PLAYER}&eventID=${event}&startStreamAt=${String(second)}`,
});

const log307521: StoredLinkAnnotation[] = [
  {
    page: 1,
    url: "https://olis.oregonlegislature.gov/liz/2025R1/Committees/SHS/2025-05-15-08-00/MeetingMaterials",
  },
  ...[
    1, 1, 2, 2, 42, 42, 43, 43, 370, 370, 484, 484, 485, 485, 486, 486, 526, 526, 542, 542, 542, 542, 542, 572, 572,
  ].map((second) => player("2025051185", second)),
];

describe("readSpeakerTurnIndex on the real Recording Log 307521", () => {
  test("stores the page and address of its 26 links in the file's order, and the index it reads is of the same links", async () => {
    rig = openRig();
    const id = "recording-log-2025r1-307521";

    const outcome = await readLog(id, new Uint8Array(readFileSync(FIXTURE)));

    expect(outcome).toMatchObject({ kind: "indexed", eventId: "2025051185" });
    expect(rig.reader.linkAnnotationsOf(id as DocumentId)).toEqual(log307521);
  });
});

describe("readSpeakerTurnIndex on MADE UP Recording Logs whose index is a gap", () => {
  const lines = ["MADE UP RECORDING LOG", "00:00:05 Meeting Called to Order", "00:01:00 Meeting Adjourned"];

  test("a log whose links name two events has every link as the file holds it, and no index", async () => {
    rig = openRig();
    const id = "recording-log-2025r1-999001";
    const bytes = madeUpPdf(lines, [
      { url: `${PLAYER}&eventID=2099000001&startStreamAt=5`, rect: [40, 750, 100, 762] },
      { url: `${PLAYER}&eventID=2099000002&startStreamAt=60`, rect: [40, 726, 100, 738] },
    ]);

    const outcome = await readLog(id, bytes);

    expect(outcome).toEqual({
      kind: "conflicting_event_ids",
      eventIds: expect.arrayContaining(["2099000001", "2099000002"]) as string[],
    });
    expect(rig.reader.speakerTurnIndexOf(id as DocumentId)).toMatchObject({ kind: "conflicting_event_ids" });
    expect(rig.reader.linkAnnotationsOf(id as DocumentId)).toEqual([player("2099000001", 5), player("2099000002", 60)]);
  });

  test("a log with no player link has no event ID and still holds the one link it has", async () => {
    rig = openRig();
    const id = "recording-log-2025r1-999002";
    const bytes = madeUpPdf(lines, [{ url: "https://made-up.example/materials", rect: [40, 750, 100, 762] }]);

    const outcome = await readLog(id, bytes);

    expect(outcome).toEqual({ kind: "no_event_id" });
    expect(rig.reader.speakerTurnIndexOf(id as DocumentId)).toEqual({ kind: "no_event_id" });
    expect(rig.reader.linkAnnotationsOf(id as DocumentId)).toEqual([
      { page: 1, url: "https://made-up.example/materials" },
    ]);
  });
});

describe("readSpeakerTurnIndex stores the annotations whatever the index outcome", () => {
  test("a log read again as a gap, then as indexed, keeps the file's links each time and replaces them with the new file's", async () => {
    rig = openRig();
    const id = "recording-log-2025r1-999003";
    const lines = ["MADE UP RECORDING LOG", "00:00:05 Meeting Called to Order"];
    const gap = madeUpPdf(lines, [{ url: "https://made-up.example/a", rect: [40, 750, 100, 762] }]);
    const indexed = madeUpPdf(lines, [
      { url: `${PLAYER}&eventID=2099000003&startStreamAt=5`, rect: [40, 750, 100, 762] },
    ]);

    expect(await readLog(id, gap)).toEqual({ kind: "no_event_id" });
    expect(rig.reader.linkAnnotationsOf(id as DocumentId)).toEqual([{ page: 1, url: "https://made-up.example/a" }]);

    expect(await readLog(id, indexed)).toMatchObject({ kind: "indexed", eventId: "2099000003" });
    expect(rig.reader.linkAnnotationsOf(id as DocumentId)).toEqual([player("2099000003", 5)]);
    expect(rig.reader.speakerTurnIndexOf(id as DocumentId)).toMatchObject({ kind: "indexed" });
  });
});

describe("rereadLinkAnnotations (ticket #187, ADR-0066)", () => {
  test("replaces a log's annotations with the file's as the current reader reads them and leaves the log's index alone", async () => {
    rig = openRig();
    const id = "recording-log-2025r1-999004";
    const lines = ["MADE UP RECORDING LOG", "00:00:05 Meeting Called to Order"];
    const file = madeUpPdf(lines, [{ url: `${PLAYER}&eventID=2099000004&startStreamAt=5`, rect: [40, 750, 100, 762] }]);
    await readLog(id, file);
    const indexBefore = rig.reader.speakerTurnIndexOf(id as DocumentId);
    rig.writer.storeLinkAnnotations(id as DocumentId, [{ page: 1, url: "https://made-up.example/older" }], 0);

    await rereadLinkAnnotations({ writer: rig.writer }, logLink(id), file);

    expect(rig.reader.linkAnnotationsOf(id as DocumentId)).toEqual([player("2099000004", 5)]);
    expect(rig.reader.speakerTurnIndexOf(id as DocumentId)).toEqual(indexBefore);
  });
});
