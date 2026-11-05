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

/**
 * One Agenda item of the Meeting as the OLIS feed gives it (a CommitteeAgendaItems row), with the fields the parser
 * reads. The caller passes the items of the Meeting the log belongs to.
 */
export type FeedAgendaItem = {
  measurePrefix: string | null;
  measureNumber: number | null;
  /** The feed's MeetingType: "Public Hearing", "Work Session", "Informational Meeting". */
  meetingType: string | null;
  /** The feed's Action: "Heard", "Work Session" and the like. */
  action: string | null;
  /** The feed's Comments: the item's title or description, possibly several lines. */
  comments: string | null;
};

export type ParseRecordingLogInput = {
  /** The log's extracted text, as the pdf-text package extracts it: a form feed (U+000C) between pages. */
  text: string;
  /** Every link annotation of the PDF, whatever it points at. */
  links: readonly RecordingLogLink[];
  /**
   * The Meeting's Agenda items from the feed. A log line is an Agenda item when it matches one: the measure id and its
   * action, or the item's text. The text heuristic is the fallback when none are passed or none matches a line.
   */
  agendaItems?: readonly FeedAgendaItem[];
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
  kind: "call-to-order" | "roll-call" | "motion" | "motion-result" | "recess" | "reconvene" | "adjournment";
  /** The line as logged, without its timecode, a wrapped line joined by one space. */
  text: string;
};

/** An Agenda item line of the log, with how it was found. */
export type AgendaItemEntry = Timed & {
  kind: "agenda-item";
  text: string;
  /** "feed": it matched one of the Meeting's Agenda items from the feed. "text": the text heuristic found it. */
  foundBy: "feed" | "text";
};

/**
 * Stage 1 drops the names under a vote line (the ayes, nays and excused): a vote keeps its first line and its tally,
 * and the names are not stored (owner decision Q7, 2026-11-05).
 */
export type VoteEntry = Timed & {
  kind: "vote";
  text: string;
  /** The counts the vote line gives ("VOTE: 7-0-2", "VOTE: 6/0/1"), or null when it gives none in that form. */
  tally: { ayes: number; nays: number; excused: number } | null;
};

/** A line of the log that is not a speaker: an agenda item, a motion, a vote, a recess, the call to order. */
export type RecordingLogEntry = TimedEntry | AgendaItemEntry | VoteEntry;

export type RecordingLogParse =
  | {
      kind: "parsed";
      /** The Invintus event ID in the player links' `eventID` parameter. */
      eventId: string;
      speakerTurns: SpeakerTurn[];
      entries: RecordingLogEntry[];
      /**
       * The pages (1-based, ascending) whose links did not line up with their timecode lines, so their offsets are
       * the timecodes (`offsetSource: "timecode"`). The build report lists them.
       */
      pagesReadByTimecode: number[];
    }
  /** No player link with an `eventID`. */
  | { kind: "no-event-id" }
  /** Player links with more than one `eventID`, in the order they first appear. */
  | { kind: "conflicting-event-ids"; eventIds: string[] };
