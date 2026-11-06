// Seam 1 (test/CLAUDE.md): the worker ingests transcript files (ticket #134, ADR-0055). The subject is the worker's pull, so
// each case starts from a system of its own: a copy of the run's template for a worker with an EMPTY transcript folder
// (`transcripts: {}`, which sets TRANSCRIPTS_PATH), writes files into the folder, and pulls again, which is the pull that reads
// them (the pull of the fixture's documents is the template's). The cases that give their own embedder (a case that reads which
// passages the worker embedded) pull the fixture for themselves, because an embedder is code and is no part of a template's key.
// The server's gate is on (TRANSCRIPTS_PUBLISHED=true) where a case reads what was stored through `search` or `meetings`; the
// worker ingests whatever the gate says, which transcripts-unpublished.test.ts shows from the other side.
//
// THE TRANSCRIPTS ARE MADE UP (test/support/made-up-transcript.ts) and timed to the real lines of HALNRW 2025-01-22's
// Recording Log, 288741 (Invintus event 2025011038, meeting meeting-2025r1-halnrw-2025-01-22-0800). The real events of
// other fixture logs, from the /URI of their raw PDFs: 289259 (HALNRW 2025-01-27) 2025011111, 292588 (HALNRW 2025-02-12)
// 2025021177, 295094 (SFR 2025-03-17) 2025031219. Expected values are worked, never read from a tool or the report:
// - halnrwSegments make 8 passages: the first segment splits where Helm's turn (4 s) begins ("Okay then" before it, "welcome
//   everyone" after), the motion's words, the segment that spans Glueder's and Williams's turns splits in two, then one
//   passage each for McDonald's, Helm's under HB 3131 and the words after the adjournment;
// - the log has 38 turns, at the seconds below (the log's timecodes, read from the raw text: 00:00:04 is 4, 00:01:47 is 107,
//   01:21:19 is 4879). The segments start at 0.5, 53, 164.5, 1310, 4560 and 5352 s, so a turn's drift is its distance to the
//   nearest of those: 33 of the 38 are more than 10 s from every start, the largest is 1587 s (the turn at 2973 s, 4560 - 2973)
//   and the median of the 38 distances (the mean of the 19th and 20th when they are put in order) is 315 s, so the Meeting is
//   flagged (its median is more than 10 s). A file with a segment 0.5 s after each of the 38 turns has every distance 0.5 s.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFakeEmbedder } from "../support/fake-embedder.ts";
import {
  halnrwEventId,
  halnrwSegments,
  madeUpTranscript,
  wordsFrom,
  type MadeUpSegment,
} from "../support/made-up-transcript.ts";
import { callTool, connectClient, type ConnectedClient } from "../support/mcp-clients.ts";
import { recordEmbeddings } from "../support/recording-embedder.ts";
import { startCopiedSystem, startSystem, systemTemplate, type System } from "../support/system.ts";

const FILE = `${halnrwEventId}.transcript.json`;
const MEETING = "meeting-2025r1-halnrw-2025-01-22-0800";
const base = {
  clockAt: "2026-08-05T17:00:00Z",
  documents: true,
  serverEnv: { TRANSCRIPTS_PUBLISHED: "true" },
};
const withFolder = systemTemplate({ ...base, transcripts: {} });
const standard = madeUpTranscript({ eventId: halnrwEventId, segments: halnrwSegments });

/** The seconds of the 38 turns of log 288741: the timecodes of its speaker lines (see the header). */
const turnSeconds = [
  4, 49, 98, 107, 169, 375, 524, 689, 725, 880, 1017, 1085, 1214, 1303, 1358, 1386, 1444, 1758, 2001, 2026, 2197, 2362,
  2431, 2813, 2973, 3104, 3180, 3377, 3638, 3683, 3909, 4249, 4482, 4549, 4569, 4798, 4856, 4879,
];

type Report = {
  folder_error: string | null;
  stored: number;
  ingested: { meeting_id: string; event_id: string; file: string; passages: number }[];
  refused: { file: string; reason: string; message: string }[];
  drift_flags: {
    meeting_id: string;
    event_id: string;
    file: string;
    median_seconds: number | null;
    max_seconds: number | null;
    flagged_turns: number;
    meeting_flagged: boolean;
  }[];
  unmatched_files: string[];
};

function transcriptsReport(system: System): Report {
  return system.buildReport()["transcripts"] as Report;
}

async function hitsFor(
  system: System,
  query: string,
): Promise<{ transcript?: { speaker: string }; snippet: string }[]> {
  const connected: ConnectedClient = await connectClient("2026-07-28", system.handler);
  try {
    const outcome = await callTool(connected, "search", { query });
    expect(outcome.isError).toBe(false);
    return outcome.structured?.["results"] as { transcript?: { speaker: string }; snippet: string }[];
  } finally {
    await connected.close();
  }
}

