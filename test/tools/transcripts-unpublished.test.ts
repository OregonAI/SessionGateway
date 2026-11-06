// Seam 1 (test/CLAUDE.md): machine transcripts in the tools with the publication gate OFF (ticket #134, ADR-0055, spec #123
// decision 23: transcripts are built and ingested and kept off the public box until the owner says publish). It is
// transcripts-published.test.ts's database, the same made-up transcript of HALNRW 2025-01-22 (Recording Log 288741, Invintus
// event 2025011038) already ingested by the worker, with the server's gate unset (the default) and set to false. The claim: no tool's answer holds any word of it, and the stage-1 turns of the
// log are as they were.
//
// Its database is shared by every case and is a copy of the run's template for its options (see the published file). Each
// case reads, so none changes it.
//
// The claims are all "nothing is there", which would pass just as well over a database with no transcript in it. So each
// system's own database is also read by a second server with the gate ON (the same database, the same file, a handler of its
// own): the case "the database holds the transcript" says the words are there to be kept out.
//
// Expected values: the made-up words are the ones in test/support/made-up-transcript.ts (halnrwSegments); the stage-1 turn is
// a literal from the fixture's real log 288741 (Kurt Williams, 00:02:49 = 169 s, event 2025011038, the log's own player
// link with the clientID 4879615486; get-document-speaker-turns.test.ts says how those were read from the raw PDF).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { halnrwEventId, halnrwSegments, madeUpTranscript } from "../support/made-up-transcript.ts";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";
import { createFakeEmbedder } from "../support/fake-embedder.ts";
import { createSessionGatewayHandler, type SessionGatewayHandler } from "#/packages/mcp-server/handler.ts";

const options = {
  clockAt: "2026-08-05T17:00:00Z",
  documents: true,
  transcripts: {
    [`${halnrwEventId}.transcript.json`]: madeUpTranscript({ eventId: halnrwEventId, segments: halnrwSegments }),
  },
};

/** The made-up words, one for each passage of the file: none may be in any answer. */
const madeUpWords = ["quokka", "platypus", "petunia", "marmalade", "gooseberry", "welcome everyone", "staff summary"];

