// The glossary's vote words as types: a Legislator's vote in a committee vote or a floor vote, as
// the feed records it (an entry) and as the server shows it. The vote itself is the feed's own word
// ("Aye", "Nay", "Excused"; floor votes also have "Excused for Business" and "Absent"), kept as a
// string because nothing branches on it and a closed set would stop a pull on the first new word.
import type { MeasureKey } from "./index.ts";
import type { Legislator, LegislatorId } from "./legislators.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

type EntryFields = {
  /** The feed's own key for the row: the id of the vote entry. */
  id: number;
  measure: MeasureKey;
  /** The Legislator Code the feed gives the voter. The feed's property for it is `VoteName`. */
  legislatorCode: string;
  /** The voter's vote, in the feed's word. */
  vote: string;
};

/**
 * One member's entry in a committee vote, as a CommitteeVotes row records it. The rows of one
 * committee vote share a `CommitteeReportId`: a committee can vote more than once on one Measure at
 * one meeting, and each of those is a vote of its own.
 */
export type CommitteeVoteEntry = EntryFields & {
  reportId: number;
  committeeCode: string;
  /** When the committee met, in Pacific time with its offset. */
  meetingDate: Timestamp;
};

/** A Legislator's vote as the server shows it. `legislator` is null while the code is unresolved. */
export type LegislatorVote = {
  legislatorCode: string;
  legislator: Legislator | null;
  vote: string;
};

/** A committee's vote on a Measure at one meeting, each member's vote in the feed's order. */
export type CommitteeVote = {
  committeeCode: string;
  meetingDate: Timestamp;
  votes: LegislatorVote[];
};

/** What the worker stores of a committee vote entry: the entry and the Legislator its code resolved to, if any. */
export type CommitteeVoteRecord = CommitteeVoteEntry & { legislatorId: LegislatorId | null };
