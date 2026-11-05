import { z } from "zod";
import type { SpeakerTurnIndexOutcome } from "#/packages/domain/speaker-turns.ts";

/** The `speaker_turns` field of `get_document`: present only on a Recording Log whose file the index has read (ticket #126, ADR-0052). */
export const speakerTurnsOutput = z
  .object({
    indexed: z
      .boolean()
      .describe("True when the log has a speaker-turn index. False when the log has no player link with an event ID, or its links name more than one: see gap."),
    event_id: z
      .string()
      .nullable()
      .describe("The Invintus event ID of the meeting's recording, from the log's own player links. Null when the log is not indexed."),
    gap: z
      .enum(["no_event_id", "conflicting_event_ids"])
      .nullable()
      .describe("Why the log is not indexed: its links have no event ID, or more than one. Null when it is indexed."),
    conflicting_event_ids: z
      .array(z.string())
      .describe("The event IDs a log with conflicting ones names. Empty otherwise."),
    turn_count: z.number().describe("How many speaker turns the log has."),
    pages_read_by_timecode: z
      .array(z.number())
      .describe(
        "The pages (from 1) whose links could not be matched to their timecode lines. The seconds of the turns on them are the timecodes (offset_source timecode), not the links'.",
      ),
    turns: z
      .array(
        z.object({
          timecode: z.string().describe('The timecode as logged, such as "00:02:49".'),
          offset_seconds: z.number().describe("The turn's second on the recording's clock."),
          offset_source: z
            .enum(["link", "timecode"])
            .describe("Where the second came from: the log's player link on that line, or the timecode itself."),
          speaker: z.string().describe("The speaker as the log writes it: a name and title."),
          legislator_code: z
            .string()
            .nullable()
            .describe(
              "The Legislator Code of the committee member the line names, as the feed writes it. Null for anyone else, a Legislator who is not a member of the committee included: the speaker text is then all there is.",
            ),
          legislator: z
            .object({
              id: z.string().describe("The Legislator's id, the same for every Legislator Code that names them."),
              name: z.string().describe("The Legislator's first and last name."),
            })
            .nullable()
            .describe("The Legislator that code names, or null."),
          agenda_item: z
            .string()
            .nullable()
            .describe("The log's most recent Agenda item line before this turn, as logged, or null before the first."),
          measure_id: z
            .string()
            .nullable()
            .describe("The Measure that Agenda item line begins with, when it names one."),
          player_link: z
            .string()
            .describe("The Legislature's own player at this turn's second, built from the log's own player link."),
        }),
      )
      .describe("Every speaker turn of the log in media-clock order: none is dropped, whoever the speaker is."),
  })
  .optional()
  .describe(
    "Present only when the document is a Recording Log the index has read: its speaker-turn index. The log's text is above, as published.",
  );

export function speakerTurnsShown(outcome: SpeakerTurnIndexOutcome): z.infer<typeof speakerTurnsOutput> {
  switch (outcome.kind) {
    case "indexed":
      return {
        indexed: true,
        event_id: outcome.eventId,
        gap: null,
        conflicting_event_ids: [],
        turn_count: outcome.turns.length,
        pages_read_by_timecode: outcome.pagesReadByTimecode,
        turns: outcome.turns.map((turn) => ({
          timecode: turn.timecode,
          offset_seconds: turn.offsetSeconds,
          offset_source: turn.offsetSource,
          speaker: turn.speaker,
          legislator_code: turn.legislatorCode,
          legislator: turn.legislator,
          agenda_item: turn.agendaItem,
          measure_id: turn.measureId,
          player_link: turn.playerLink,
        })),
      };
    case "no_event_id":
      return {
        indexed: false,
        event_id: null,
        gap: "no_event_id",
        conflicting_event_ids: [],
        turn_count: 0,
        pages_read_by_timecode: [],
        turns: [],
      };
    case "conflicting_event_ids":
      return {
        indexed: false,
        event_id: null,
        gap: "conflicting_event_ids",
        conflicting_event_ids: outcome.eventIds,
        turn_count: 0,
        pages_read_by_timecode: [],
        turns: [],
      };
    default:
      return outcome satisfies never;
  }
}
