import { z } from "zod";
import type { SpeakerTurnIndexOutcome } from "#/packages/domain/speaker-turns.ts";
import type { PagedTranscript } from "./transcript-parts.ts";
import {
  proceduralOf,
  proceduralOutput,
  speakerKindOutput,
  speakerLabelOf,
  transcriptPassageOutput,
  transcriptPassageShown,
} from "./transcripts.ts";

/** The `speaker_turns` field of `get_document`: present only on a Recording Log whose file the index has read (ticket #126, ADR-0052). */
export const speakerTurnsOutput = z
  .object({
    indexed: z
      .boolean()
      .describe(
        "True when the log has a speaker-turn index. False when the log has no player link with an event ID, or its links name more than one, or it is another Meeting's log: see gap.",
      ),
    event_id: z
      .string()
      .nullable()
      .describe(
        "The Invintus event ID of the meeting's recording, from the log's own player links. Null when the log is not indexed.",
      ),
    gap: z
      .enum(["no_event_id", "conflicting_event_ids", "log_of_another_meeting"])
      .nullable()
      .describe(
        "Why the log is not indexed: its links have no event ID, or more than one, or (log_of_another_meeting) OLIS filed the same file under another Meeting too and the log's own header names that Meeting's committee and time, or neither, and not this one's. Null when it is indexed.",
      ),
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
              "The Legislator Code of the Legislator the line names, as the feed writes it: a member of the meeting's committee, or else the one Legislator of the Session whose chamber, surname and first name or initial the line gives. Null for anyone else (a witness, staff, a line with no title or no unique match): the speaker text is then all there is.",
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
            .describe(
              "The Measure that Agenda item line begins with, when it names one and the index holds that Measure; otherwise null, and agenda_item still says what the log says.",
            ),
          player_link: z
            .string()
            .describe("The Legislature's own player at this turn's second, built from the log's own player link."),
          transcript: z
            .array(transcriptPassageOutput)
            .optional()
            .describe(
              "Present only while the machine transcripts are published, this log has one, and the turn is listed in this part of the text: the words of the machine transcript that fall in this turn and come in this part, in order. The transcript is paged with the text: a turn's words are in the part its lines are in, and a turn with more words than fit continues in the parts after it. get_document with this turn's timecode returns the part that holds its line and its first words. Empty when no words fall in the turn.",
            ),
        }),
      )
      .describe("Every speaker turn of the log in media-clock order: none is dropped, whoever the speaker is."),
    transcript: z
      .object({
        model: z.string().describe("The id of the model that made the transcript."),
        made_at: z.string().describe("When the transcript was made, as an ISO 8601 time with its offset."),
        passage_count: z
          .number()
          .describe(
            "How many passages of the transcript this part carries, in turns and apart. The rest are in the other parts of the text.",
          ),
        other_passages: z
          .array(
            transcriptPassageOutput.extend({
              speaker: z.string().describe('Always "speaker not given": the words are in no speaker turn of this log.'),
              speaker_kind: speakerKindOutput,
              procedural: proceduralOutput,
              agenda_item: z
                .string()
                .nullable()
                .describe(
                  "The log's Agenda item line in force when the words begin, as logged, or null before the first.",
                ),
              measure_id: z
                .string()
                .nullable()
                .describe("The Measure that Agenda item names, when the index holds it; otherwise null."),
            }),
          )
          .describe(
            "The passages of this part that are in no turn of this log, in order: words before the first turn, during a motion, a vote or a roll call, in a recess, or after the meeting adjourned. They come in the part after the passages of the turn they follow in time (the first part before the first turn).",
          ),
      })
      .optional()
      .describe(
        "Present only while the machine transcripts are published and this log has one. A machine transcript of the official recording is not an official record.",
      ),
  })
  .optional()
  .describe(
    "Present only when the document is a Recording Log the index has read: its speaker-turn index. The log's text is above, as published. A stored log whose links have not been read yet (its file could not be fetched again, or came back changed) has none.",
  );

/**
 * The log's speaker-turn index as `get_document` shows it. `transcript` is what the part carries of the log's machine transcript,
 * given only while the publication gate is on (ticket #134, ADR-0055): the caller leaves it out otherwise, and nothing of a
 * transcript is shown.
 */
export function speakerTurnsShown(
  outcome: SpeakerTurnIndexOutcome,
  transcript?: PagedTranscript,
): z.infer<typeof speakerTurnsOutput> {
  switch (outcome.kind) {
    case "indexed": {
      return {
        indexed: true,
        event_id: outcome.eventId,
        gap: null,
        conflicting_event_ids: [],
        turn_count: outcome.turns.length,
        pages_read_by_timecode: outcome.pagesReadByTimecode,
        turns: outcome.turns.map((turn, index) => ({
          timecode: turn.timecode,
          offset_seconds: turn.offsetSeconds,
          offset_source: turn.offsetSource,
          speaker: turn.speaker,
          legislator_code: turn.legislatorCode,
          legislator: turn.legislator,
          agenda_item: turn.agendaItem,
          measure_id: turn.measureId,
          player_link: turn.playerLink,
          ...(transcript?.turns[index] === undefined
            ? {}
            : { transcript: transcript.turns[index].map(transcriptPassageShown) }),
        })),
        ...(transcript === undefined ? {} : { transcript: transcriptShown(transcript) }),
      };
    }
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
    case "log_of_another_meeting":
      return {
        indexed: false,
        event_id: null,
        gap: "log_of_another_meeting",
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

function transcriptShown(
  transcript: PagedTranscript,
): NonNullable<NonNullable<z.infer<typeof speakerTurnsOutput>>["transcript"]> {
  return {
    model: transcript.modelId,
    made_at: transcript.madeAt,
    passage_count: transcript.turns.reduce((n, passages) => n + (passages?.length ?? 0), 0) + transcript.other.length,
    other_passages: transcript.other.map((passage) => ({
      ...transcriptPassageShown(passage),
      speaker: speakerLabelOf(passage.speaker),
      speaker_kind: passage.speaker.kind,
      procedural: proceduralOf(passage.speaker),
      agenda_item: passage.agendaItem,
      measure_id: passage.measureId,
    })),
  };
}
