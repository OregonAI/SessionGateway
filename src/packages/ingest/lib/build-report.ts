import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocumentId } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * What the operator reads after a full pull (spec #1, story 54): the documents that are scans or
 * photographs, whose text is empty, to chase by hand, and the documents this pull could not get.
 */
export type BuildReport = {
  session: SessionKey;
  /** When the pull this report describes began. */
  as_of: Timestamp;
  documents_without_text_layer: { id: DocumentId; source_url: string }[];
  /** Documents the feed links that this pull did not store: the next pull tries them again. */
  documents_not_fetched: { id: DocumentId; source_url: string; reason: string }[];
  /** What this pull made of the passages of the documents it stored (docs/adr/0025). */
  search_index: {
    /** The embedder's model id: the vectors this pull stored are under it. */
    model: string;
    /** Passages of the documents this pull stored. */
    passages: number;
    /** Of those, the passages of agendas, Recording Logs and witness-registration lists, which are never embedded. */
    keyword_only_passages: number;
    /** Passages this pull embedded: text whose vector the index did not hold. */
    embedded: number;
    /** Passages of documents found by meaning that were not embedded, because identical text already had a vector. */
    reused: number;
  };
};

/** The report's file: `build-report.json`, in the directory of the database. */
export function buildReportPath(databasePath: string): string {
  return join(dirname(databasePath), "build-report.json");
}

/** Writes the report whole or not at all, so a reader never sees half of one. */
export function writeBuildReport(path: string, report: BuildReport): void {
  const partial = `${path}.partial`;
  writeFileSync(partial, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(partial, path);
}
