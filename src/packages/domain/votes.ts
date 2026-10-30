// The glossary's vote words as types: a Legislator's vote in a committee vote or a floor vote, as
// the feed records it (an entry) and as the server shows it. The vote itself is the feed's own word
// ("Aye", "Nay", "Excused"; floor votes also have "Excused for Business" and "Absent"), kept as a
// string because nothing branches on it and a closed set would stop a pull on the first new word.
import type { Chamber, MeasureKey } from "./index.ts";
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

/** What the worker stores of a floor vote entry: the entry and the Legislator its code resolved to, if any. */
export type FloorVoteRecord = FloorVoteEntry & { legislatorId: LegislatorId | null };

/** What the worker stores of a committee vote entry: the entry and the Legislator its code resolved to, if any. */
export type CommitteeVoteRecord = CommitteeVoteEntry & { legislatorId: LegislatorId | null };
