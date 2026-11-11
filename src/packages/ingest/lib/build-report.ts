import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocumentId, MeetingId, PulledEntitySet } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import type { StatutesAffectedTableReport } from "./statutes-affected-table.ts";

/**
 * What a full pull made of one entity set it read: the rows the feed counted for it and the rows that came. A set is
 * complete when they are the same. A pull is complete when every set it read is (ADR-0005).
 */
export type SetReport = {
  /** The feed's own name for the set: "Measures", "CommitteeMembers"... */
  entity_set: PulledEntitySet;
  /** The feed's count of the set's rows for the Session (`/$count`). */
  counted: number;
  /** The rows the pages held. */
  read: number;
  complete: boolean;
};

/** What a pull that was complete says of a set besides its counts: how many of its rows the index lists and holds without listing. */
type ListedSetReport = SetReport & {
  /** Rows of the set that fewer than two complete pulls in a row have missed. A set that reads the same twice lists all of them. */
  listed: number;
  /** Rows the index still holds that two complete pulls in a row have missed (ADR-0030). They are out of search and still served by id. */
  no_longer_listed: number;
};

/** A Recording Log the index holds with no speaker-turn index, and why (`recording_log_gaps`). */
export type RecordingLogGap =
  | {
      id: DocumentId;
      source_url: string;
      /**
       * `no_event_id` and `conflicting_event_ids`: the log's links say so. `not_read`: the log is stored and its links have not
       * been read, because the file could not be fetched again or came back changed (see `recording_log_refetches`).
       */
      kind: "no_event_id" | "conflicting_event_ids" | "not_read";
      /** The event IDs the links name: empty for a log with none. */
      event_ids: string[];
    }
  | {
      id: DocumentId;
      source_url: string;
      /**
       * OLIS filed the same file (its SHA-256) under another Meeting too, and this log's own header does not name the Meeting it
       * is filed under: its committee and start time are another Meeting's, or no Meeting's (ticket #177). It has no turns and
       * no transcript; the copy whose header names its Meeting, if any, has them.
       */
      kind: "log_of_another_meeting";
      /** Always empty: the log has no index. */
      event_ids: string[];
      /** The Meeting OLIS filed this copy under. */
      meeting_id: MeetingId;
      /** The log's header as printed, its committee lines and its time joined by spaces, or null when it has none. */
      header: string | null;
      /** The other Recording Logs of the same file, each with the Meeting it is filed under, by id. */
      same_file_as: { id: DocumentId; source_url: string; meeting_id: MeetingId }[];
    };

/**
 * What a full pull says of the transcript folder: the files it read this time, the files it refused (unknown version, an event ID
 * that is not the Meeting's, not valid), the files of events no Meeting's log names, and the Meetings whose turns are far from the
 * transcript's segments (as measured when the file was read, so a flag is repeated while the transcript is stored).
 */
export type TranscriptsReport = {
  /** Why the folder could not be listed, or null. */
  folder_error: string | null;
  /** The transcripts the index holds for the Session. */
  stored: number;
  /** The files read by this run and stored, with the passages each made and how many of them it embedded and reused a vector for. */
  ingested: {
    meeting_id: MeetingId;
    event_id: string;
    file: string;
    passages: number;
    embedded: number;
    reused: number;
  }[];
  /**
   * The transcripts this run attached to the Meeting's turns again from the words it had stored, because the turns changed (the
   * Recording Log's index was stored again) and the file could not be read again: it is gone, or the run refused it.
   */
  reattached_from_stored_words: { meeting_id: MeetingId; event_id: string; file: string; passages: number }[];
  /** The files this run read and refused, by file name; what was stored for the Meeting before is kept. */
  refused: { file: string; reason: string; message: string }[];
  /** The Meetings whose Meeting or some turns were flagged: more than ten seconds from the transcript's segment starts (ADR-0054). */
  drift_flags: {
    meeting_id: MeetingId;
    event_id: string;
    file: string;
    median_seconds: number | null;
    max_seconds: number | null;
    flagged_turns: number;
    meeting_flagged: boolean;
  }[];
  /** Files named `<eventId>.transcript.json` whose event ID no Meeting's Recording Log names. */
  unmatched_files: string[];
  /**
   * Every stored transcript whose file is no longer in the folder (or the deployment names no folder), whether or not this run
   * noticed it first: it stays stored and, while the gate is on, served (owner decision 2 of 2026-11-05). The Meeting, the event
   * ID, the file's name and the sha256 it was stored with.
   */
  file_no_longer_in_folder: { meeting_id: MeetingId; event_id: string; file: string; file_sha256: string }[];
};

/**
 * Why a linked document is not in the store (ticket #116). `empty_file` and `unreadable_file` are OLIS's: it answered with
 * a file of zero bytes, or with bytes the extractor cannot read as a PDF, and a later pull may find the same. `request_failed`
 * is an unanswered request (a timeout, an outage) or a status that is not a file (a 404): nothing is known of the file.
 */
export type NotFetchedCause = "empty_file" | "unreadable_file" | "request_failed";

/**
 * One document a pull did not store, and why. A `request_failed` entry has `bytes_received` when an attempt's file began
 * to arrive and stopped (a stall, or the overall cap; ticket #167): the most bytes any attempt received. It is absent
 * when no attempt got any of the file (no answer, or a status that is not a file).
 */
