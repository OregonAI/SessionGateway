import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocumentId, PulledEntitySet } from "#/packages/domain/documents.ts";
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
  documents_not_fetched: { id: DocumentId; source_url: string; reason: string }[];
  /**
   * The Recording Logs the index holds with no speaker-turn index, because the log has no player link with an event ID or
   * its links name more than one (ticket #126). The log's text is stored and searchable; its turns are not guessed.
   */
  recording_log_gaps: {
    id: DocumentId;
    source_url: string;
    /**
     * `no_event_id` and `conflicting_event_ids`: the log's links say so. `not_read`: the log is stored and its links have not
     * been read, because the file could not be fetched again or came back changed (see `recording_log_refetches`).
     */
    kind: "no_event_id" | "conflicting_event_ids" | "not_read";
    /** The event IDs the links name: empty for a log with none. */
    event_ids: string[];
  }[];
  /**
   * The stored Recording Logs this pull fetched again to read their links, which the store does not keep (ADR-0052): how many,
   * those whose fetch failed, and those whose file is no longer the stored one. A log in either list has no index (it is a
   * `not_read` gap) and is tried again by the next pull. The pull stores no turns from a file that is not the stored one.
   */
  recording_log_refetches: {
    attempted: number;
    failed: { id: DocumentId; source_url: string; reason: string }[];
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
