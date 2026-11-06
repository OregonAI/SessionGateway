// Seam 1 (test/CLAUDE.md): a machine transcript follows its Recording Log's creation time (ticket #151, ADR-0056), with the
// publication gate ON (ticket #134, ADR-0055). A transcript passage is of a Recording Log and of its turn, so a clock before the
// log's CreatedDate shows none of it, by words, by meaning, in get_document or in meetings' has_transcript, and a clock after
// shows all of it. The database never changes between the calls; the one injected clock moves.
//
// Its options are those of transcripts-published.test.ts, so it shares that file's template. THE TRANSCRIPT IS MADE UP
// (test/support/made-up-transcript.ts, halnrwSegments), timed to the real lines of HALNRW 2025-01-22's Recording Log, 288741.
// The log's CreatedDate is "2025-01-29T13:13:06.5416935" in the feed (CommitteeMeetingDocuments.json), Pacific, so 13:13:06
// is the last second before it (the existing cases of hide-future-rows.test.ts hide it at that second and show it at :07).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { halnrwEventId, halnrwSegments, madeUpTranscript } from "../support/made-up-transcript.ts";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({
    clockAt: "2026-08-05T17:00:00Z",
    documents: true,
    transcripts: {
      [`${halnrwEventId}.transcript.json`]: madeUpTranscript({ eventId: halnrwEventId, segments: halnrwSegments }),
    },
    serverEnv: { TRANSCRIPTS_PUBLISHED: "true", MCP_RATE_LIMIT: "100000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

const MEETING = "meeting-2025r1-halnrw-2025-01-22-0800";
const LOG = "recording-log-2025r1-288741";
const before = "2025-01-29T13:13:06-08:00";
const after = "2025-01-29T13:13:07-08:00";
const wellAfter = "2026-08-05T10:00:00-07:00";
// Words that only the made-up transcript holds: "quokka laboratory" (Kurt Williams' turn) and "gooseberry".
const words = ["quokka laboratory", "platypus", "gooseberry"];

describe.for(eras)("a transcript and its Recording Log's CreatedDate, for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  async function askAt(moment: string, tool: string, args: Record<string, unknown>) {
    system.clock.set(moment);
    return callTool(connected, tool, args);
  }

  /** The hits of a search that are passages of a machine transcript. */
  async function transcriptHits(moment: string, query: string) {
    const outcome = await askAt(moment, "search", { query });
    expect(outcome.isError).toBe(false);
    const hits = (outcome.structured?.["results"] ?? []) as { id: string; transcript?: unknown }[];
    return hits.filter((hit) => hit.transcript !== undefined);
  }

  it.for(words)("finds %s by its words only once the log exists", async (query) => {
    expect(await transcriptHits(before, query)).toEqual([]);
    expect((await transcriptHits(after, query)).length).toBeGreaterThan(0);
    expect(await transcriptHits(before, query)).toEqual([]);
  });

  it.for(words)(
    "gives no transcript hit for %s by meaning at an early clock after a late one loaded the vectors",
    async (query) => {
      // The late call loads the vectors of every passage; the early one must leave the log's out, by meaning as well as words.
      expect((await transcriptHits(wellAfter, query)).length).toBeGreaterThan(0);
      expect(await transcriptHits(before, query)).toEqual([]);
      const early = await askAt(before, "search", { query });
      expect(early.text).not.toContain("The index has no");
    },
  );

  it("serves no transcript with get_document before the log exists, and all of it after", async () => {
    const early = await askAt(before, "get_document", { id: LOG });
    expect(early.isError).toBe(true);
    expect(early.text).not.toContain("quokka");

    const late = await askAt(after, "get_document", { id: LOG });
    expect(late.isError).toBe(false);
    expect(JSON.stringify(late.structured)).toContain("quokka laboratory");
  });

  it("says in meetings that the Meeting has no transcript before its log exists, and has one after", async () => {
    const args = { committee: "HALNRW", from: "2025-01-22", to: "2025-01-22" };
    const hasTranscript = (outcome: Awaited<ReturnType<typeof askAt>>) =>
      (outcome.structured?.["meetings"] as { id: string; has_transcript?: boolean }[]).find(
        (meeting) => meeting.id === MEETING,
      )?.has_transcript;

    const early = await askAt(before, "meetings", args);
    expect(early.isError).toBe(false);
    expect(hasTranscript(early) ?? false).toBe(false);

    const late = await askAt(after, "meetings", args);
    expect(hasTranscript(late)).toBe(true);
  });
});
