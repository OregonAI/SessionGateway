// The MCP server's side of the database: read-only.
import { z } from "zod";
import type { Measure, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { LegislatorId, Sponsor } from "#/packages/domain/legislators.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openReadConnection } from "./lib/connection.ts";

export type IndexReader = {
  findMeasure(key: MeasureKey): Measure | undefined;
  /** A Measure's Member sponsors in print order. */
  findSponsors(key: MeasureKey): Sponsor[];
  /** When the last completed full pull started, or undefined if none has completed. */
  asOf(session: SessionKey): Timestamp | undefined;
  close(): void;
};

const measureRow = z.object({
  catchline: z.string().nullable(),
  created_at: z.string(),
  modified_at: z.string().nullable(),
});
const stateRow = z.object({ full_pull_as_of: z.string() });
const sponsorRow = z.object({
  level: z.enum(["chief", "regular"]),
  legislator_code: z.string(),
  legislator_id: z.string().nullable(),
  legislator_name: z.string().nullable(),
});

export function openIndexReader(path: string): IndexReader {
  const database = openReadConnection(path);
  const selectMeasure = database.prepare(
    "SELECT catchline, created_at, modified_at FROM measure WHERE session_key = ? AND prefix = ? AND number = ?",
  );
  const selectSponsors = database.prepare(
    `SELECT sponsor.level, sponsor.legislator_code, sponsor.legislator_id, legislator.name AS legislator_name
     FROM sponsor LEFT JOIN legislator
       ON legislator.session_key = sponsor.session_key AND legislator.id = sponsor.legislator_id
     WHERE sponsor.session_key = ? AND sponsor.prefix = ? AND sponsor.number = ?
     ORDER BY sponsor.print_order, sponsor.sponsor_id`,
  );
  const selectAsOf = database.prepare("SELECT full_pull_as_of FROM index_state WHERE session_key = ?");
  return {
    findMeasure(key) {
      const row = selectMeasure.get(key.session, key.prefix, key.number);
      if (row === undefined) return undefined;
      const stored = measureRow.parse(row);
      return {
        ...key,
        catchline: stored.catchline,
        createdAt: stored.created_at as Timestamp,
        modifiedAt: stored.modified_at as Timestamp | null,
      };
    },
    findSponsors(key) {
      return selectSponsors.all(key.session, key.prefix, key.number).map((row) => {
        const stored = sponsorRow.parse(row);
        return {
          level: stored.level,
          legislatorCode: stored.legislator_code,
          legislator:
            stored.legislator_id === null || stored.legislator_name === null
              ? null
              : { id: stored.legislator_id as LegislatorId, name: stored.legislator_name },
        };
      });
    },
    asOf(session) {
      const row = selectAsOf.get(session);
      return row === undefined ? undefined : (stateRow.parse(row).full_pull_as_of as Timestamp);
    },
    close() {
      database.close();
    },
  };
}