describe("the worker ingests transcript files", () => {
  const systems: System[] = [];
  afterAll(async () => {
    await Promise.all(systems.splice(0).map((system) => system.stop()));
  });
  async function started(): Promise<System> {
    const system = await withFolder.start();
    systems.push(system);
    return system;
  }
  function put(system: System, name: string, text: string): void {
    writeFileSync(join(system.transcriptFolder, name), text);
  }

  it("stores the file of a Meeting with a speaker-turn index, and the build report names it with the passages it made", async () => {
    const system = await started();
    put(system, FILE, standard);

    await system.pullAgain();

    expect(transcriptsReport(system)).toMatchObject({
      stored: 1,
      ingested: [{ meeting_id: MEETING, event_id: halnrwEventId, file: FILE, passages: 8 }],
      refused: [],
      unmatched_files: [],
    });
    expect((await hitsFor(system, "quokka laboratory"))[0]?.transcript?.speaker).toMatch(/^Kurt Williams/);
  });

  it("ingests whatever the gate says: the build report is the same with the server's gate off", async () => {
    const system = await withFolder.start({ serverEnv: { TRANSCRIPTS_PUBLISHED: "false" } });
    systems.push(system);
    put(system, FILE, standard);

    await system.pullAgain();

    expect(transcriptsReport(system).ingested).toHaveLength(1);
    expect(await hitsFor(system, "quokka laboratory")).toSatisfy((hits: { transcript: unknown }[]) =>
      hits.every((hit) => hit.transcript === undefined || hit.transcript === null),
    );
  });

  it("reads a file the folder gains after the first pull, in an increment too", async () => {
    const system = await started();

    put(system, FILE, standard);
    await system.incrementAgain();

    expect((await hitsFor(system, "platypus bill"))[0]?.transcript?.speaker).toBe("Vice-Chair Finger McDonald");
  });

  it("does not read a stored file again while its sha256 is the same, and reads it again when the file changes", async () => {
    const system = await started();
    put(system, FILE, standard);
    await system.pullAgain();

    await system.pullAgain();
    expect(transcriptsReport(system)).toMatchObject({ stored: 1, ingested: [] });

    // The same event, other words: the old words are gone and the new are found.
    const changed = madeUpTranscript({
      eventId: halnrwEventId,
      segments: [{ start: 170, end: 175, words: wordsFrom(170, "Good morning the walrus laboratory") }],
      audioSeed: "MADE UP audio, a second transcription",
    });
    put(system, FILE, changed);
    await system.pullAgain();

    expect(transcriptsReport(system)).toMatchObject({
      stored: 1,
      ingested: [{ event_id: halnrwEventId, passages: 1 }],
    });
    expect((await hitsFor(system, "walrus laboratory"))[0]?.transcript?.speaker).toMatch(/^Kurt Williams/);
    expect((await hitsFor(system, "quokka")).some((hit) => hit.transcript !== undefined)).toBe(false);
  });

  it("refuses a file of an unknown version, of another event than its name and Meeting, or not valid, and names each in the build report", async () => {
    const system = await started();
    // 289259 is HALNRW 2025-01-27 (event 2025011111), 292588 is HALNRW 2025-02-12 (2025021177), 295094 is SFR 2025-03-17 (2025031219).
    put(
      system,
      "2025011111.transcript.json",
      madeUpTranscript({ eventId: "2025011111", segments: [], formatVersion: 2 }),
    );
    put(system, "2025021177.transcript.json", madeUpTranscript({ eventId: halnrwEventId, segments: halnrwSegments }));
    put(system, "2025031219.transcript.json", `${JSON.stringify({ format_version: 1, event_id: "2025031219" })}\n`);

    await system.pullAgain();

    const report = transcriptsReport(system);
    expect(report.stored).toBe(0);
    expect(report.ingested).toEqual([]);
    expect(report.refused.map((refusal) => [refusal.file, refusal.reason])).toEqual([
      ["2025011111.transcript.json", "unknown_version"],
      ["2025021177.transcript.json", "event_id_mismatch"],
      ["2025031219.transcript.json", "not_valid"],
    ]);
    expect(report.refused[0]?.message).toContain("2025011111.transcript.json");
    expect(report.refused[0]?.message).toContain("2");
    expect(report.refused[1]?.message).toContain('"2025011038"');
    expect(report.refused[1]?.message).toContain('"2025021177"');
    expect(report.refused[2]?.message).toContain("2025031219.transcript.json");
    // None of them is stored: no Meeting says it has a transcript and no search finds the words.
    const connected = await connectClient("2026-07-28", system.handler);
    try {
      const outcome = await callTool(connected, "meetings", {
        committee: "HALNRW",
        from: "2025-01-22",
        to: "2025-02-12",
      });
      const meetings = outcome.structured?.["meetings"] as { has_transcript?: boolean }[];
      expect(meetings.length).toBeGreaterThan(1);
      expect(meetings.every((meeting) => meeting.has_transcript === false)).toBe(true);
    } finally {
      await connected.close();
    }
    expect((await hitsFor(system, "quokka")).some((hit) => hit.transcript !== undefined)).toBe(false);
  });

  it("keeps what it stored when the file is replaced by one it refuses, and says so", async () => {
    const system = await started();
    put(system, FILE, standard);
    await system.pullAgain();

    put(system, FILE, "this is not JSON\n");
    await system.pullAgain();

    expect(transcriptsReport(system)).toMatchObject({ stored: 1, refused: [{ file: FILE, reason: "not_valid" }] });
    expect((await hitsFor(system, "quokka laboratory"))[0]?.transcript?.speaker).toMatch(/^Kurt Williams/);
  });

  it("says in the build report that the folder it is named cannot be listed, and the pull still completes", async () => {
    const system = await started();
    rmSync(system.transcriptFolder, { recursive: true });

    await system.pullAgain();

    const report = transcriptsReport(system);
    expect(report.folder_error).toContain(system.transcriptFolder);
    expect(report).toMatchObject({ stored: 0, ingested: [], refused: [] });
  });

  it("lists a file of an event no Meeting's Recording Log names", async () => {
    const system = await started();
    put(system, "9999999999.transcript.json", madeUpTranscript({ eventId: "9999999999", segments: [] }));
    put(system, "notes.txt", "not a transcript file");

    await system.pullAgain();

    expect(transcriptsReport(system)).toMatchObject({
      stored: 0,
      ingested: [],
      refused: [],
      unmatched_files: ["9999999999.transcript.json"],
    });
  });

  it("flags a Meeting whose turns are far from the transcript's segments, with the median and largest drift and the turns over 10 s", async () => {
    const system = await started();
    put(system, FILE, standard);

    await system.pullAgain();

    expect(transcriptsReport(system).drift_flags).toEqual([
      {
        meeting_id: MEETING,
        event_id: halnrwEventId,
        file: FILE,
        median_seconds: 315,
        max_seconds: 1587,
        flagged_turns: 33,
        meeting_flagged: true,
      },
    ]);
  });

  it("flags nothing for a transcript with a segment at every turn", async () => {
    const system = await started();
    const segments: MadeUpSegment[] = turnSeconds.map((second) => ({
      start: second + 0.5,
      end: second + 1.5,
      words: wordsFrom(second + 0.5, "word"),
    }));
    put(system, FILE, madeUpTranscript({ eventId: halnrwEventId, segments }));

    await system.pullAgain();

    expect(transcriptsReport(system)).toMatchObject({ stored: 1, drift_flags: [] });
  });

  it("keeps a drift flag in the build report of a later pull that does not read the file again", async () => {
    const system = await started();
    put(system, FILE, standard);
    await system.pullAgain();

    await system.pullAgain();

    expect(transcriptsReport(system)).toMatchObject({
      ingested: [],
      drift_flags: [{ meeting_id: MEETING, meeting_flagged: true }],
    });
  });
});

