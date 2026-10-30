// The MCP server's side of the database: read-only.
import { z } from "zod";
import type { HistoryAction, Measure, MeasureKey, SessionKey } from "#/packages/domain/index.ts";
import { comparePrintOrder, type LegislatorId, type Sponsor } from "#/packages/domain/legislators.ts";
import type { CommitteeVote, FloorVote } from "#/packages/domain/votes.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { openReadConnection } from "./lib/connection.ts";

export type IndexReader = {
  findMeasure(key: MeasureKey): Measure | undefined;
  /** A Measure's Member sponsors in print order. */
  findSponsors(key: MeasureKey): Sponsor[];
  /** The codes of the committees that sponsor a Measure, in print order. */
  findCommitteeSponsors(key: MeasureKey): string[];
  /** The messages of a Measure's Presession rows, as the feed gives them, in print order. */
  findPresessionMessages(key: MeasureKey): string[];
  /** A Measure's history, oldest action first: by the time it happened, then by the feed's id. */
  findHistory(key: MeasureKey): HistoryAction[];
  /**
   * A Measure's floor votes, in the order they were taken (then by the feed's history id), each with the
   * Legislators' votes in the feed's order.
   */
  findFloorVotes(key: MeasureKey): FloorVote[];
  /**
   * A Measure's committee votes, in the order the committees met (then by the feed's report id), each
   * with the members' votes in the feed's order.
   */
  findCommitteeVotes(key: MeasureKey): CommitteeVote[];
  /** When the last completed full pull started, or undefined if none has completed. */
  asOf(session: SessionKey): Timestamp | undefined;
  close(): void;
};

const measureRow = z.object({
  catchline: z.string().nullable(),
  location: z.string(),
  committee_code: z.string().nullable(),
  created_at: z.string(),
  modified_at: z.string().nullable(),
});
const stateRow = z.object({ full_pull_as_of: z.string() });
const textRow = z.object({ text: z.string() });
const historyRow = z.object({
  history_id: z.number(),
  chamber: z.enum(["house", "senate"]),
  action_date: z.string(),
  action_text: z.string(),
});
const floorVoteRow = z.object({
  history_id: z.number(),
  chamber: z.enum(["house", "senate"]),
  action_date: z.string(),
  action_text: z.string(),
  legislator_code: z.string(),
  legislator_id: z.string().nullable(),
  legislator_name: z.string().nullable(),
  vote: z.string(),
});
const committeeVoteRow = z.object({
  report_id: z.number(),
  committee_code: z.string(),
  meeting_date: z.string(),
  legislator_code: z.string(),
  legislator_id: z.string().nullable(),
  legislator_name: z.string().nullable(),
  vote: z.string(),
});
const sponsorRow = z.object({
  sponsor_id: z.number(),
  print_order: z.number(),
  level: z.enum(["chief", "regular"]),
  legislator_code: z.string(),
  legislator_id: z.string().nullable(),
  legislator_name: z.string().nullable(),
});

