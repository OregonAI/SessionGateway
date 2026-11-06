// A Meeting's machine transcript as the store keeps it (ticket #134, ADR-0055): what the worker stores from a transcript file
// (the transcript read, ADR-0054, attached each stretch of words to the speaker turn it falls in) and what the readers hand out.
import type { DocumentId, MeetingId } from "./documents.ts";
import type { MeasureId } from "./index.ts";
import type { SpeakerTurn } from "./speaker-turns.ts";

/** Why no speaker is given for words that are in no turn and no entry of the log: the log says nobody of the committee was speaking. */
export type NotGivenReason = "during_recess" | "after_adjournment";

/**
 * Whose words a passage is, as the store keeps it: a turn of a Recording Log (by its position in that log), a procedural entry of
 * the log (a motion, its result, a vote, a roll call: the entry's kind), or no one the log gives.
 */
export type StoredPassageSpeaker =
  | { kind: "turn"; position: number }
  | { kind: "procedural"; entry: string }
  | { kind: "not_given"; reason: NotGivenReason | null };

/** One passage of a transcript to store: an attached run of words, cut to a Passage's size, embedded like Testimony. */
export type TranscriptPassage = {
  startSeconds: number;
  endSeconds: number;
  text: string;
  /** The sha256 of the text, which its vector is kept under (`passage_vector`). */
  hash: string;
  /** The Recording Log the passage is of: its turn's log, else the first log of the Meeting's recording. */
  documentId: DocumentId;
  speaker: StoredPassageSpeaker;
  /** The Agenda item in force at the passage's start: its turn's, else the latest Agenda item line or turn before it. */
  agendaItem: string | null;
  measureId: MeasureId | null;
  /** The official player at the passage's first whole second, built from the log's own player link. */
  playerLink: string;
};

/** How far a transcript's segments are from the log's turns, as the transcript read measured it (ADR-0054). */
export type StoredDrift = {
  medianSeconds: number | null;
  maxSeconds: number | null;
  /** How many turns are more than ten seconds from every segment start. */
  flaggedTurns: number;
  meetingFlagged: boolean;
};

/** What the worker stores of one transcript file of one Meeting. Storing it replaces what the Meeting's recording had. */
export type TranscriptRecord = {
  meetingId: MeetingId;
  eventId: string;
  /** The file's name, for the build report. */
  file: string;
  /** The sha256 of the file's bytes: a file with the same hash is not read again. */
  fileSha256: string;
  /** A hash of the turns and entries the passages were attached to: the passages are attached again when it changes. */
  attachedTo: string;
  audioSha256: string;
  durationSeconds: number;
  modelId: string;
  madeAt: string;
  drift: StoredDrift;
  passages: readonly TranscriptPassage[];
  /** The vectors the index does not hold yet, as `SearchRecord.vectors` has them. */
  vectors: { modelId: string; rows: readonly { hash: string; vector: Int8Array }[] };
};

/** What the worker needs to read a transcript for a Meeting's recording: its logs with their turns, in the order of the log. */
export type TranscriptTarget = {
  meetingId: MeetingId;
  /** The event ID the logs' player links name: one transcript file belongs to it. */
  eventId: string;
  /** The Meeting's Recording Logs that have this event ID and an index with turns, by document id. */
  logs: {
    documentId: DocumentId;
    text: string;
    turns: (SpeakerTurn & { position: number })[];
  }[];
};

/** A transcript the store holds, as far as the worker needs to tell whether a file has been read. */
export type StoredTranscriptKey = { meetingId: MeetingId; eventId: string; fileSha256: string; attachedTo: string };

/** What the build report says of the stored transcripts. */
export type TranscriptNotes = {
  stored: number;
  /** The transcripts whose Meeting was flagged, or some of whose turns were, as measured when they were stored. */
  driftFlags: {
    meetingId: MeetingId;
    eventId: string;
    file: string;
    medianSeconds: number | null;
    maxSeconds: number | null;
    flaggedTurns: number;
    meetingFlagged: boolean;
  }[];
};

/** Whose words a stored passage is, as a reader hands it out: the turn itself, not its position. */
export type ShownPassageSpeaker =
  | { kind: "turn"; turn: SpeakerTurn }
  | { kind: "procedural"; entry: string }
  | { kind: "not_given"; reason: NotGivenReason | null };

/** A transcript passage as the readers hand it out. */
export type ShownTranscriptPassage = {
  startSeconds: number;
  endSeconds: number;
  text: string;
  playerLink: string;
  agendaItem: string | null;
  measureId: MeasureId | null;
  speaker: ShownPassageSpeaker;
};

/**
 * A Recording Log's transcript: the passages of each of its turns, one list for each turn in the order `speakerTurnIndexOf` gives
 * the turns (an empty list for a turn no words fall in), and the passages that are no turn's of this log, in order of their start.
 */
export type TranscriptOfLog = {
  meetingId: MeetingId;
  eventId: string;
  /** The id of the model that made the transcript (the file's `model.id`). */
  modelId: string;
  madeAt: string;
  turns: ShownTranscriptPassage[][];
  other: ShownTranscriptPassage[];
};

/** A transcript passage as search shows it: the passage, and the Recording Log and Meeting it is of. */
export type SearchedTranscriptPassage = ShownTranscriptPassage & { documentId: DocumentId; meetingId: MeetingId };
