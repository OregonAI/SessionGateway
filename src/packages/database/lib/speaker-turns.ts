// The speaker-turn index of a Recording Log as the store keeps it (ticket #126, ADR-0052, schema step 2): one row for the
// log with what reading it came to, and a row for each turn. The writer stores it and the reader reads it back, so the
// two forms are written once, here.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { DocumentId } from "#/packages/domain/documents.ts";
import type { MeasureId } from "#/packages/domain/index.ts";
import type { LegislatorId } from "#/packages/domain/legislators.ts";
import type { SpeakerTurn, SpeakerTurnIndexOutcome } from "#/packages/domain/speaker-turns.ts";

/** The text that tells the three outcomes apart in `speaker_turn_index.outcome`. */
const outcomes = ["indexed", "no_event_id", "conflicting_event_ids"] as const;

/** Replaces the log's index with this outcome, in one transaction: the turns of an earlier reading are never mixed with these. */
export function storeSpeakerTurnIndex(database: DatabaseSync, documentId: DocumentId, outcome: SpeakerTurnIndexOutcome): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM speaker_turn WHERE document_id = ?").run(documentId);
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
const texts = z.array(z.string());

/** The index a log has, its turns in media-clock order (then in the order of the log), or undefined when none is stored. */
export function readSpeakerTurnIndex(database: DatabaseSync, documentId: DocumentId): SpeakerTurnIndexOutcome | undefined {
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
      if (row.event_id === null) throw new Error(`The speaker-turn index of ${documentId} is stored with no event ID`);
      const turns = database
        .prepare(
          `SELECT t.timecode, t.offset_seconds, t.offset_source, t.speaker, t.legislator_code, t.legislator_id,
                  l.name AS legislator_name, t.agenda_item, t.measure_id, t.player_link
           FROM speaker_turn t
             LEFT JOIN legislator l ON l.id = t.legislator_id
           WHERE t.document_id = ? ORDER BY t.offset_seconds, t.position`,
        )
        .all(documentId)
        .map((stored): SpeakerTurn => {
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
        });
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
