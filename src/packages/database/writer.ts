// The ingest worker's side of the database. The server has no way to reach this file's functions:
// it imports reader.ts only.
import type { HistoryAction, Measure, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import type { Legislator, LegislatorId, SponsorLevel } from "#/packages/domain/legislators.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";
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

/** A Legislator Code and the id of the Legislator it names. */
export type LegislatorCodeRecord = { code: string; legislatorId: LegislatorId };

/** What the worker stores of a floor vote entry: the entry and the Legislator its code resolved to, if any. */
export type FloorVoteRecord = FloorVoteEntry & { legislatorId: LegislatorId | null };

/** What the worker stores of a committee vote entry: the entry and the Legislator its code resolved to, if any. */
export type CommitteeVoteRecord = CommitteeVoteEntry & { legislatorId: LegislatorId | null };

/**
 * Everything a full pull read, ready to store: one field for each kind of row. A ticket that makes the
 * pull read another kind of row adds a field here, not a parameter to `recordFullPull`.
 */
export type FullPullRecord = {
  measures: readonly Measure[];
  history: readonly HistoryAction[];
  /** The Legislators the resolver can name. */
  legislators: readonly Legislator[];
  /** Every Legislator Code the resolver can resolve, with the id of the Legislator it names (the live lookup resolves codes OLIS sends later). */
  legislatorCodes: readonly LegislatorCodeRecord[];
  /** The MeasureSponsors rows, with the Legislator each Member row's code resolved to. */
  sponsors: readonly SponsorRecord[];
  floorVotes: readonly FloorVoteRecord[];
  committeeVotes: readonly CommitteeVoteRecord[];
};

/** The columns of the sponsor table that only some kinds of row fill; the others stay NULL. */
function kindColumnsOf(sponsor: SponsorRecord): {
  legislatorCode: string | null;
  legislatorId: string | null;
  committeeCode: string | null;
  message: string | null;
} {
  const none = { legislatorCode: null, legislatorId: null, committeeCode: null, message: null };
  switch (sponsor.kind) {
    case "member":
      return { ...none, legislatorCode: sponsor.legislatorCode, legislatorId: sponsor.legislatorId };
    case "committee":
      return { ...none, committeeCode: sponsor.committeeCode };
    case "presession":
      return { ...none, message: sponsor.message };
    default:
      return sponsor satisfies never;
  }
}

export type IndexWriter = {
  /** Stores what a full pull read, and when, in one transaction. A full pull never deletes (ADR-0005). */
  recordFullPull(session: SessionKey, asOf: Timestamp, pulled: FullPullRecord): void;
  close(): void;
};

export function openIndexWriter(path: string): IndexWriter {
  const database = openWriteConnection(path);
  return {
    recordFullPull(session, asOf, pulled) {
      const upsertMeasure = database.prepare(
        `INSERT INTO measure (session_key, prefix, number, catchline, location, committee_code, created_at, modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, prefix, number) DO UPDATE SET
           catchline = excluded.catchline, location = excluded.location, committee_code = excluded.committee_code,
           created_at = excluded.created_at, modified_at = excluded.modified_at`,
      );
      const upsertLegislator = database.prepare(
        `INSERT INTO legislator (session_key, id, name) VALUES (?, ?, ?)
         ON CONFLICT (session_key, id) DO UPDATE SET name = excluded.name`,
      );
      const upsertLegislatorCode = database.prepare(
        `INSERT INTO legislator_code (session_key, code, legislator_id) VALUES (?, ?, ?)
         ON CONFLICT (session_key, code) DO UPDATE SET legislator_id = excluded.legislator_id`,
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
      const upsertFloorVote = database.prepare(
        `INSERT INTO floor_vote (session_key, vote_id, history_id, prefix, number, chamber, action_date, action_text,
                                 legislator_code, legislator_id, vote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, vote_id) DO UPDATE SET
           history_id = excluded.history_id, prefix = excluded.prefix, number = excluded.number,
           chamber = excluded.chamber, action_date = excluded.action_date, action_text = excluded.action_text,
           legislator_code = excluded.legislator_code, legislator_id = excluded.legislator_id, vote = excluded.vote`,
      );
      const upsertCommitteeVote = database.prepare(
        `INSERT INTO committee_vote (session_key, vote_id, report_id, prefix, number, committee_code, meeting_date,
                                     legislator_code, legislator_id, vote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, vote_id) DO UPDATE SET
           report_id = excluded.report_id, prefix = excluded.prefix, number = excluded.number,
           committee_code = excluded.committee_code, meeting_date = excluded.meeting_date,
           legislator_code = excluded.legislator_code, legislator_id = excluded.legislator_id, vote = excluded.vote`,
      );
      const upsertHistory = database.prepare(
        `INSERT INTO history_action (session_key, history_id, prefix, number, chamber, action_date, action_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_key, history_id) DO UPDATE SET
           prefix = excluded.prefix, number = excluded.number, chamber = excluded.chamber,
           action_date = excluded.action_date, action_text = excluded.action_text`,
      );
      const recordAsOf = database.prepare(
        `INSERT INTO index_state (session_key, full_pull_as_of) VALUES (?, ?)
         ON CONFLICT (session_key) DO UPDATE SET full_pull_as_of = excluded.full_pull_as_of`,
      );
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const measure of pulled.measures) {
          upsertMeasure.run(
            measure.session,
            measure.prefix,
            measure.number,
            measure.catchline,
            measure.location.current,
            measure.location.committeeCode,
            measure.createdAt,
            measure.modifiedAt,
          );
        }
        for (const legislator of pulled.legislators) upsertLegislator.run(session, legislator.id, legislator.name);
        for (const record of pulled.legislatorCodes)
          upsertLegislatorCode.run(session, record.code, record.legislatorId);
        for (const sponsor of pulled.sponsors) {
          const columns = kindColumnsOf(sponsor);
          upsertSponsor.run(
            session,
            sponsor.id,
            sponsor.measure.prefix,
            sponsor.measure.number,
            sponsor.kind,
            sponsor.level,
            sponsor.printOrder,
            columns.legislatorCode,
            columns.legislatorId,
            columns.committeeCode,
            columns.message,
          );
        }
        for (const entry of pulled.floorVotes) {
          upsertFloorVote.run(
            session,
            entry.id,
            entry.historyId,
            entry.measure.prefix,
            entry.measure.number,
            entry.chamber,
            entry.date,
            entry.action,
            entry.legislatorCode,
            entry.legislatorId,
            entry.vote,
          );
        }
        for (const entry of pulled.committeeVotes) {
          upsertCommitteeVote.run(
            session,
            entry.id,
            entry.reportId,
            entry.measure.prefix,
            entry.measure.number,
            entry.committeeCode,
            entry.meetingDate,
            entry.legislatorCode,
            entry.legislatorId,
            entry.vote,
          );
        }
        for (const action of pulled.history) {
          upsertHistory.run(
            session,
            action.id,
            action.measure.prefix,
            action.measure.number,
            action.chamber,
            action.date,
            action.text,
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