describe.for([
  ["unset", undefined],
  ["false", "false"],
] as const)("the gate is %s", ([, setting]) => {
  let system: System;
  let connected: ConnectedClient;
  /** A server of its own on the same database with the gate on: what the database holds, as an owner who publishes would see it. */
  let publishing: SessionGatewayHandler;
  let publishingClient: ConnectedClient;

  beforeAll(async () => {
    system = await startCopiedSystem({
      ...options,
      ...(setting === undefined ? {} : { serverEnv: { TRANSCRIPTS_PUBLISHED: setting } }),
    });
    connected = await connectClient("2026-07-28", system.handler);
    publishing = createSessionGatewayHandler(
      { ...system.serverConfig, transcriptsPublished: true },
      {
        clock: system.clock,
        fetch,
        signal: new AbortController().signal,
        onLiveLookupFailed: () => {},
        embedder: await createFakeEmbedder(),
      },
    );
    publishingClient = await connectClient("2026-07-28", publishing);
  }, 60_000);

  afterAll(async () => {
    await publishingClient.close();
    await publishing.close();
    await connected.close();
    await system.stop();
  });

  it("the database holds the transcript: a server on it with the gate on finds the words the gate-off server cannot, by their words and in get_document", async () => {
    const search = await callTool(publishingClient, "search", { query: "quokka laboratory" });
    const hits = search.structured?.["results"] as { snippet: string; transcript?: { speaker: string } }[];
    expect(hits.find((hit) => hit.transcript !== undefined)?.snippet).toContain("quokka laboratory tests samples");
    const log = await callTool(publishingClient, "get_document", { id: "recording-log-2025r1-288741" });
    expect(JSON.stringify(log.structured?.["speaker_turns"])).toContain("quokka laboratory tests samples");
    // The same questions of this file's server, with the gate off, find none of it (the cases below hold that for every tool).
    const off = await callTool(connected, "search", { query: "quokka laboratory" });
    expect(JSON.stringify(off.structured?.["results"])).not.toContain("quokka laboratory tests samples");
  });

  function holdsNoTranscript(outcome: { structured: Record<string, unknown> | undefined }): void {
    // A search answer echoes the query it was asked, which holds the word the case looked for: that is not a hit.
    const answer: Record<string, unknown> = { ...outcome.structured };
    delete answer["query"];
    const everything = JSON.stringify(answer).toLowerCase();
    for (const word of madeUpWords) expect(everything, word).not.toContain(word);
    expect(everything).not.toContain("machine transcript");
    expect(everything).not.toContain("has_transcript");
    expect(everything).not.toContain('"transcript"');
  }

  it("search finds none of the words, by their words or by meaning, and no hit has a transcript", async () => {
    for (const query of [
      "quokka laboratory",
      "platypus bill needs a hearing",
      "petunia bill",
      "gooseberry",
      "marmalade amendment",
    ]) {
      const outcome = await callTool(connected, "search", { query });

      expect(outcome.isError).toBe(false);
      holdsNoTranscript(outcome);
      const results = outcome.structured?.["results"] as { snippet: string; transcript?: unknown }[];
      expect(
        results.every((hit) => hit.transcript === undefined),
        query,
      ).toBe(true);
    }
  });

  it("get_document on the Recording Log gives its stage-1 turns as they were: no transcript field on the log or a turn", async () => {
    const outcome = await callTool(connected, "get_document", { id: "recording-log-2025r1-288741" });

    expect(outcome.isError).toBe(false);
    holdsNoTranscript(outcome);
    const turns = (outcome.structured?.["speaker_turns"] as { turns: Record<string, unknown>[] }).turns;
    expect(turns).toHaveLength(38);
    expect(turns.find((turn) => turn["timecode"] === "00:02:49")).toEqual({
      timecode: "00:02:49",
      offset_seconds: 169,
      offset_source: "link",
      speaker: "Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State University (OSU)",
      legislator_code: null,
      legislator: null,
      agenda_item: "HB 2167 - Public Hearing",
      measure_id: null,
      player_link: `https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=${halnrwEventId}&startStreamAt=169`,
    });
    expect(Object.keys(outcome.structured?.["speaker_turns"] as object).toSorted()).toEqual([
      "conflicting_event_ids",
      "event_id",
      "gap",
      "indexed",
      "pages_read_by_timecode",
      "turn_count",
      "turns",
    ]);
  });

  it("meetings does not say the Meeting has a transcript, and has no such field", async () => {
    const outcome = await callTool(connected, "meetings", {
      committee: "HALNRW",
      from: "2025-01-22",
      to: "2025-01-22",
    });

    expect(outcome.isError).toBe(false);
    holdsNoTranscript(outcome);
    const meetings = outcome.structured?.["meetings"] as Record<string, unknown>[];
    expect(meetings).toHaveLength(1);
    expect(meetings[0]?.["has_speaker_turn_index"]).toBe(true);
    expect("has_transcript" in (meetings[0] ?? {})).toBe(false);
  });

  it("get_measure, whose hearings name the first turn under HB 3131's Agenda item, shows none of it", async () => {
    const outcome = await callTool(connected, "get_measure", { measure: "HB 3131" });

    expect(outcome.isError).toBe(false);
    holdsNoTranscript(outcome);
  });

  it("the notice has no machine-transcript clause on a result that would have carried a passage", async () => {
    const outcome = await callTool(connected, "search", { query: "quokka laboratory" });

    expect(String(outcome.structured?.["notice"])).toMatch(/not the official record/i);
    expect(String(outcome.structured?.["notice"]).toLowerCase()).not.toContain("transcript");
  });
});

describe("a gate that is neither true nor false", () => {
  it("stops the server at start-up, naming the variable and never its value", async () => {
    const failure = await startCopiedSystem({
      ...options,
      serverEnv: { TRANSCRIPTS_PUBLISHED: "perhaps-later" },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("TRANSCRIPTS_PUBLISHED");
    expect((failure as Error).message).not.toContain("perhaps-later");
  }, 60_000);
});
