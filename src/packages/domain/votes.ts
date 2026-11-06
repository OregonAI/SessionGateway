// The glossary's vote words as types: a Legislator's vote in a committee vote or a floor vote, as
// the feed records it (an entry) and as the server shows it. The vote itself is the feed's own word
// ("Aye", "Nay", "Excused"; floor votes also have "Excused for Business" and "Absent"), kept as a
// string because nothing branches on it and a closed set would stop a pull on the first new word.
import type { Chamber, MeasureKey } from "./index.ts";
import type { Legislator } from "./legislators.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

type EntryFields = {
  /** The feed's own key for the row: the id of the vote entry. */
  id: number;
  measure: MeasureKey;
  /** The Legislator Code the feed gives the voter. The feed's property for it is `VoteName`. */
  legislatorCode: string;
  /** The voter's vote, in the feed's word. */
  vote: string;
  /** When OLIS created the row (its `CreatedDate`), with its Pacific offset; absent when the feed gave none (ADR-0056, ticket #153). */
  createdAt?: Timestamp;
};

/**
 * One member's entry in a committee vote, as a CommitteeVotes row records it. The rows of one
 * report share a `CommitteeReportId`. The feed can give one roll under two reports (a joint
 * committee's, in the cache), and the reader lists it once.
 */
export type CommitteeVoteEntry = EntryFields & {
  reportId: number;
  committeeCode: string;
  /** When the committee met, in Pacific time with its offset. */
  meetingDate: Timestamp;
};

/**
 * One Legislator's entry in a floor vote, as a MeasureVotes row records it. The rows of one floor
 * vote share a `MeasureHistoryId`: the history action the chamber voted at.
 */
export type FloorVoteEntry = EntryFields & {
  historyId: number;
  chamber: Chamber;
  /** When the chamber voted, in Pacific time with its offset. */
  date: Timestamp;
  /** The history action's text, such as "Third reading.  Carried by Bonham.  Passed.". */
  action: string;
};

/** A Legislator's vote as the server shows it. `legislator` is null while the code is unresolved. */
export type LegislatorVote = {
  legislatorCode: string;
  legislator: Legislator | null;
  vote: string;
};

/** A committee's vote on a Measure at one meeting, each member's vote in the order of the feed's ids for the entries. */
export type CommitteeVote = {
  committeeCode: string;
  meetingDate: Timestamp;
  votes: LegislatorVote[];
};

/** One chamber's roll call on a Measure, each Legislator's vote in the order of the feed's ids for the entries. */
export type FloorVote = {
  chamber: Chamber;
  date: Timestamp;
  action: string;
  votes: LegislatorVote[];
};

/** Orders the entries of floor votes the way the votes are taken: by when, then the vote, then the feed's id for the entry. */
export function compareFloorVoteEntries(a: FloorVoteEntry, b: FloorVoteEntry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.historyId - b.historyId || a.id - b.id;
}

/** Orders the entries of committee votes the way the committees met: by when, then the report, then the feed's id for the entry. */
export function compareCommitteeVoteEntries(a: CommitteeVoteEntry, b: CommitteeVoteEntry): number {
  if (a.meetingDate !== b.meetingDate) return a.meetingDate < b.meetingDate ? -1 : 1;
  return a.reportId - b.reportId || a.id - b.id;
}

/** One entry of a floor vote with the Legislator its code names: what a vote is grouped from. */
export type FloorVoteCast = {
  historyId: number;
  chamber: Chamber;
  date: Timestamp;
  action: string;
  cast: LegislatorVote;
};

/** One entry of a committee vote with the Legislator its code names: what a vote is grouped from. */
export type CommitteeVoteCast = {
  reportId: number;
  committeeCode: string;
  meetingDate: Timestamp;
  cast: LegislatorVote;
};

/** The rows in order, cut into runs of neighbours that share a key: the rows of one vote come next to each other. */
function runsOf<Row>(rows: readonly Row[], keyOf: (row: Row) => unknown): [Row, ...Row[]][] {
  const runs: [Row, ...Row[]][] = [];
  for (const row of rows) {
    const last = runs.at(-1);
    if (last !== undefined && keyOf(last[0]) === keyOf(row)) last.push(row);
    else runs.push([row]);
  }
  return runs;
}

/**
 * Groups entries into floor votes: the entries that share a `MeasureHistoryId` are one vote. The entries
 * come ordered as `compareFloorVoteEntries` orders them, so the rows of a vote are neighbours.
 */
export function groupFloorVotes(casts: readonly FloorVoteCast[]): FloorVote[] {
  return runsOf(casts, (entry) => entry.historyId).map((run) => ({
    chamber: run[0].chamber,
    date: run[0].date,
    action: run[0].action,
    votes: run.map((entry) => entry.cast),
  }));
}

/** A committee vote's committee, meeting and who voted what, whatever order the feed lists the members in. */
function rollOf(vote: CommitteeVote): string {
  const cast = vote.votes.map((entry) => `${entry.legislatorCode}\u0000${entry.vote}`).sort();
  return JSON.stringify([vote.committeeCode, vote.meetingDate, cast]);
}

/**
 * The cache gives every agenda item that has two reports the same roll twice (docs/research/olis-votes.md
 * §3), so a roll the feed gives under two reports is listed once. Rolls that differ are never merged.
 */
function withoutRepeatedRolls(votes: readonly CommitteeVote[]): CommitteeVote[] {
  const listed = new Set<string>();
  return votes.filter((vote) => {
    const roll = rollOf(vote);
    if (listed.has(roll)) return false;
    listed.add(roll);
    return true;
  });
}

/**
 * Groups entries into committee votes: the entries that share a `CommitteeReportId` are one report, and a
 * roll that a later report repeats is listed once. The entries come ordered as `compareCommitteeVoteEntries`
 * orders them, so the rows of a report are neighbours.
 */
export function groupCommitteeVotes(casts: readonly CommitteeVoteCast[]): CommitteeVote[] {
  const reports = runsOf(casts, (entry) => entry.reportId).map((run) => ({
    committeeCode: run[0].committeeCode,
    meetingDate: run[0].meetingDate,
    votes: run.map((entry) => entry.cast),
  }));
  return withoutRepeatedRolls(reports);
}
