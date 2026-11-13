// Which Recording Logs a pull fetches again for their link annotations (ticket #160, ADR-0058). The pull is the subject, so each
// case reads only what a pull shows: the build report's `recording_log_refetches`. The annotations a pull stores, and the gap
// cases, are read back at seam 4 (src/packages/ingest/tests/read-speaker-turn-index.test.ts), and the writer's and the
// reader's rules in src/packages/database/tests/{link-annotations,speaker-turn-index,created-before-clock}.test.ts.
//
// Each case starts from a copy of the run's template of the fixture's pull (documents served; test/CLAUDE.md, "Templates") and
// arranges, where it needs an older database, with SQL that only arranges (`forgetLinkAnnotations`, `forgetSpeakerTurns`,
// test/support/old-database.ts). The fixture holds 34 stored Recording Logs (get-document-speaker-turns-pull.test.ts counts
// the same 34), and each has links.
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { RECORDING_LOG_REREAD_LIMIT } from "#/packages/ingest/index.ts";
import {
  forgetLinkAnnotations,
  forgetSpeakerTurns,
  readAnnotationsWithAnOlderReader,
  readIndexWithAnOlderReader,
} from "../support/old-database.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

const clockAt = "2026-08-05T17:00:00Z";
const none = { attempted: 0, failed: [], bytes_changed: [] };

let system: System;
afterEach(async () => {
  await system.stop();
});

describe("which Recording Logs a pull fetches again for their annotations", () => {
  it("fetches none again from a database whose logs hold their index and their annotations", async () => {
    system = await startCopiedSystem({ clockAt, documents: true });

    await system.pullAgain();

    expect(system.buildReport()["recording_log_refetches"]).toEqual(none);
  });

  it("fetches every log again that holds an index and no annotations, and none on the pull after", async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    forgetLinkAnnotations(system.database.path);

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual({ ...none, attempted: 34 });

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual(none);
  });

  it("fetches each log once for a database a worker left before the index and the annotations existed", async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    forgetSpeakerTurns(system.database.path);
    forgetLinkAnnotations(system.database.path);

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual({ ...none, attempted: 34 });

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual(none);
  });
});

// Ticket #187 (ADR-0066): a log whose annotations an older reader made is fetched again, at most RECORDING_LOG_REREAD_LIMIT logs
// in one pull (the fetch needs the file, which only OLIS holds), and the rest on the pulls after. The version is recorded when a
// log is read, so a log read by the current reader is not fetched again.
describe("which Recording Logs a pull fetches again for an older annotation reader", () => {
  it("fetches at most the limit in one pull and the rest on the next, then none", async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    readAnnotationsWithAnOlderReader(system.database.path);
    expect(RECORDING_LOG_REREAD_LIMIT).toBeLessThan(34);

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual({ ...none, attempted: RECORDING_LOG_REREAD_LIMIT });

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual({
      ...none,
      attempted: 34 - RECORDING_LOG_REREAD_LIMIT,
    });

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual(none);
  });
});

// Ticket #187 (ADR-0066): a bump of the annotation reader's version makes no other reading again. Storing a log's index deletes and
// inserts its turns again, resets its turn Passages and item Measures and marks the Meeting's transcripts for attaching again, so an
// annotation re-read that stored the index would show in the turns' row ids.
describe("an older annotation reader makes no other reading again", () => {
  it("leaves each log's stored turns as they were while it reads their annotations again", async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    readAnnotationsWithAnOlderReader(system.database.path);
    const turnRows = (): unknown[] => {
      const database = new DatabaseSync(system.database.path, { readOnly: true, timeout: 5000 });
      try {
        return database.prepare("SELECT rowid, document_id, position FROM speaker_turn ORDER BY rowid").all();
      } finally {
        database.close();
      }
    };
    const before = turnRows();
    expect(before.length).toBeGreaterThan(0);

    await system.pullAgain();

    expect(system.buildReport()["recording_log_refetches"]).toEqual({ ...none, attempted: RECORDING_LOG_REREAD_LIMIT });
    expect(turnRows()).toEqual(before);
  });
});

// Ticket #187 (ADR-0066): the speaker-turn index has its own version. A log whose index an older reader made is fetched again,
// and the cap is one for both readings: a log stale in both is one fetch, and the two together never ask OLIS for more than the
// limit in a pull.
describe("which Recording Logs a pull fetches again for an older index reader", () => {
  it("fetches at most the limit in one pull and the rest on the next, then none", async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    readIndexWithAnOlderReader(system.database.path);

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual({ ...none, attempted: RECORDING_LOG_REREAD_LIMIT });

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual({
      ...none,
      attempted: 34 - RECORDING_LOG_REREAD_LIMIT,
    });

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual(none);
  });

  it("counts a log whose annotations and index are both stale once, and fetches no more than the limit", async () => {
    system = await startCopiedSystem({ clockAt, documents: true });
    readIndexWithAnOlderReader(system.database.path);
    readAnnotationsWithAnOlderReader(system.database.path);

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual({ ...none, attempted: RECORDING_LOG_REREAD_LIMIT });

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual({
      ...none,
      attempted: 34 - RECORDING_LOG_REREAD_LIMIT,
    });

    await system.pullAgain();
    expect(system.buildReport()["recording_log_refetches"]).toEqual(none);
  });
});
