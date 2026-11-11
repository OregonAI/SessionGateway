// The last fetch failure of a document the index holds no file of (ticket #168, ADR-0063), in `last_fetch_failure`, the table
// schema step 7 makes: one row for each such document, the one of the worker's latest attempt. The writer records it at every
// attempt that leaves the document out and clears it in the transaction that stores the file; the readers read it through the
// clock's view (lib/created-before-clock.ts), so it follows its document's creation.
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { z } from "zod";
import type { AmendmentId, DocumentId, LastFetchFailure } from "#/packages/domain/documents.ts";

/** Keeps what the worker saw at an attempt on the document, replacing whatever an earlier attempt left. */
export function recordFetchFailure(database: DatabaseSync, documentId: DocumentId, failure: LastFetchFailure): void {
  const bytesReceived = failure.cause === "request_failed" ? (failure.bytesReceived ?? null) : null;
  ranWithBigInts(
    database.prepare(
      `INSERT INTO last_fetch_failure (document_id, cause, reason, bytes_received) VALUES (?, ?, ?, ?)
       ON CONFLICT (document_id) DO UPDATE
         SET cause = excluded.cause, reason = excluded.reason, bytes_received = excluded.bytes_received`,
    ),
    documentId,
    failure.cause,
    failure.reason,
    bytesReceived,
  );
}

/** Forgets the document's failure: its file is stored. Run inside the transaction that stores it. */
export function clearFetchFailure(database: DatabaseSync, documentId: DocumentId): void {
  ranWithBigInts(database.prepare("DELETE FROM last_fetch_failure WHERE document_id = ?"), documentId);
}

/**
 * Runs a statement whose result is not read. `run` answers the connection's last inserted rowid, which after the keyword index's
 * inserts can be past what a JavaScript number holds, so it is read as a BigInt, as the writer's other deletes are.
 */
function ranWithBigInts(statement: StatementSync, ...values: SQLInputValue[]): void {
  statement.setReadBigInts(true);
  statement.run(...values);
}

const failureRow = z.object({
  cause: z.enum(["empty_file", "unreadable_file", "request_failed"]),
  reason: z.string(),
  bytes_received: z.number().nullable(),
});

/** The document's last fetch failure, or undefined when none is recorded. */
export function readLastFetchFailure(
  database: DatabaseSync,
  documentId: DocumentId | AmendmentId,
): LastFetchFailure | undefined {
  const row = database
    .prepare("SELECT cause, reason, bytes_received FROM last_fetch_failure WHERE document_id = ?")
    .get(documentId);
  if (row === undefined) return undefined;
  const stored = failureRow.parse(row);
  switch (stored.cause) {
    case "empty_file":
    case "unreadable_file":
      return { cause: stored.cause, reason: stored.reason };
    case "request_failed":
      return stored.bytes_received === null
        ? { cause: stored.cause, reason: stored.reason }
        : { cause: stored.cause, reason: stored.reason, bytesReceived: stored.bytes_received };
    default:
      return stored.cause satisfies never;
  }
}