export function openIndexReader(path: string): IndexReader {
  const database = openReadConnection(path);
  const selectMeasure = database.prepare(
    "SELECT catchline, location, committee_code, created_at, modified_at FROM measure WHERE session_key = ? AND prefix = ? AND number = ?",
  );
  const selectSponsors = database.prepare(
    `SELECT sponsor.sponsor_id, sponsor.print_order, sponsor.level, sponsor.legislator_code,
            sponsor.legislator_id, legislator.name AS legislator_name
     FROM sponsor LEFT JOIN legislator
       ON legislator.session_key = sponsor.session_key AND legislator.id = sponsor.legislator_id
     WHERE sponsor.session_key = ? AND sponsor.prefix = ? AND sponsor.number = ? AND sponsor.kind = 'member'`,
  );
  const selectCommittees = database.prepare(
    `SELECT committee_code AS text FROM sponsor
     WHERE session_key = ? AND prefix = ? AND number = ? AND kind = 'committee'
     ORDER BY print_order, sponsor_id`,
  );
  const selectPresessionMessages = database.prepare(
    `SELECT presession_message AS text FROM sponsor
     WHERE session_key = ? AND prefix = ? AND number = ? AND kind = 'presession'
     ORDER BY print_order, sponsor_id`,
  );
  const selectHistory = database.prepare(
    `SELECT history_id, chamber, action_date, action_text FROM history_action
     WHERE session_key = ? AND prefix = ? AND number = ? ORDER BY action_date, history_id`,
  );
  const selectFloorVotes = database.prepare(
    `SELECT floor_vote.history_id, floor_vote.chamber, floor_vote.action_date, floor_vote.action_text,
            floor_vote.legislator_code, floor_vote.legislator_id, legislator.name AS legislator_name, floor_vote.vote
     FROM floor_vote LEFT JOIN legislator
       ON legislator.session_key = floor_vote.session_key AND legislator.id = floor_vote.legislator_id
     WHERE floor_vote.session_key = ? AND floor_vote.prefix = ? AND floor_vote.number = ?
     ORDER BY floor_vote.action_date, floor_vote.history_id, floor_vote.vote_id`,
  );
  const selectCommitteeVotes = database.prepare(
    `SELECT committee_vote.report_id, committee_vote.committee_code, committee_vote.meeting_date,
            committee_vote.legislator_code, committee_vote.legislator_id, legislator.name AS legislator_name,
            committee_vote.vote
     FROM committee_vote LEFT JOIN legislator
       ON legislator.session_key = committee_vote.session_key AND legislator.id = committee_vote.legislator_id
     WHERE committee_vote.session_key = ? AND committee_vote.prefix = ? AND committee_vote.number = ?
     ORDER BY committee_vote.meeting_date, committee_vote.report_id, committee_vote.vote_id`,
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
        location: { current: stored.location, committeeCode: stored.committee_code },
        createdAt: stored.created_at as Timestamp,
        modifiedAt: stored.modified_at as Timestamp | null,
      };
    },
    findSponsors(key) {
      const sponsors = selectSponsors.all(key.session, key.prefix, key.number).map((row) => {
        const stored = sponsorRow.parse(row);
        return {
          printOrder: stored.print_order,
          sponsorId: stored.sponsor_id,
          level: stored.level,
          legislatorCode: stored.legislator_code,
          legislatorId: stored.legislator_id as LegislatorId | null,
          legislatorName: stored.legislator_name,
        };
      });
      return sponsors.sort(comparePrintOrder(key.prefix)).map((sponsor) => ({
        level: sponsor.level,
        legislatorCode: sponsor.legislatorCode,
        legislator:
          sponsor.legislatorId === null || sponsor.legislatorName === null
            ? null
            : { id: sponsor.legislatorId, name: sponsor.legislatorName },
      }));
    },
    findCommitteeSponsors(key) {
      return selectCommittees.all(key.session, key.prefix, key.number).map((row) => textRow.parse(row).text);
    },
    findPresessionMessages(key) {
      return selectPresessionMessages.all(key.session, key.prefix, key.number).map((row) => textRow.parse(row).text);
    },
    findHistory(key) {
      return selectHistory.all(key.session, key.prefix, key.number).map((row) => {
        const stored = historyRow.parse(row);
        return {
          id: stored.history_id,
          measure: key,
          chamber: stored.chamber,
          date: stored.action_date as Timestamp,
          text: stored.action_text,
        };
      });
    },
    findFloorVotes(key) {
      const votes: FloorVote[] = [];
      let currentHistory: number | undefined;
      for (const row of selectFloorVotes.all(key.session, key.prefix, key.number)) {
        const stored = floorVoteRow.parse(row);
        // The rows come ordered by time and history id, so a new history id starts a new floor vote.
        if (stored.history_id !== currentHistory || votes.length === 0) {
          votes.push({
            chamber: stored.chamber,
            date: stored.action_date as Timestamp,
            action: stored.action_text,
            votes: [],
          });
          currentHistory = stored.history_id;
        }
        votes[votes.length - 1]?.votes.push({
          legislatorCode: stored.legislator_code,
          legislator:
            stored.legislator_id === null || stored.legislator_name === null
              ? null
              : { id: stored.legislator_id as LegislatorId, name: stored.legislator_name },
          vote: stored.vote,
        });
      }
      return votes;
    },
    findCommitteeVotes(key) {
      const votes: CommitteeVote[] = [];
      let currentReport: number | undefined;
      for (const row of selectCommitteeVotes.all(key.session, key.prefix, key.number)) {
        const stored = committeeVoteRow.parse(row);
        // The rows come ordered by meeting and report, so a new report id starts a new committee vote.
        if (stored.report_id !== currentReport || votes.length === 0) {
          votes.push({
            committeeCode: stored.committee_code,
            meetingDate: stored.meeting_date as Timestamp,
            votes: [],
          });
          currentReport = stored.report_id;
        }
        votes[votes.length - 1]?.votes.push({
          legislatorCode: stored.legislator_code,
          legislator:
            stored.legislator_id === null || stored.legislator_name === null
              ? null
              : { id: stored.legislator_id as LegislatorId, name: stored.legislator_name },
          vote: stored.vote,
        });
      }
      return votes;
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
