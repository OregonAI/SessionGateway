// The worker's reading of transcript files (ticket #134, ADR-0055). OregonAI/hearing-transcripts writes one file for each
// recording, `<eventId>.transcript.json`, into the folder the deployment names (TRANSCRIPTS_PATH). For each Meeting whose
// Recording Log has a speaker-turn index, a file for the event ID its links name that is not stored yet (or whose sha256, or
// whose turns and entries, changed) is read by the transcript read (ADR-0054) against the Meeting's turns and the log's other
// entries, and its passages are stored: one for each attached run of words, cut to the passage size, embedded like Testimony.
// The worker reads whatever the publication gate says; the gate is the server's.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IndexWriter } from "#/packages/database/writer.ts";
import type { DocumentId } from "#/packages/domain/documents.ts";
import { measureIdOf, type MeasureId, type SessionKey } from "#/packages/domain/index.ts";
import type { SpeakerTurn } from "#/packages/domain/speaker-turns.ts";
import type {
  StoredPassageSpeaker,
  TranscriptNotes,
  TranscriptPassage,
  TranscriptTarget,
} from "#/packages/domain/transcripts.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import {
  entriesOfLogText,
  measureOfAgendaItem,
  playerLinkOf,
  type RecordingLogEntry,
} from "#/packages/recording-log/index.ts";
import { splitPassages } from "#/packages/search/passages.ts";
import { quantizeUnitVector } from "#/packages/search/vectors.ts";
import {
  readTranscript,
  type Passage as AttachedPassage,
  type TranscriptWord,
} from "#/packages/transcript-read/index.ts";
import type { TranscriptsReport } from "./build-report.ts";

const FILE_NAME = /^(.+)\.transcript\.json$/;

/**
 * Raised when how passages are attached to turns changes (ADR-0055): it is in the hash a stored transcript says it was attached
 * to, so every stored transcript is attached again by the next pull.
 */
const ATTACHMENT_VERSION = 1;

const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** What one run of the step did: the parts of the report that are about this run. */
export type TranscriptsRun = Omit<TranscriptsReport, "stored" | "drift_flags">;

/** What the step needs besides the folder. */
export type TranscriptsStep = {
  session: SessionKey;
  writer: IndexWriter;
  embedder: Embedder;
  /** The folder of transcript files: TRANSCRIPTS_PATH. */
  folder: string;
};

/** A turn of the Meeting's recording, whichever of its logs it is of, with the position it has there. */
type MergedTurn = SpeakerTurn & { position: number; documentId: DocumentId };

/** The folder's files named `<eventId>.transcript.json`, by event ID; or the reason it could not be listed. */
function listFolder(
  folder: string,
): { kind: "listed"; files: Map<string, string> } | { kind: "error"; message: string } {
  try {
    const files = new Map<string, string>();
    for (const name of readdirSync(folder).toSorted()) {
      const match = FILE_NAME.exec(name);
      if (match?.[1] !== undefined) files.set(match[1], name);
    }
    return { kind: "listed", files };
  } catch (error) {
    // A folder the deployment names and the worker cannot list is a fact for the report, and not a reason to fail the pull.
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
      return { kind: "error", message: `${folder}: the folder does not exist or is not a folder` };
    }
    throw new Error(`The transcript folder ${folder} could not be listed`, { cause: error });
  }
}

/** The text of an Agenda item line, and the Measure it begins with when the index holds it. */
function agendaOf(
  text: string | null,
  session: SessionKey,
  held: ReadonlySet<MeasureId>,
): { agendaItem: string | null; measureId: MeasureId | null } {
  const named = measureOfAgendaItem(text);
  const measureId = named === null ? null : measureIdOf({ session, ...named });
  return { agendaItem: text, measureId: measureId !== null && held.has(measureId) ? measureId : null };
}

