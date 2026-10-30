// The ingest worker's side of the database. The server has no way to reach this file's functions:
// it imports reader.ts only.
import type { Measure, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { Legislator, LegislatorId, SponsorLevel } from "#/packages/domain/legislators.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openWriteConnection } from "./lib/connection.ts";

type SponsorRecordFields = {
  id: number;
  measure: MeasureKey;
  level: SponsorLevel;
  printOrder: number;
};

/**
 * One MeasureSponsors row of the feed. A Member row carries the Legislator its code resolved to, if
 * any; a Committee row names a committee and a Presession row carries a message, and neither names a
 * Legislator.
 */
export type SponsorRecord =
  | (SponsorRecordFields & { kind: "member"; legislatorCode: string; legislatorId: LegislatorId | null })
  | (SponsorRecordFields & { kind: "committee"; committeeCode: string })
  | (SponsorRecordFields & { kind: "presession"; message: string });

/** The people a full pull read: the Legislators the resolver can name, and the sponsor rows of the Measures. */
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
        `INSERT INTO sponsor (session_key, sponsor_id, prefix, number, kind, level, print_order,
                              legislator_code, legislator_id, committee_code, presession_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, sponsor_id) DO UPDATE SET
           prefix = excluded.prefix, number = excluded.number, kind = excluded.kind, level = excluded.level,
           print_order = excluded.print_order, legislator_code = excluded.legislator_code,
           legislator_id = excluded.legislator_id, committee_code = excluded.committee_code,
           presession_message = excluded.presession_message`,
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
            sponsor.kind,
            sponsor.level,
            sponsor.printOrder,
            sponsor.kind === "member" ? sponsor.legislatorCode : null,
            sponsor.kind === "member" ? sponsor.legislatorId : null,
            sponsor.kind === "committee" ? sponsor.committeeCode : null,
            sponsor.kind === "presession" ? sponsor.message : null,
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
