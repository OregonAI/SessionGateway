// How the tools show a machine transcript's passages (ticket #134, ADR-0055). The tools show them only while the publication
// gate is on (the server's TRANSCRIPTS_PUBLISHED), and every result that holds one carries the machine-transcript notice, which
// the envelope adds.
import { z } from "zod";
import type { ShownPassageSpeaker, ShownTranscriptPassage } from "#/packages/domain/transcripts.ts";

/** "00:02:49": the whole seconds of a second on the recording's clock, as the Recording Log writes a timecode. */
export function timecodeOfSeconds(seconds: number): string {
  const whole = Math.floor(seconds);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(Math.floor(whole / 3600))}:${two(Math.floor((whole % 3600) / 60))}:${two(whole % 60)}`;
}

/** What a passage says of who spoke when no turn is its: "speaker not given", which the transcript read calls it. */
export const SPEAKER_NOT_GIVEN = "speaker not given";

/** The speaker of a passage as a person reads it: the turn's speaker as logged, else "speaker not given". */
export function speakerLabelOf(speaker: ShownPassageSpeaker): string {
  return speaker.kind === "turn" ? speaker.turn.speaker : SPEAKER_NOT_GIVEN;
}

/**
 * Why a passage has no turn: the kind of the log's own line the words fall in (`motion`, `motion-result`, `vote`,
 * `roll-call`), or the reason the log gives no one (`during_recess`, `after_adjournment`), or null (before the first moment of
 * the log, or after the committee reconvened and before anyone spoke).
 */
export function proceduralOf(speaker: ShownPassageSpeaker): string | null {
  switch (speaker.kind) {
    case "turn":
      return null;
    case "procedural":
      return speaker.entry;
    case "not_given":
      return speaker.reason;
    default:
      return speaker satisfies never;
  }
}

export const speakerKindOutput = z
  .enum(["turn", "procedural", "not_given"])
  .describe(
    "Whose words these are: a speaker turn of the Recording Log (turn); the log's own line, a motion, its result, a vote or a roll call (procedural), whose words the log gives no speaker for; or no one the log names (not_given).",
  );

export const proceduralOutput = z
  .string()
  .nullable()
  .describe(
    "Why no speaker is given: motion, motion-result, vote or roll-call for the words said during that line of the log, during_recess for words in a recess, after_adjournment for words after the meeting adjourned; null for a turn, and for words before the log's first line or after the committee reconvened and before anyone spoke.",
  );

/** One passage of a transcript, as `get_document` shows it under the turn it falls in. */
export const transcriptPassageOutput = z.object({
  text: z
    .string()
    .describe(
      "The words of the machine transcript, as the model wrote them: not an official record, and the model may have heard them wrongly.",
    ),
  start_seconds: z.number().describe("The second of the recording at which the first word starts."),
  end_seconds: z.number().describe("The second of the recording at which the last word ends."),
  timecode: z.string().describe('The start as a timecode, such as "00:02:49".'),
  player_link: z
    .string()
    .describe(
      "The Legislature's own player at the passage's first whole second, built from the Recording Log's own link.",
    ),
});

export type ShownPassage = z.infer<typeof transcriptPassageOutput>;

export function transcriptPassageShown(passage: ShownTranscriptPassage): ShownPassage {
  return {
    text: passage.text,
    start_seconds: passage.startSeconds,
    end_seconds: passage.endSeconds,
    timecode: timecodeOfSeconds(passage.startSeconds),
    player_link: passage.playerLink,
  };
}
