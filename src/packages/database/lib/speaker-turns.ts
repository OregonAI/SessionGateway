// The speaker-turn index of a Recording Log as the store keeps it (ticket #126, ADR-0052, schema step 2; ticket #127,
// ADR-0053, schema step 3): one row for the log with what reading it came to, and a row for each turn. The writer stores it and the reader reads it back, so the
// two forms are written once, here.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { DocumentId, StoredLinkAnnotation } from "#/packages/domain/documents.ts";
import { measureIdOf, type MeasureId } from "#/packages/domain/index.ts";
import type { LegislatorId } from "#/packages/domain/legislators.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
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
    // The log's turns are replaced, so no passage is a turn's any more and no Agenda item's Measures are read from them: the
    // passages stay as slices of the text, and the next pull cuts the log around its new turns and reads the items
    // (`recordingLogsWithoutTurnPassages`, `recordingLogsWithoutItemMeasures`; ADR-0053).
    database.prepare("UPDATE passage SET turn_position = NULL WHERE document_id = ?").run(documentId);
    database.prepare("DELETE FROM speaker_turn_item_measure WHERE document_id = ?").run(documentId);
    // A transcript's passages point at turns by their position in the log, which this store may change: the Meeting's
    // transcripts are marked for attaching again (an empty `attached_to`), which the worker does in the same pull from the
    // file or from the stored words, and the readers leave them out until then (ADR-0055). The search generation moves, so the
    // server loads its vectors again without them.
    const marked = database
      .prepare(
        `UPDATE transcript SET attached_to = ''
         WHERE attached_to <> '' AND (
           meeting_id IN (SELECT meeting_id FROM meeting_document WHERE document_id = ?1)
           OR EXISTS (SELECT 1 FROM transcript_passage tp
                      WHERE tp.meeting_id = transcript.meeting_id AND tp.event_id = transcript.event_id
                        AND tp.document_id = ?1))`,
      )
      .run(documentId);
    if (Number(marked.changes) > 0) database.prepare("UPDATE search_generation SET generation = generation + 1").run();
    database
      .prepare(
        `INSERT INTO speaker_turn_index (document_id, outcome, event_id, event_ids, pages_read_by_timecode, turn_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (document_id) DO UPDATE SET outcome = excluded.outcome, event_id = excluded.event_id,
           event_ids = excluded.event_ids, pages_read_by_timecode = excluded.pages_read_by_timecode,
           turn_count = excluded.turn_count, turns_without_passage = NULL, item_measures_read = 0`,
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
 * The stored Recording Logs of the Session that have an index with turns and have not been cut around them (ticket #127,
 * ADR-0053): a log stored before step 3, one fetched again to read its links, one whose index was stored again. A log that was
 * cut is marked (`turns_without_passage`), even when no turn of it was placed, so it is not cut again on every pull. Each comes
 * with its text and its turns' timecodes and speakers, in the order of the log, which is what the worker cuts the text around:
 * it fetches nothing.
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
         AND i.turns_without_passage IS NULL
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

/** Marks a log as cut around its turns, `turnsWithoutPassage` of which have no Passage of their own. */
export function markTurnPassagesCut(database: DatabaseSync, documentId: DocumentId, turnsWithoutPassage: number): void {
  database
    .prepare("UPDATE speaker_turn_index SET turns_without_passage = ? WHERE document_id = ?")
    .run(turnsWithoutPassage, documentId);
}

const itemsOfLogRow = z.object({ agenda_item: z.string() });

/**
 * The stored Recording Logs of the Session with an index whose Agenda items' Measures have not been read (ticket #127,
 * ADR-0053), each with the texts of its Agenda items in the order of the log, each once.
 */
export function readLogsWithoutItemMeasures(
  database: DatabaseSync,
  session: SessionKey,
): { id: DocumentId; agendaItems: string[] }[] {
  const itemsOf = database.prepare(
    `SELECT agenda_item FROM speaker_turn WHERE document_id = ? AND agenda_item IS NOT NULL
     GROUP BY agenda_item ORDER BY MIN(position)`,
  );
  return database
    .prepare(
      `SELECT d.id
       FROM document d
         JOIN speaker_turn_index i ON i.document_id = d.id
       WHERE d.session_key = ? AND d.kind = 'recording_log' AND i.outcome = 'indexed' AND i.item_measures_read = 0
       ORDER BY d.id`,
    )
    .all(session)
    .map((row) => {
      const id = z.object({ id: z.string() }).parse(row).id as DocumentId;
      return { id, agendaItems: itemsOf.all(id).map((item) => itemsOfLogRow.parse(item).agenda_item) };
    });
}

/** Keeps the Measures each Agenda item of a log names, in one transaction, and marks the log's items as read. */
export function storeItemMeasuresOf(
  database: DatabaseSync,
  documentId: DocumentId,
  items: readonly { agendaItem: string; measures: readonly MeasureId[] }[],
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM speaker_turn_item_measure WHERE document_id = ?").run(documentId);
    const insert = database.prepare(
      "INSERT INTO speaker_turn_item_measure (document_id, agenda_item, ordinal, measure_id) VALUES (?, ?, ?, ?)",
    );
    for (const item of items) {
      item.measures.forEach((measure, ordinal) => {
        insert.run(documentId, item.agendaItem, ordinal, measure);
      });
    }
    database.prepare("UPDATE speaker_turn_index SET item_measures_read = 1 WHERE document_id = ?").run(documentId);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

const hearingRow = z.object({
  document_id: z.string(),
  agenda_item: z.string(),
  position: z.number(),
  event_id: z.string(),
  meeting_id: z.string(),
  session_key: z.string(),
  committee_code: z.string(),
  at: z.string(),
});
const heldMeasureRow = z.object({ prefix: z.string(), number: z.number() });
const itemMeasureRow = z.object({ measure_id: z.string() });

/**
 * The hearings at which a Measure was taken up (ticket #127, ADR-0053; owner decision of 2026-11-05): every Agenda item of a
 * Recording Log with an index that names the Measure, with the Meeting the log belongs to, the Measures the item names that
 * the index holds, and the first turn under the item on the media clock (then in the order of the log). Earliest Meeting
 * first, then the committee and the log, and within a log the item whose first turn is earliest in the recording. An item
 * with no turn under it has no first turn and is not here. A log that belongs to no Meeting the store holds has no hearing here.
 */
export function readTurnHearingsOf(database: DatabaseSync, measure: MeasureId): TurnHearing[] {
  const turnsUnderItems = database
    .prepare(
      `SELECT t.document_id, t.agenda_item, t.position, i.event_id, m.id AS meeting_id, m.session_key, m.committee_code, m.at
       FROM speaker_turn_item_measure named
         JOIN speaker_turn t ON t.document_id = named.document_id AND t.agenda_item = named.agenda_item
         JOIN speaker_turn_index i ON i.document_id = t.document_id AND i.outcome = 'indexed'
         JOIN meeting_document l ON l.document_id = t.document_id
         JOIN meeting m ON m.id = l.meeting_id
       WHERE named.measure_id = ?
       ORDER BY m.at, m.committee_code, t.document_id, t.offset_seconds, t.position`,
    )
    .all(measure)
    .map((stored) => hearingRow.parse(stored));
  const namedBy = database.prepare(
    "SELECT measure_id FROM speaker_turn_item_measure WHERE document_id = ? AND agenda_item = ? ORDER BY ordinal",
  );
  const heldIn = new Map<string, Set<string>>();
  const held = (session: string): Set<string> => {
    const known = heldIn.get(session);
    if (known !== undefined) return known;
    const ids = new Set(
      database
        .prepare("SELECT prefix, number FROM measure WHERE session_key = ?")
        .all(session)
        .map((stored) => {
          const { prefix, number } = heldMeasureRow.parse(stored);
          return measureIdOf({ session: session as SessionKey, prefix, number });
        }),
    );
    heldIn.set(session, ids);
    return ids;
  };
  const hearings: TurnHearing[] = [];
  const seen = new Set<string>();
  for (const first of turnsUnderItems) {
    // The rows come by the recording's clock within a log, so the first row of an item is its first turn.
    const key = `${first.document_id}\u0000${first.agenda_item}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const firstTurn = readSpeakerTurn(database, first.document_id as DocumentId, first.position);
    if (firstTurn === undefined) {
      throw new Error(`The speaker turn ${first.document_id} #${String(first.position)} is gone`);
    }
    const heldInSession = held(first.session_key);
    hearings.push({
      meeting: first.meeting_id as MeetingId,
      committeeCode: first.committee_code,
      at: first.at as Timestamp,
      recordingLog: first.document_id as DocumentId,
      eventId: first.event_id,
      agendaItem: first.agenda_item,
      measureIds: namedBy
        .all(first.document_id, first.agenda_item)
        .map((stored) => itemMeasureRow.parse(stored).measure_id)
        .filter((id) => heldInSession.has(id)) as MeasureId[],
      firstTurn,
    });
  }
  return hearings;
}

/**
 * Replaces a log's stored link annotations (ticket #160, ADR-0058) with these, in the order given, in one transaction. They are
 * the file's own and keyed by the document alone, so nothing about the speaker-turn index changes them or is changed by them.
 */
export function storeLinkAnnotations(
  database: DatabaseSync,
  documentId: DocumentId,
  annotations: readonly StoredLinkAnnotation[],
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM recording_log_link_annotation WHERE document_id = ?").run(documentId);
    const insert = database.prepare(
      "INSERT INTO recording_log_link_annotation (document_id, position, page, url) VALUES (?, ?, ?, ?)",
    );
    annotations.forEach((annotation, position) => {
      insert.run(documentId, position, annotation.page, annotation.url);
    });
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

const annotationRow = z.object({ page: z.number(), url: z.string() });

/** A log's stored link annotations in the order the file listed them; empty when none are stored. */
export function readLinkAnnotations(database: DatabaseSync, documentId: DocumentId): StoredLinkAnnotation[] {
  return database
    .prepare("SELECT page, url FROM recording_log_link_annotation WHERE document_id = ? ORDER BY position")
    .all(documentId)
    .map((row) => annotationRow.parse(row));
}
