// The speaker-turn index of a Recording Log as the store keeps it (ticket #126, ADR-0052, schema step 2): one row for the
// log with what reading it came to, and a row for each turn. The writer stores it and the reader reads it back, so the
// two forms are written once, here.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { DocumentId } from "#/packages/domain/documents.ts";
import type { MeasureId } from "#/packages/domain/index.ts";
import type { LegislatorId } from "#/packages/domain/legislators.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import type { Passage } from "#/packages/domain/search.ts";
import type { MeetingId } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { SpeakerTurn, SpeakerTurnIndexOutcome, TurnHearing } from "#/packages/domain/speaker-turns.ts";

/** The text that tells the three outcomes apart in `speaker_turn_index.outcome`. */
const outcomes = ["indexed", "no_event_id", "conflicting_event_ids"] as const;

/** Replaces the log's index with this outcome, in one transaction: the turns of an earlier reading are never mixed with these. */
export function storeSpeakerTurnIndex(
  database: DatabaseSync,
  documentId: DocumentId,
  outcome: SpeakerTurnIndexOutcome,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM speaker_turn WHERE document_id = ?").run(documentId);
    // The log's turns are replaced, so no passage is a turn's any more: the passages stay as slices of the text, and the log is
    // cut around its new turns by the next pull (`recordingLogsWithoutTurnPassages`).
    database.prepare("UPDATE passage SET turn_position = NULL WHERE document_id = ?").run(documentId);
    database
      .prepare(
        `INSERT INTO speaker_turn_index (document_id, outcome, event_id, event_ids, pages_read_by_timecode, turn_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (document_id) DO UPDATE SET outcome = excluded.outcome, event_id = excluded.event_id,
           event_ids = excluded.event_ids, pages_read_by_timecode = excluded.pages_read_by_timecode,
           turn_count = excluded.turn_count`,
      )
      .run(
        documentId,
        outcome.kind,
        outcome.kind === "indexed" ? outcome.eventId : null,
        outcome.kind === "conflicting_event_ids" ? JSON.stringify(outcome.eventIds) : null,
        outcome.kind === "indexed" ? JSON.stringify(outcome.pagesReadByTimecode) : "[]",
        outcome.kind === "indexed" ? outcome.turns.length : 0,
      );
    if (outcome.kind === "indexed") {
      const insert = database.prepare(
        `INSERT INTO speaker_turn (document_id, position, timecode, offset_seconds, offset_source, speaker,
           legislator_code, legislator_id, agenda_item, measure_id, player_link)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      outcome.turns.forEach((turn, position) => {
        insert.run(
          documentId,
          position,
          turn.timecode,
          turn.offsetSeconds,
          turn.offsetSource,
          turn.speaker,
          turn.legislatorCode,
          turn.legislator?.id ?? null,
          turn.agendaItem,
          turn.measureId,
          turn.playerLink,
        );
      });
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

const summaryRow = z.object({ outcome: z.enum(outcomes), event_id: z.string().nullable(), turn_count: z.number() });

/**
 * What the index says of a log without its turns: its event ID and the turn count the worker stored with it, or null when it
 * has no index or is a gap. The listing of a Meeting calls this for each of its logs, so it reads the one row.
 */
export function readSpeakerTurnSummary(
  database: DatabaseSync,
  documentId: DocumentId,
): { eventId: string; turnCount: number } | null {
  const found = database
    .prepare("SELECT outcome, event_id, turn_count FROM speaker_turn_index WHERE document_id = ?")
    .get(documentId);
  if (found === undefined) return null;
  const row = summaryRow.parse(found);
  if (row.outcome !== "indexed") return null;
  if (row.event_id === null) {
    throw new Error(`The speaker-turn index of ${documentId} is stored with no event ID`, { cause: row });
  }
  return { eventId: row.event_id, turnCount: row.turn_count };
}

const indexRow = z.object({
  outcome: z.enum(outcomes),
  event_id: z.string().nullable(),
  event_ids: z.string().nullable(),
  pages_read_by_timecode: z.string(),
});
const turnRow = z.object({
  timecode: z.string(),
  offset_seconds: z.number(),
  offset_source: z.enum(["link", "timecode"]),
  speaker: z.string(),
  legislator_code: z.string().nullable(),
  legislator_id: z.string().nullable(),
  legislator_name: z.string().nullable(),
  agenda_item: z.string().nullable(),
  measure_id: z.string().nullable(),
  player_link: z.string(),
});
const numbers = z.array(z.number());

/** What the SELECT of a turn reads, with the Legislator's name joined from the Legislators the store holds. */
export const turnColumns = `t.timecode, t.offset_seconds, t.offset_source, t.speaker, t.legislator_code, t.legislator_id,
                  l.name AS legislator_name, t.agenda_item, t.measure_id, t.player_link`;

/** A turn as the reader hands it out, from a row of `turnColumns`. */
export function speakerTurnOfRow(stored: unknown): SpeakerTurn {
  const turn = turnRow.parse(stored);
  return {
    timecode: turn.timecode,
    offsetSeconds: turn.offset_seconds,
    offsetSource: turn.offset_source,
    speaker: turn.speaker,
    legislatorCode: turn.legislator_code,
    legislator:
      turn.legislator_id === null || turn.legislator_name === null
        ? null
        : { id: turn.legislator_id as LegislatorId, name: turn.legislator_name },
    agendaItem: turn.agenda_item,
    measureId: turn.measure_id as MeasureId | null,
    playerLink: turn.player_link,
  };
}

/** One turn of a log by its position, or undefined when the log has no such turn. */
export function readSpeakerTurn(
  database: DatabaseSync,
  documentId: DocumentId,
  position: number,
): SpeakerTurn | undefined {
  const found = database
    .prepare(
      `SELECT ${turnColumns}
       FROM speaker_turn t LEFT JOIN legislator l ON l.id = t.legislator_id
       WHERE t.document_id = ? AND t.position = ?`,
    )
    .get(documentId, position);
  return found === undefined ? undefined : speakerTurnOfRow(found);
}
const texts = z.array(z.string());

/** The index a log has, its turns in media-clock order (then in the order of the log), or undefined when none is stored. */
export function readSpeakerTurnIndex(
  database: DatabaseSync,
  documentId: DocumentId,
): SpeakerTurnIndexOutcome | undefined {
  const found = database
    .prepare(
      "SELECT outcome, event_id, event_ids, pages_read_by_timecode FROM speaker_turn_index WHERE document_id = ?",
    )
    .get(documentId);
  if (found === undefined) return undefined;
  const row = indexRow.parse(found);
  switch (row.outcome) {
    case "no_event_id":
      return { kind: "no_event_id" };
    case "conflicting_event_ids":
      return { kind: "conflicting_event_ids", eventIds: texts.parse(JSON.parse(row.event_ids ?? "[]")) };
    case "indexed": {
      if (row.event_id === null) {
        throw new Error(`The speaker-turn index of ${documentId} is stored with no event ID`, { cause: row });
      }
      const turns = database
        .prepare(
          `SELECT ${turnColumns}
           FROM speaker_turn t
             LEFT JOIN legislator l ON l.id = t.legislator_id
           WHERE t.document_id = ? ORDER BY t.offset_seconds, t.position`,
        )
        .all(documentId)
        .map(speakerTurnOfRow);
      return {
        kind: "indexed",
        eventId: row.event_id,
        pagesReadByTimecode: numbers.parse(JSON.parse(row.pages_read_by_timecode)),
        turns,
      };
    }
    default:
      return row.outcome satisfies never;
  }
}

const unlinkedLogRow = z.object({ id: z.string(), text: z.string() });
const storedTurnText = z.object({ timecode: z.string(), speaker: z.string() });

/**
 * The stored Recording Logs of the Session that have an index with turns and no passage that is a turn's (ticket #127): a log
 * stored before step 3, one fetched again to read its links, one whose index was stored again. Each comes with its text and its
 * turns' timecodes and speakers, in the order of the log, which is what the worker cuts the text around: it fetches nothing.
 */
export function readLogsWithoutTurnPassages(
  database: DatabaseSync,
  session: SessionKey,
): { id: DocumentId; text: string; turns: { timecode: string; speaker: string }[] }[] {
  const turnsOf = database.prepare(
    "SELECT timecode, speaker FROM speaker_turn WHERE document_id = ? ORDER BY position",
  );
  return database
    .prepare(
      `SELECT d.id, d.text
       FROM document d
         JOIN speaker_turn_index i ON i.document_id = d.id
       WHERE d.session_key = ? AND d.kind = 'recording_log' AND i.outcome = 'indexed' AND i.turn_count > 0
         AND NOT EXISTS (SELECT 1 FROM passage p WHERE p.document_id = d.id AND p.turn_position IS NOT NULL)
       ORDER BY d.id`,
    )
    .all(session)
    .map((row) => {
      const log = unlinkedLogRow.parse(row);
      return {
        id: log.id as DocumentId,
        text: log.text,
        turns: turnsOf.all(log.id).map((turn) => storedTurnText.parse(turn)),
      };
    });
}

/**
 * Replaces a document's passages with these, in one transaction, in the order given: a passage with a `turn` is that turn's.
 * The document's text is not touched. A Recording Log is Keyword-only, so it has no vectors to move.
 */
export function replacePassagesOf(database: DatabaseSync, documentId: DocumentId, passages: readonly Passage[]): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    // Deleting from the contentless FTS5 table leaves the connection's last rowid beyond what a JavaScript number holds, which
    // `run` would refuse to convert for the next statement: each statement reads its result as BigInt.
    const deleteFor = (sql: string): void => {
      const statement = database.prepare(sql);
      statement.setReadBigInts(true);
      statement.run(documentId);
    };
    deleteFor("DELETE FROM passage_fts WHERE rowid IN (SELECT id FROM passage WHERE document_id = ?)");
    deleteFor("DELETE FROM passage WHERE document_id = ?");
    const insertPassage = database.prepare(
      "INSERT INTO passage (document_id, ordinal, start_offset, end_offset, text_hash, turn_position) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertPassageText = database.prepare("INSERT INTO passage_fts (rowid, text) VALUES (?, ?)");
    passages.forEach((passage, ordinal) => {
      const inserted = insertPassage.run(
        documentId,
        ordinal,
        passage.start,
        passage.end,
        passage.hash,
        passage.turn ?? null,
      );
      insertPassageText.run(inserted.lastInsertRowid, passage.text);
    });
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

const hearingRow = z.object({
  document_id: z.string(),
  event_id: z.string(),
  meeting_id: z.string(),
  committee_code: z.string(),
  at: z.string(),
  agenda_item: z.string(),
});

/**
 * The hearings at which a Measure was taken up (ticket #127): for each Recording Log with an index, and each Agenda item of
 * that log that names the Measure, the Meeting the log belongs to and the first turn under the item on the media clock (then
 * in the order of the log). Earliest Meeting first, then the log, then the item's first turn. A log that belongs to no Meeting
 * the store holds has no hearing here.
 */
export function readTurnHearingsOf(database: DatabaseSync, measure: MeasureId): TurnHearing[] {
  const firstTurns = database
    .prepare(
      `SELECT t.document_id, t.agenda_item, i.event_id, m.id AS meeting_id, m.committee_code, m.at, t.position
       FROM speaker_turn t
         JOIN speaker_turn_index i ON i.document_id = t.document_id AND i.outcome = 'indexed'
         JOIN meeting_document l ON l.document_id = t.document_id
         JOIN meeting m ON m.id = l.meeting_id
       WHERE t.measure_id = ? AND t.agenda_item IS NOT NULL
       ORDER BY m.at, m.committee_code, t.document_id, t.agenda_item, t.offset_seconds, t.position`,
    )
    .all(measure)
    .map((row) => ({ row: z.object({ position: z.number() }).parse(row).position, head: hearingRow.parse(row) }));
  const hearings: TurnHearing[] = [];
  const seen = new Set<string>();
  for (const { row: position, head } of firstTurns) {
    const key = `${head.document_id}\u0000${head.agenda_item}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const firstTurn = readSpeakerTurn(database, head.document_id as DocumentId, position);
    if (firstTurn === undefined) throw new Error(`The speaker turn ${head.document_id} #${String(position)} is gone`);
    hearings.push({
      meeting: head.meeting_id as MeetingId,
      committeeCode: head.committee_code,
      at: head.at as Timestamp,
      recordingLog: head.document_id as DocumentId,
      eventId: head.event_id,
      agendaItem: head.agenda_item,
      firstTurn,
    });
  }
  return hearings;
}
