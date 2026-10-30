// The ingest worker's side of the database. The server has no way to reach this file's functions:
// it imports reader.ts only.
import type { Measure, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { Legislator, LegislatorId, SponsorLevel } from "#/packages/domain/legislators.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openWriteConnection } from "./lib/connection.ts";

/** One Member sponsor row of the feed, with the Legislator its code resolved to, if any. */
export type SponsorRecord = {
  id: number;
  measure: MeasureKey;
  level: SponsorLevel;
  printOrder: number;
  legislatorCode: string;
  legislatorId: LegislatorId | null;
};

/** The people a full pull read: the Legislators the resolver can name, and the sponsors that name them. */
export type PeopleRecord = {
  legislators: readonly Legislator[];
  sponsors: readonly SponsorRecord[];
};

export type IndexWriter = {
  /** Stores what a full pull read, and when, in one transaction. A full pull never deletes (ADR-0005). */
  recordFullPull(session: SessionKey, measures: readonly Measure[], asOf: Timestamp, people: PeopleRecord): void;
  close(): void;
};

export function openIndexWriter(path: string): IndexWriter {
  const database = openWriteConnection(path);
  return {
    recordFullPull(session, measures, asOf, people) {
      const upsertMeasure = database.prepare(
        `INSERT INTO measure (session_key, prefix, number, catchline, created_at, modified_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, prefix, number) DO UPDATE SET
           catchline = excluded.catchline, created_at = excluded.created_at, modified_at = excluded.modified_at`,
      );
      const upsertLegislator = database.prepare(
        `INSERT INTO legislator (session_key, id, name) VALUES (?, ?, ?)
         ON CONFLICT (session_key, id) DO UPDATE SET name = excluded.name`,
      );
      const upsertSponsor = database.prepare(
        `INSERT INTO sponsor (session_key, sponsor_id, prefix, number, level, print_order, legislator_code, legislator_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, sponsor_id) DO UPDATE SET
           prefix = excluded.prefix, number = excluded.number, level = excluded.level,
           print_order = excluded.print_order, legislator_code = excluded.legislator_code,
           legislator_id = excluded.legislator_id`,
      );
      const recordAsOf = database.prepare(
        `INSERT INTO index_state (session_key, full_pull_as_of) VALUES (?, ?)
         ON CONFLICT (session_key) DO UPDATE SET full_pull_as_of = excluded.full_pull_as_of`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const measure of measures) {
          upsertMeasure.run(
            measure.session,
            measure.prefix,
            measure.number,
            measure.catchline,
            measure.createdAt,
            measure.modifiedAt,
          );
        }
        for (const legislator of people.legislators) upsertLegislator.run(session, legislator.id, legislator.name);
        for (const sponsor of people.sponsors) {
          upsertSponsor.run(
            session,
            sponsor.id,
            sponsor.measure.prefix,
            sponsor.measure.number,
            sponsor.level,
            sponsor.printOrder,
            sponsor.legislatorCode,
            sponsor.legislatorId,
          );
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