export type NotFetchedEntry = { id: DocumentId; source_url: string; reason: string } & (
  { cause: Exclude<NotFetchedCause, "request_failed"> } | { cause: "request_failed"; bytes_received?: number }
);

/** What the operator reads after a full pull (spec #1, story 54): the documents that are scans or photographs, whose text is empty, to chase by hand, and the documents this pull could not get. */
export type BuildReport = {
  session: SessionKey;
  /** When the pull this report describes began. */
  as_of: Timestamp;
  /** Every set the pull read, with its counts. The pull is complete, since a pull that is not is refused and has a `RefusedPullReport`. */
  pull: { complete: true; entity_sets: ListedSetReport[] };
  /**
   * The CommitteeMembers rows the index holds, for each committee that has any (ADR-0030). It is read from the table,
   * not from the pull: rows that share the set's declared key are all kept, so each appears here by its code.
   */
  committee_members: {
    committee_code: string;
    /** How many rows the table holds for the committee. */
    rows_stored: number;
    /** The Legislator Code of each row as the feed wrote it, in the order of the codes. */
    legislator_codes: string[];
    /** Of those, the codes that name no Legislators row: a task force's members are not all Legislators, and it is no error. */
    unresolved_legislator_codes: string[];
  }[];
  documents_without_text_layer: { id: DocumentId; source_url: string }[];
  /** Documents the feed links that this pull did not store: the next pull tries them again. */
  documents_not_fetched: NotFetchedEntry[];
  /**
   * The Recording Logs the index holds with no speaker-turn index, because the log has no player link with an event ID or
   * its links name more than one (ticket #126), or because it is a copy of another Meeting's log (ticket #177). The log's text
   * is stored and searchable; its turns are not guessed.
   */
  recording_log_gaps: RecordingLogGap[];
  /**
   * The stored Recording Logs this pull fetched again to read their links, which the store keeps only as the speaker-turn
   * index and the link annotations (ADR-0052, ADR-0058): how many, those whose fetch failed, and those whose file is no longer
   * the stored one. A log in either list is tried again by the next pull (one with no index is also a `not_read` gap). The pull stores no turns from a file that is not the stored one.
   */
  recording_log_refetches: {
    attempted: number;
    /** Each with why, as in `documents_not_fetched` (ticket #179). */
    failed: NotFetchedEntry[];
    bytes_changed: {
      id: DocumentId;
      source_url: string;
      /** The hash of the file the stored text was made from. */
      stored_content_hash: string;
      /** The hash of the file fetched now. */
      fetched_content_hash: string;
    }[];
  };
  /** The Recording Logs some of whose pages have no links that match their timecode lines, so those turns' seconds are the timecodes. */
  recording_log_pages_read_by_timecode: { id: DocumentId; source_url: string; pages: number[] }[];
  /**
   * The Recording Logs some of whose speaker turns have no Passage of their own, and how many (ticket #127, ADR-0053): a turn
   * the log's text does not hold as the index has it, or whose lines are longer than a Passage may be (510 tokens). Its lines
   * are part of the text between the turns, so a search still finds the words, but not as that turn: the Hit has no turn.
   */
  recording_log_turns_without_passage: { id: DocumentId; source_url: string; turns: number }[];
  /**
   * What the worker did about the folder of transcript files (ticket #134, ADR-0055). Left out while the deployment names no
   * folder and holds no transcript, so a report of a deployment without transcripts is as it was.
   */
  transcripts?: TranscriptsReport;
  /** What this pull made of the passages of the documents it stored, or refiled as embeddable (ADR-0025). */
  search_index: {
    /** The embedder's model id: the vectors this pull stored are under it. */
    model: string;
    /** Passages of the documents this pull stored, and of those it refiled from keyword-only to embeddable. */
    passages: number;
    /** Of those, the passages of agendas, Recording Logs and witness-registration lists, which are never embedded. */
    keyword_only_passages: number;
    /** Passages this pull embedded: text whose vector the index did not hold. */
    embedded: number;
    /** Passages of documents found by meaning that were not embedded, because identical text already had a vector. */
    reused: number;
  };
  /**
   * What this pull did about the Statutes Affected Table (ADR-0034). Left out while the deployment does not name the
   * table, so a report of a deployment without it is as it was.
   */
  statutes_affected_table?: StatutesAffectedTableReport;
};

/**
 * What the operator reads after a pull that was refused for being short of the feed's counts: the sets with their
 * counts, the short ones with `complete: false`. Nothing was stored, so the index is as the last complete pull
 * left it, and this report replaces that pull's: the next complete pull writes the lists again.
 */
export type RefusedPullReport = {
  session: SessionKey;
  /** When the refused pull began. The index is not as of this time (the index's as-of time is the last complete pull's). */
  attempted_at: Timestamp;
  pull: { complete: false; entity_sets: SetReport[] };
};

/** The report's file: `build-report.json`, in the directory of the database. */
export function buildReportPath(databasePath: string): string {
  return join(dirname(databasePath), "build-report.json");
}

/** Writes the report whole or not at all, so a reader never sees half of one. */
export function writeBuildReport(path: string, report: BuildReport | RefusedPullReport): void {
  const partial = `${path}.partial`;
  writeFileSync(partial, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(partial, path);
}
