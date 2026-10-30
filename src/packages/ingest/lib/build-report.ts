import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DocumentId } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * What the operator reads after a full pull (spec #1, story 54): the documents that are scans or
 * photographs, whose text is empty, to chase by hand.
 */
export type BuildReport = {
  session: SessionKey;
  /** When the pull this report describes began. */
  as_of: Timestamp;
  documents_without_text_layer: { id: DocumentId; source_url: string }[];
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
