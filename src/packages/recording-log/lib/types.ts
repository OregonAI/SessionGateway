/**
 * One link annotation of a Recording Log's PDF, as pdf.js's `page.getAnnotations()` gives it, with the page number
 * (1-based, as the pdf-text package numbers pages) added. Only the fields the parser reads.
 */
export type RecordingLogLink = {
  page: number;
  url: string;
  /** pdf.js's `rect`: [x0, y0, x1, y1] in PDF points, y up from the bottom of the page. */
  rect: readonly [number, number, number, number];
};

export type ParseRecordingLogInput = {
  /** The log's extracted text, as the pdf-text package extracts it: a form feed (U+000C) between pages. */
  text: string;
  /** Every link annotation of the PDF, whatever it points at. */
  links: readonly RecordingLogLink[];
};

/** Where a line's offset in seconds came from. */
export type OffsetSource =
  /** The `startStreamAt` of the player link on the line's timecode. */
  | "link"
  /** The timecode itself (hh:mm:ss), because the page's links could not be matched to its timecode lines. */
  | "timecode";

type Timed = {
  /** The timecode as logged, "00:02:49". */
  timecode: string;
  offsetSeconds: number;
  offsetSource: OffsetSource;
};

/** A line of the log that names a speaker. */
export type SpeakerTurn = Timed & {
  /** The speaker as logged: a name and title, with a title that wraps onto a second line joined by one space. */
  speaker: string;
  /** The text of the most recent Agenda item line before this turn in the log, or null before the first. */
  agendaItem: string | null;
};

export type TimedEntry = Timed & {
  kind: "call-to-order" | "agenda-item" | "motion" | "motion-result" | "recess" | "reconvene" | "adjournment";
  /** The line as logged, without its timecode, a wrapped line joined by one space. */
  text: string;
};

export type VoteEntry = Timed & {
  kind: "vote";
  text: string;
  /** The counts the vote line gives ("VOTE: 7-0-2", "VOTE: 6/0/1"), or null when it gives none in that form. */
  tally: { ayes: number; nays: number; excused: number } | null;
};

/** A line of the log that is not a speaker: an agenda item, a motion, a vote, a recess, the call to order. */
export type RecordingLogEntry = TimedEntry | VoteEntry;

export type RecordingLogParse =
  | {
      kind: "parsed";
      /** The Invintus event ID in the player links' `eventID` parameter. */
      eventId: string;
      speakerTurns: SpeakerTurn[];
      entries: RecordingLogEntry[];
    }
  /** No player link with an `eventID`. */
  | { kind: "no-event-id" }
  /** Player links with more than one `eventID`, in the order they first appear. */
  | { kind: "conflicting-event-ids"; eventIds: string[] };
