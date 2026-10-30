// What the vote tests share (seam 1): the shape of a vote in get_measure's result, and the rows of
// the feed's vote sets in their own shape, which a test adds to what the fake OLIS serves. A change to
// either shape is made here.
import type { ToolOutcome } from "./mcp-clients.ts";
import type { FeedRow } from "./sponsors.ts";

/** One Legislator's vote in a floor vote or a committee vote, as an agent reads it. */
export type ToolVote = {
  legislator_code: string;
  legislator: { id: string; name: string } | null;
  vote: string;
};

export type ToolFloorVote = {
  chamber: string;
  date: string;
  action: string;
  votes: ToolVote[];
};

export type ToolCommitteeVote = {
  committee_code: string;
  meeting_date: string;
  votes: ToolVote[];
};

/** The `floor_votes` of a get_measure outcome, or undefined when the call gave none. */
export function floorVotesOf(outcome: Pick<ToolOutcome, "structured"> | undefined): ToolFloorVote[] | undefined {
  return outcome?.structured?.["floor_votes"] as ToolFloorVote[] | undefined;
}

/** The `committee_votes` of a get_measure outcome, or undefined when the call gave none. */
export function committeeVotesOf(
  outcome: Pick<ToolOutcome, "structured"> | undefined,
): ToolCommitteeVote[] | undefined {
  return outcome?.structured?.["committee_votes"] as ToolCommitteeVote[] | undefined;
}

/** A vote as `[code, vote, Legislator id, Legislator name]`, the way the tests' literals are written. */
export type VoteTuple = readonly [code: string, vote: string, id: string | undefined, name: string | undefined];

export function tuplesOf(votes: readonly ToolVote[]): VoteTuple[] {
  return votes.map((cast) => [cast.legislator_code, cast.vote, cast.legislator?.id, cast.legislator?.name]);
}

type CommitteeVoteRowOptions = {
  measure?: { prefix: string; number: number };
  session?: string;
  committeeCode?: string;
  meetingDate?: string;
  /** The feed's `CommitteeReportId`: the rows of one committee vote share it. */
  reportId?: number;
  agendaItemId?: number;
  createdDate?: string;
};

/** A CommitteeVotes row in the feed's own shape. SB 69 is the default Measure: the fixture holds it. */
export function committeeVoteRow(
  id: number,
  code: string,
  meaning: string,
  options: CommitteeVoteRowOptions = {},
): FeedRow {
  return {
    CommitteeVoteId: id,
    CommitteeReportId: options.reportId ?? 900001,
    CommitteeAgendaItemId: options.agendaItemId ?? 900001,
    SessionKey: options.session ?? "2025R1",
    CommitteeCode: options.committeeCode ?? "SLB",
    MeetingDate: options.meetingDate ?? "2025-02-04T08:00:00",
    MeasurePrefix: options.measure?.prefix ?? "SB",
    MeasureNumber: options.measure?.number ?? 69,
    VoteName: code,
    Meaning: meaning,
    CreatedDate: options.createdDate ?? "2025-01-30T07:00:00",
    ModifiedDate: options.createdDate ?? "2025-01-30T07:00:00",
  };
}

type FloorVoteRowOptions = {
  measure?: { prefix: string; number: number };
  session?: string;
  chamber?: "H" | "S";
  actionDate?: string;
  actionText?: string;
  /** The feed's `MeasureHistoryId`: the rows of one floor vote share it. */
  historyId?: number;
  createdDate?: string;
};

/** A MeasureVotes row in the feed's own shape. SB 69 is the default Measure: the fixture holds it. */
export function floorVoteRow(id: number, code: string, vote: string, options: FloorVoteRowOptions = {}): FeedRow {
  return {
    MeasureVoteId: id,
    MeasureHistoryId: options.historyId ?? 900001,
    SessionKey: options.session ?? "2025R1",
    MeasurePrefix: options.measure?.prefix ?? "SB",
    MeasureNumber: options.measure?.number ?? 69,
    Vote: vote,
    Chamber: options.chamber ?? "S",
    ActionDate: options.actionDate ?? "2025-02-07T10:00:00",
    ActionText: options.actionText ?? "Third reading. Passed.",
    VoteName: code,
    CreatedDate: options.createdDate ?? "2025-02-07T10:00:05",
    ModifiedDate: null,
  };
}
