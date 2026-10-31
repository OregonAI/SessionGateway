import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocumentId } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * What a full pull made of one entity set it read: the rows the feed counted for it and the rows that came. A set is
 * complete when they are the same. A pull is complete when every set it read is (ADR-0005).
 */
type SetReport = {
  /** The feed's own name for the set: "Measures", "CommitteeMembers"... */
  entity_set: string;
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
  documents_without_text_layer: { id: DocumentId; source_url: string }[];
  /** Documents the feed links that this pull did not store: the next pull tries them again. */
  documents_not_fetched: { id: DocumentId; source_url: string; reason: string }[];
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