describe("what the worker embeds", () => {
  it("embeds each transcript passage once, like Testimony, and not again for a file it has stored", async () => {
    const recorded = recordEmbeddings(await createFakeEmbedder());
    const system = await startSystem({
      ...base,
      embedder: recorded.embedder,
      transcripts: { [FILE]: standard },
    });
    try {
      const texts = recorded.embedded.map((passage) => passage.text);
      for (const said of [
        "welcome everyone",
        "Okay then",
        "I move the marmalade amendment as printed",
        "that concludes the staff summary",
        "Good morning members the quokka laboratory tests samples",
        "The platypus bill needs a hearing",
        "The petunia bill is open",
        "Thanks everyone gooseberry adjourned",
      ]) {
        expect(
          texts.filter((text) => text === said),
          said,
        ).toHaveLength(1);
      }

      recorded.embedded.length = 0;
      await system.pullAgain();

      expect(recorded.embedded).toEqual([]);
    } finally {
      await system.stop();
    }
  }, 120_000);
});

describe("a worker with no transcript folder", () => {
  it("has no transcripts section in its build report, and so a report as it was before transcripts", async () => {
    const system = await startCopiedSystem({ clockAt: base.clockAt, documents: true });
    try {
      expect("transcripts" in system.buildReport()).toBe(false);
    } finally {
      await system.stop();
    }
  });
});
