// The speaker-turn index of a Recording Log (ticket #126, ADR-0052): what the worker keeps of the log's turns and what the
// reader hands out. The parser's own types are the recording-log package's; these are the stored form, with the
// Legislator and the Measure resolved and the player link built.
import type { MeasureId } from "./index.ts";
import type { Legislator } from "./legislators.ts";

/** One speaker turn of a Recording Log as stored. A turn whose speaker is not resolved keeps its text. */
export type SpeakerTurn = {
  /** The timecode as logged, "00:02:49". */
  timecode: string;
  /** The turn's second on the media clock: from the log's link, or from the timecode (`offsetSource`). */
  offsetSeconds: number;
  offsetSource: "link" | "timecode";
  /** The speaker as logged: a name and title. */
  speaker: string;
  /** The Legislator Code of the Legislator the speaker line names (a committee member, else one of the Session's), or null when it names none that resolves. */
  legislatorCode: string | null;
  /** The Legislator that code names. The store keeps the id and the reader joins the name from the Legislators it holds. */
  legislator: Legislator | null;
  /** The text of the most recent Agenda item line before the turn in the log, or null before the first. */
  agendaItem: string | null;
  /** The Measure that Agenda item line begins with, when the index holds that Measure, or null (the Agenda item's text is kept either way). */
  measureId: MeasureId | null;
  /** The official player at the turn's second, built from the log's own player link. */
  playerLink: string;
};

/** What reading a Recording Log's links and text came to. */
export type SpeakerTurnIndexOutcome =
  | {
      kind: "indexed";
      eventId: string;
      /** The pages (from 1) whose offsets are the timecodes because their links could not be matched to their lines. */
      pagesReadByTimecode: number[];
      turns: SpeakerTurn[];
    }
  /** The log has no player link with an event ID: it has no index, and the turns are not guessed. */
  | { kind: "no_event_id" }
  /** The log's links carry more than one event ID. */
  | { kind: "conflicting_event_ids"; eventIds: string[] };

/** What the index says of a Recording Log in the listing of its Meeting. */
export type SpeakerTurnIndexSummary = { eventId: string; turnCount: number };
