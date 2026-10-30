// The ingest worker's side of the database. The server has no way to reach this file's functions:
// it imports reader.ts only.
import type { Measure, SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openWriteConnection } from "./lib/connection.ts";

export type IndexWriter = {
  /** Stores what a full pull read, and when, in one transaction. A full pull never deletes (ADR-0005). */
  recordFullPull(session: SessionKey, measures: readonly Measure[], asOf: Timestamp): void;
  close(): void;
};

export function openIndexWriter(path: string): IndexWriter {
  const database = openWriteConnection(path);
  return {
    recordFullPull(session, measures, asOf) {
      const upsertMeasure = database.prepare(
        `INSERT INTO measure (session_key, prefix, number, catchline) VALUES (?, ?, ?, ?)
         ON CONFLICT (session_key, prefix, number) DO UPDATE SET catchline = excluded.catchline`,
      );
      const recordAsOf = database.prepare(
        `INSERT INTO index_state (session_key, full_pull_as_of) VALUES (?, ?)
         ON CONFLICT (session_key) DO UPDATE SET full_pull_as_of = excluded.full_pull_as_of`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const measure of measures) {
          upsertMeasure.run(measure.session, measure.prefix, measure.number, measure.catchline);
        }
        recordAsOf.run(session, asOf);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      database.close();
    },
  };
}
