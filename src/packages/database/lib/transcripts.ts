// A Meeting's machine transcript as the store keeps it (ticket #134, ADR-0055, schema step 4): the worker's writes and the
// readers' reads, so that the two forms are written once, here. A passage is not a slice of a document, so it has a table and a
// keyword entry of its own; its vector is a row of `passage_vector` under the hash of its text, as any passage's is.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { DocumentId, MeetingId } from "#/packages/domain/documents.ts";
import type { MeasureId, SessionKey } from "#/packages/domain/index.ts";
import type {
  NotGivenReason,
  PassageQuality,
  ShownPassageSpeaker,
  ShownTranscriptPassage,
  StoredTranscriptKey,
  StoredTranscriptWords,
  TranscriptNotes,
  TranscriptOfLog,
  TranscriptPassage,
  TranscriptRecord,
  TranscriptTarget,
} from "#/packages/domain/transcripts.ts";
import { readSpeakerTurn, speakerTurnOfRow, turnColumns } from "./speaker-turns.ts";

/**
 * Replaces the transcript of the (Meeting, event ID) with this one, in one transaction: its row, its passages, their keyword
 * entries and the vectors the index lacked, and raises the search generation, so the server loads the vectors again.
 */
export function storeTranscript(database: DatabaseSync, record: TranscriptRecord): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    // Each statement reads its result as BigInt: deleting from the contentless FTS5 table leaves the connection's last rowid
    // beyond what a JavaScript number holds, which `run` would refuse to convert for the next statement (as the writer's
    // `deletePassagesOf` says).
    for (const sql of [
      "DELETE FROM transcript_passage_fts WHERE rowid IN (SELECT id FROM transcript_passage WHERE meeting_id = ?1 AND event_id = ?2)",
      "DELETE FROM transcript_passage WHERE meeting_id = ?1 AND event_id = ?2",
      "DELETE FROM transcript WHERE meeting_id = ?1 AND event_id = ?2",
    ]) {
      const statement = database.prepare(sql);
      statement.setReadBigInts(true);
      statement.run(record.meetingId, record.eventId);
    }
    database
      .prepare(
        `INSERT INTO transcript (meeting_id, event_id, file, file_sha256, attached_to, reader_version, audio_sha256,
           duration_seconds, model_id, made_at, drift_median_seconds, drift_max_seconds, drift_flagged_turns, meeting_flagged)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.meetingId,
        record.eventId,
        record.file,
        record.fileSha256,
        record.attachedTo,
        record.readerVersion,
        record.audioSha256,
        record.durationSeconds,
        record.modelId,
        record.madeAt,
        record.drift.medianSeconds,
        record.drift.maxSeconds,
        record.drift.flaggedTurns,
        record.drift.meetingFlagged ? 1 : 0,
      );
    insertPassages(database, record.meetingId, record.eventId, record.passages, record.vectors);
    database.prepare("UPDATE search_generation SET generation = generation + 1").run();
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

/** The passages of a transcript, their keyword entries and the vectors the index lacked: the part of a store that both ways share. */
function insertPassages(
  database: DatabaseSync,
  meetingId: MeetingId,
  eventId: string,
  passages: readonly TranscriptPassage[],
  vectors: TranscriptRecord["vectors"],
): void {
  const insertPassage = database.prepare(
    `INSERT INTO transcript_passage (meeting_id, event_id, ordinal, document_id, start_seconds, end_seconds, text,
       text_hash, speaker_kind, turn_position, entry_kind, not_given_reason, agenda_item, measure_id, player_link,
       avg_logprob, compression_ratio, no_speech_prob, temperature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertText = database.prepare("INSERT INTO transcript_passage_fts (rowid, text) VALUES (?, ?)");
  passages.forEach((passage, ordinal) => {
    const speaker = passage.speaker;
    const inserted = insertPassage.run(
      meetingId,
      eventId,
      ordinal,
      passage.documentId,
      passage.startSeconds,
      passage.endSeconds,
      passage.text,
      passage.hash,
      speaker.kind,
      speaker.kind === "turn" ? speaker.position : null,
      speaker.kind === "procedural" ? speaker.entry : null,
      speaker.kind === "not_given" ? speaker.reason : null,
      passage.agendaItem,
      passage.measureId,
      passage.playerLink,
      passage.quality.avgLogprob,
      passage.quality.compressionRatio,
      passage.quality.noSpeechProb,
      passage.quality.temperature,
    );
    insertText.run(inserted.lastInsertRowid, passage.text);
  });
  const insertVector = database.prepare(
    "INSERT OR IGNORE INTO passage_vector (text_hash, model_id, vector) VALUES (?, ?, ?)",
  );
  for (const row of vectors.rows) insertVector.run(row.hash, vectors.modelId, row.vector);
}

/**
 * Replaces the passages of a stored transcript with these, keeping the rest of its row (the file, the audio, the drift), and
 * records what they were attached to: what the worker does when the turns changed and the file is no longer there to read
 * again. In one transaction, with the vectors the index lacked, and raises the search generation.
 */
export function reattachTranscript(
  database: DatabaseSync,
  record: Pick<TranscriptRecord, "meetingId" | "eventId" | "attachedTo" | "passages" | "vectors">,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const sql of [
      "DELETE FROM transcript_passage_fts WHERE rowid IN (SELECT id FROM transcript_passage WHERE meeting_id = ?1 AND event_id = ?2)",
      "DELETE FROM transcript_passage WHERE meeting_id = ?1 AND event_id = ?2",
    ]) {
      const statement = database.prepare(sql);
      statement.setReadBigInts(true);
      statement.run(record.meetingId, record.eventId);
    }
    // Read as BigInt like the deletes above: an UPDATE leaves the connection's last rowid where the FTS5 delete left it.
    const mark = database.prepare("UPDATE transcript SET attached_to = ? WHERE meeting_id = ? AND event_id = ?");
    mark.setReadBigInts(true);
    mark.run(record.attachedTo, record.meetingId, record.eventId);
    insertPassages(database, record.meetingId, record.eventId, record.passages, record.vectors);
    const raise = database.prepare("UPDATE search_generation SET generation = generation + 1");
    raise.setReadBigInts(true);
    raise.run();
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

const qualityColumns = z.object({
  avg_logprob: z.number().nullable(),
  compression_ratio: z.number().nullable(),
  no_speech_prob: z.number().nullable(),
  temperature: z.number().nullable(),
});

function qualityOfRow(row: z.infer<typeof qualityColumns>): PassageQuality {
  return {
    avgLogprob: row.avg_logprob,
    compressionRatio: row.compression_ratio,
    noSpeechProb: row.no_speech_prob,
    temperature: row.temperature,
  };
}

const wordsRow = qualityColumns.extend({
  start_seconds: z.number(),
  end_seconds: z.number(),
  text: z.string(),
});

/** The words of the stored transcript of a (Meeting, event ID), in the order they were stored; empty when it has none. */
export function readStoredTranscriptWords(
  database: DatabaseSync,
  meeting: MeetingId,
  eventId: string,
): StoredTranscriptWords[] {
  return database
    .prepare(
      `SELECT start_seconds, end_seconds, text, avg_logprob, compression_ratio, no_speech_prob, temperature
       FROM transcript_passage WHERE meeting_id = ? AND event_id = ? ORDER BY ordinal`,
    )
    .all(meeting, eventId)
    .map((row) => {
      const stored = wordsRow.parse(row);
      return {
        startSeconds: stored.start_seconds,
        endSeconds: stored.end_seconds,
        text: stored.text,
        quality: qualityOfRow(stored),
      };
    });
}

const keyRow = z.object({
  meeting_id: z.string(),
  event_id: z.string(),
  file: z.string(),
  file_sha256: z.string(),
  attached_to: z.string(),
  reader_version: z.number(),
});

/** The transcripts the Session's Meetings have, with the hashes that say whether a file has been read. */
export function readStoredTranscripts(database: DatabaseSync, session: SessionKey): StoredTranscriptKey[] {
  return database
    .prepare(
      `SELECT t.meeting_id, t.event_id, t.file, t.file_sha256, t.attached_to, t.reader_version
       FROM transcript t JOIN meeting m ON m.id = t.meeting_id
       WHERE m.session_key = ? ORDER BY t.meeting_id, t.event_id`,
    )
    .all(session)
    .map((row) => {
      const key = keyRow.parse(row);
      return {
        meetingId: key.meeting_id as MeetingId,
        eventId: key.event_id,
        file: key.file,
        fileSha256: key.file_sha256,
        attachedTo: key.attached_to,
        readerVersion: key.reader_version,
      };
    });
}

const noteRow = z.object({
  meeting_id: z.string(),
  event_id: z.string(),
  file: z.string(),
  drift_median_seconds: z.number().nullable(),
  drift_max_seconds: z.number().nullable(),
  drift_flagged_turns: z.number(),
  meeting_flagged: z.number(),
});

/**
 * What the build report says of the Session's stored transcripts: how many, and those with a flag: the Meeting's, or any turn's
 * (ADR-0054: a single turn over ten seconds is only listed, the Meeting is flagged on its median).
 */
export function readTranscriptNotes(database: DatabaseSync, session: SessionKey): TranscriptNotes {
  const rows = database
    .prepare(
      `SELECT t.meeting_id, t.event_id, t.file, t.drift_median_seconds, t.drift_max_seconds, t.drift_flagged_turns,
              t.meeting_flagged
       FROM transcript t JOIN meeting m ON m.id = t.meeting_id
       WHERE m.session_key = ? ORDER BY t.meeting_id, t.event_id`,
    )
    .all(session)
    .map((row) => noteRow.parse(row));
  return {
    stored: rows.length,
    driftFlags: rows
      .filter((row) => row.meeting_flagged === 1 || row.drift_flagged_turns > 0)
      .map((row) => ({
        meetingId: row.meeting_id as MeetingId,
        eventId: row.event_id,
        file: row.file,
        medianSeconds: row.drift_median_seconds,
        maxSeconds: row.drift_max_seconds,
        flaggedTurns: row.drift_flagged_turns,
        meetingFlagged: row.meeting_flagged === 1,
      })),
  };
}

const targetLogRow = z.object({
  document_id: z.string(),
  text: z.string(),
  event_id: z.string(),
  meeting_id: z.string(),
});
const positionedTurnRow = z.object({ position: z.number() });

/**
 * The Session's Recording Logs that have an index, grouped by the Meeting they belong to and the event ID their links name,
 * each with its text and its turns in the order of the log: what a transcript file is read against. A log that belongs to no
 * Meeting the store holds is no target. Meetings in order, then event IDs, then the logs by id.
 */
export function readTranscriptTargets(database: DatabaseSync, session: SessionKey): TranscriptTarget[] {
  const logs = database
    .prepare(
      `SELECT d.id AS document_id, d.text, i.event_id, md.meeting_id
       FROM document d
         JOIN speaker_turn_index i ON i.document_id = d.id AND i.outcome = 'indexed'
         JOIN meeting_document md ON md.document_id = d.id
       WHERE d.session_key = ? AND d.kind = 'recording_log'
       ORDER BY md.meeting_id, i.event_id, d.id`,
    )
    .all(session)
    .map((row) => targetLogRow.parse(row));
  const turnsOf = database.prepare(
    `SELECT t.position, ${turnColumns}
     FROM speaker_turn t LEFT JOIN legislator l ON l.id = t.legislator_id
     WHERE t.document_id = ? ORDER BY t.position`,
  );
  const targets: TranscriptTarget[] = [];
  for (const log of logs) {
    let target = targets.find((known) => known.meetingId === log.meeting_id && known.eventId === log.event_id);
    if (target === undefined) {
      target = { meetingId: log.meeting_id as MeetingId, eventId: log.event_id, logs: [] };
      targets.push(target);
    }
    target.logs.push({
      documentId: log.document_id as DocumentId,
      text: log.text,
      turns: turnsOf.all(log.document_id).map((row) => ({
        ...speakerTurnOfRow(row),
        position: positionedTurnRow.parse(row).position,
      })),
    });
  }
  return targets;
}

/** Whether the Meeting has a stored transcript. */
export function meetingHasTranscript(database: DatabaseSync, meeting: MeetingId): boolean {
  return (
    database.prepare("SELECT 1 AS present FROM transcript WHERE meeting_id = ? LIMIT 1").get(meeting) !== undefined
  );
}

export const transcriptPassageRow = qualityColumns.extend({
  id: z.number(),
  meeting_id: z.string(),
  document_id: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
  text: z.string(),
  speaker_kind: z.enum(["turn", "procedural", "not_given"]),
  turn_position: z.number().nullable(),
  entry_kind: z.string().nullable(),
  not_given_reason: z.string().nullable(),
  agenda_item: z.string().nullable(),
  measure_id: z.string().nullable(),
  player_link: z.string(),
});
export type TranscriptPassageRow = z.infer<typeof transcriptPassageRow>;

/** What the SELECT of a passage reads. */
export const passageColumns = `tp.id, tp.meeting_id, tp.document_id, tp.start_seconds, tp.end_seconds, tp.text, tp.speaker_kind,
  tp.turn_position, tp.entry_kind, tp.not_given_reason, tp.agenda_item, tp.measure_id, tp.player_link, tp.avg_logprob,
  tp.compression_ratio, tp.no_speech_prob, tp.temperature`;

/** A stored passage as the readers hand it out; the speaker's turn is read from the log it is a turn of. */
export function shownPassageOf(database: DatabaseSync, row: TranscriptPassageRow): ShownTranscriptPassage {
  let speaker: ShownPassageSpeaker;
  switch (row.speaker_kind) {
    case "turn": {
      const turn =
        row.turn_position === null
          ? undefined
          : readSpeakerTurn(database, row.document_id as DocumentId, row.turn_position);
      if (turn === undefined) {
        throw new Error(
          `The transcript passage ${String(row.id)} is of a turn of ${row.document_id} that the index lacks`,
        );
      }
      speaker = { kind: "turn", turn };
      break;
    }
    case "procedural":
      speaker = { kind: "procedural", entry: row.entry_kind ?? "" };
      break;
    case "not_given":
      speaker = { kind: "not_given", reason: row.not_given_reason as NotGivenReason | null };
      break;
    default:
      return row.speaker_kind satisfies never;
  }
  return {
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    text: row.text,
    playerLink: row.player_link,
    agendaItem: row.agenda_item,
    measureId: row.measure_id as MeasureId | null,
    speaker,
    quality: qualityOfRow(row),
  };
}

const logTranscriptRow = z.object({
  meeting_id: z.string(),
  event_id: z.string(),
  model_id: z.string(),
  made_at: z.string(),
});
const positionRow = z.object({ position: z.number() });
const turnStartRow = z.object({ turn_position: z.number(), start_offset: z.number() });

/**
 * The transcript of a Recording Log, or undefined when the log has none: the transcript of the Meeting the log belongs to for
 * the event ID the log's index names. Each of the log's turns, in the order `readSpeakerTurnIndex` gives them, comes with its
 * passages in order, and the log's passages that are no turn's come apart.
 */
export function readTranscriptOfLog(database: DatabaseSync, log: DocumentId): TranscriptOfLog | undefined {
  const found = database
    .prepare(
      `SELECT t.meeting_id, t.event_id, t.model_id, t.made_at
       FROM speaker_turn_index i
         JOIN meeting_document md ON md.document_id = i.document_id
         JOIN transcript t ON t.meeting_id = md.meeting_id AND t.event_id = i.event_id
       WHERE i.document_id = ? AND i.outcome = 'indexed' AND t.attached_to <> ''`,
    )
    .get(log);
  if (found === undefined) return undefined;
  const transcript = logTranscriptRow.parse(found);
  const shown = database
    .prepare(
      `SELECT ${passageColumns} FROM transcript_passage tp
       WHERE tp.document_id = ? AND tp.meeting_id = ? AND tp.event_id = ?
       ORDER BY tp.start_seconds, tp.ordinal`,
    )
    .all(log, transcript.meeting_id, transcript.event_id)
    .map((row) => {
      const stored = transcriptPassageRow.parse(row);
      return { position: stored.turn_position, passage: shownPassageOf(database, stored) };
    });
  const positions = turnPositionsOf(database, log);
  return {
    meetingId: transcript.meeting_id as MeetingId,
    eventId: transcript.event_id,
    modelId: transcript.model_id,
    madeAt: transcript.made_at,
    turns: positions.map((position) =>
      shown.filter((entry) => entry.position === position).map((entry) => entry.passage),
    ),
    other: shown.filter((entry) => entry.position === null).map((entry) => entry.passage),
    turnTextOffsets: readTurnTextOffsets(database, log),
  };
}

/** The positions of a log's turns in the order `readSpeakerTurnIndex` gives them. */
function turnPositionsOf(database: DatabaseSync, log: DocumentId): number[] {
  return database
    .prepare("SELECT position FROM speaker_turn WHERE document_id = ? ORDER BY offset_seconds, position")
    .all(log)
    .map((row) => positionRow.parse(row).position);
}

/**
 * Where each of a Recording Log's turns starts in the log's text (`text.slice(offset)`), in the order `readSpeakerTurnIndex` gives
 * the turns: the start of the passage the worker cut around the turn (ADR-0053), or null for a turn it could not place. It reads
 * the speaker-turn index and the log's own passages, and nothing of a transcript, so it is read whatever the publication gate is.
 */
export function readTurnTextOffsets(database: DatabaseSync, log: DocumentId): (number | null)[] {
  const startsOf = new Map(
    database
      .prepare("SELECT turn_position, start_offset FROM passage WHERE document_id = ? AND turn_position IS NOT NULL")
      .all(log)
      .map((row) => {
        const start = turnStartRow.parse(row);
        return [start.turn_position, start.start_offset] as const;
      }),
  );
  return turnPositionsOf(database, log).map((position) => startsOf.get(position) ?? null);
}