/** The passage cut to Passage size: the pieces, each with its words' seconds, or the passage whole when it fits. */
function cutToSize(
  passage: AttachedPassage<MergedTurn, RecordingLogEntry>,
  embedder: Embedder,
): { text: string; startSeconds: number; endSeconds: number }[] {
  const whole = { text: passage.text, startSeconds: passage.startSeconds, endSeconds: passage.endSeconds };
  if (embedder.countTokens(passage.text) <= embedder.maxPassageTokens) return [whole];
  const pieces: { text: string; startSeconds: number; endSeconds: number }[] = [];
  let run: TranscriptWord[] = [];
  let tokens = 0;
  const close = (): void => {
    const first = run[0];
    const last = run.at(-1);
    if (first !== undefined && last !== undefined) {
      pieces.push({
        text: run
          .map((word) => word.text)
          .join("")
          .trim(),
        startSeconds: first.start,
        endSeconds: last.end,
      });
    }
    run = [];
    tokens = 0;
  };
  for (const word of passage.words) {
    const size = embedder.countTokens(word.text.trim());
    if (run.length > 0 && tokens + size > embedder.maxPassageTokens) close();
    run.push(word);
    tokens += size;
  }
  close();
  // A passage with no words, or a single word longer than a Passage may be, is cut as any text is, and its pieces share its seconds.
  return (pieces.length === 0 ? [whole] : pieces).flatMap((piece) =>
    embedder.countTokens(piece.text) <= embedder.maxPassageTokens
      ? [piece]
      : splitPassages(piece.text, embedder).map((cut) => ({ ...piece, text: cut.text })),
  );
}

/** The vectors a transcript's passages need that the index lacks: one for each distinct text, as a document's passages are embedded. */
async function newVectors(
  writer: IndexWriter,
  embedder: Embedder,
  passages: readonly TranscriptPassage[],
): Promise<{
  vectors: { modelId: string; rows: { hash: string; vector: Int8Array }[] };
  embedded: number;
  reused: number;
}> {
  const distinct = [...new Map(passages.map((passage) => [passage.hash, passage])).values()];
  const stored = writer.storedVectorHashes(
    embedder.modelId,
    distinct.map((passage) => passage.hash),
  );
  const missing = distinct.filter((passage) => !stored.has(passage.hash));
  const vectors = await embedder.embedPassages(missing.map((passage) => passage.text));
  return {
    vectors: {
      modelId: embedder.modelId,
      rows: missing.map((passage, index) => ({
        hash: passage.hash,
        vector: quantizeUnitVector(vectors[index] as Float32Array),
      })),
    },
    embedded: missing.length,
    reused: passages.length - missing.length,
  };
}

/** Reads the folder's files for the Session's Meetings and stores what is new or changed. */
export async function ingestTranscripts(step: TranscriptsStep): Promise<TranscriptsRun> {
  const { session, writer, embedder } = step;
  const run: TranscriptsRun = { folder_error: null, ingested: [], refused: [], unmatched_files: [] };
  const listing = listFolder(step.folder);
  if (listing.kind === "error") return { ...run, folder_error: listing.message };
  const targets = writer.transcriptTargets(session);
  const stored = new Map(writer.storedTranscripts(session).map((key) => [`${key.meetingId}\u0000${key.eventId}`, key]));
  const held = writer.heldMeasureIds(session);
  const eventIds = new Set(targets.map((target) => target.eventId));
  run.unmatched_files = [...listing.files.entries()]
    .filter(([eventId]) => !eventIds.has(eventId))
    .map(([, name]) => name);

  for (const target of targets) {
    const file = listing.files.get(target.eventId);
    if (file === undefined) continue;
    const bytes = readFileSync(join(step.folder, file));
    const fileSha256 = sha256(bytes);
    const merged = mergedTurnsOf(target);
    const entries = target.logs.flatMap((log) =>
      entriesOfLogText(log.text, writer.agendaItemsOfMeeting(target.meetingId)),
    );
    const attachedTo = sha256(
      JSON.stringify([ATTACHMENT_VERSION, target.logs.map((log) => log.documentId), merged, entries]),
    );
    const known = stored.get(`${target.meetingId}\u0000${target.eventId}`);
    if (known?.fileSha256 === fileSha256 && known.attachedTo === attachedTo) continue;
    const [firstTurn] = merged;
    if (firstTurn === undefined) {
      // No turn, so no player link of the log's own to build from: nothing is guessed.
      run.refused.push({
        file,
        reason: "no_turns",
        message: `${file}: the Meeting's Recording Log has an event ID and no speaker turn, so a player link for the transcript cannot be built from the log's own`,
      });
      continue;
    }
    const read = readTranscript({
      file,
      text: bytes.toString("utf8"),
      eventId: target.eventId,
      turns: merged,
      entries,
    });
    if (read.kind === "refused") {
      run.refused.push({ file, reason: read.reason, message: read.message });
      continue;
    }
    const firstLog = target.logs[0]?.documentId;
    if (firstLog === undefined) continue;
    const playerAt = (second: number): string => {
      const link = playerLinkOf([{ page: 1, url: firstTurn.playerLink, rect: [0, 0, 0, 0] }], target.eventId, second);
      if (link === null) throw new Error(`The player link of ${firstTurn.documentId} names no event ${target.eventId}`);
      return link;
    };
    const agendaEntries = entries
      .filter((entry) => entry.kind === "agenda-item")
      .toSorted((a, b) => a.offsetSeconds - b.offsetSeconds);
    const passages: TranscriptPassage[] = read.passages.flatMap((attached) => {
      const speaker = attached.speaker;
      let who: StoredPassageSpeaker;
      let documentId: DocumentId = firstLog;
      let filing: { agendaItem: string | null; measureId: MeasureId | null };
      switch (speaker.kind) {
        case "turn":
          who = { kind: "turn", position: speaker.turn.position };
          documentId = speaker.turn.documentId;
          filing = { agendaItem: speaker.turn.agendaItem, measureId: speaker.turn.measureId };
          break;
        case "entry":
          who = { kind: "procedural", entry: speaker.entry.kind };
          filing = agendaIn(agendaEntries, attached.startSeconds, session, held);
          break;
        case "not_given":
          who = { kind: "not_given", reason: speaker.reason ?? null };
          filing = agendaIn(agendaEntries, attached.startSeconds, session, held);
          break;
        default:
          return speaker satisfies never;
      }
      return cutToSize(attached, embedder).map((piece) => ({
        startSeconds: piece.startSeconds,
        endSeconds: piece.endSeconds,
        text: piece.text,
        hash: sha256(piece.text),
        documentId,
        speaker: who,
        agendaItem: filing.agendaItem,
        measureId: filing.measureId,
        playerLink: playerAt(Math.floor(piece.startSeconds)),
      }));
    });
    const embedding = await newVectors(writer, embedder, passages);
    const drift = read.drift;
    writer.storeTranscript({
      meetingId: target.meetingId,
      eventId: target.eventId,
      file,
      fileSha256,
      attachedTo,
      audioSha256: read.audio.sha256,
      durationSeconds: read.audio.durationSeconds,
      modelId: read.model.id,
      madeAt: read.madeAt,
      drift: {
        medianSeconds: drift?.medianSeconds ?? null,
        maxSeconds: drift?.maxSeconds ?? null,
        flaggedTurns: drift?.flagged.length ?? 0,
        meetingFlagged: drift?.meetingFlagged ?? false,
      },
      passages,
      vectors: embedding.vectors,
    });
    run.ingested.push({
      meeting_id: target.meetingId,
      event_id: target.eventId,
      file,
      passages: passages.length,
      embedded: embedding.embedded,
      reused: embedding.reused,
    });
  }
  run.refused.sort((a, b) => a.file.localeCompare(b.file));
  return run;
}

/** The turns of every log of the recording, each with the log it is of; the read orders them by their second. */
function mergedTurnsOf(target: TranscriptTarget): MergedTurn[] {
  return target.logs.flatMap((log) => log.turns.map((turn): MergedTurn => ({ ...turn, documentId: log.documentId })));
}

/** The Agenda item in force at a second: the latest Agenda item line at or before it, and its Measure when the index holds it. */
function agendaIn(
  agendaEntries: readonly RecordingLogEntry[],
  second: number,
  session: SessionKey,
  held: ReadonlySet<MeasureId>,
): { agendaItem: string | null; measureId: MeasureId | null } {
  const inForce = agendaEntries.filter((entry) => entry.offsetSeconds <= second).at(-1);
  return inForce === undefined || !("text" in inForce)
    ? { agendaItem: null, measureId: null }
    : agendaOf(inForce.text, session, held);
}

/** What the build report says of the folder: this run's part, with the stored transcripts' count and drift flags. */
export function transcriptsReportOf(run: TranscriptsRun, notes: TranscriptNotes): TranscriptsReport {
  return {
    ...run,
    stored: notes.stored,
    drift_flags: notes.driftFlags.map((flag) => ({
      meeting_id: flag.meetingId,
      event_id: flag.eventId,
      file: flag.file,
      median_seconds: flag.medianSeconds,
      max_seconds: flag.maxSeconds,
      flagged_turns: flag.flaggedTurns,
      meeting_flagged: flag.meetingFlagged,
    })),
  };
}
