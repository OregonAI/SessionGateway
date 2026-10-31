// What the live-status tests share (seam 1): the shape of get_measure's `live_status` block as an agent
// reads it. A change to the shape is made here.
import type { ToolOutcome } from "./mcp-clients.ts";
import type { ToolCommitteeVote, ToolFloorVote } from "./votes.ts";

export type ToolHistoryAction = { chamber: string; date: string; text: string };

/** One upcoming committee agenda item of the live block's `schedule`. */
export type ToolScheduledItem = { committee_code: string; meeting_date: string; meeting_type: string };

/** A list of the live block (history, floor votes, committee votes): what OLIS adds to the top level's list, or all of OLIS's list. */
export type ToolLiveList<Entry> =
  { status: "unchanged" } | { status: "new_entries"; entries: Entry[] } | { status: "full"; entries: Entry[] };

export type ToolLiveLocation =
  { status: "unchanged" } | { status: "full"; current: string; committee_code: string | null };

export type ToolLiveStatus = {
  source: "olis" | "cache";
  lookup_failed: boolean;
  as_of: string;
  notice: string;
  location: ToolLiveLocation;
  history: ToolLiveList<ToolHistoryAction>;
  schedule: ToolScheduledItem[] | null;
  floor_votes: ToolLiveList<ToolFloorVote>;
  committee_votes: ToolLiveList<ToolCommitteeVote>;
};

/** The `live_status` of a get_measure outcome, or undefined when the call gave none. */
export function liveStatusOf(outcome: Pick<ToolOutcome, "structured"> | undefined): ToolLiveStatus | undefined {
  return outcome?.structured?.["live_status"] as ToolLiveStatus | undefined;
}

/** What a list of the live block says, read the way its schema tells an agent to: against the top level's list. */
export function readAgainst<Entry>(top: readonly Entry[], said: ToolLiveList<Entry>): Entry[] {
  switch (said.status) {
    case "unchanged":
      return [...top];
    case "new_entries":
      return [...top, ...said.entries];
    case "full":
      return said.entries;
  }
}

/** The live block's history as an agent reads it with the top-level history: the whole list at OLIS. */
export function liveHistoryOf(outcome: Pick<ToolOutcome, "structured"> | undefined): ToolHistoryAction[] {
  const live = liveStatusOf(outcome);
  return live === undefined ? [] : readAgainst(outcome?.structured?.["history"] as ToolHistoryAction[], live.history);
}

/** The live block's floor votes read against the top-level floor votes. */
export function liveFloorVotesOf(outcome: Pick<ToolOutcome, "structured"> | undefined): ToolFloorVote[] {
  const live = liveStatusOf(outcome);
  return live === undefined
    ? []
    : readAgainst(outcome?.structured?.["floor_votes"] as ToolFloorVote[], live.floor_votes);
}

/** The live block's committee votes read against the top-level committee votes. */
export function liveCommitteeVotesOf(outcome: Pick<ToolOutcome, "structured"> | undefined): ToolCommitteeVote[] {
  const live = liveStatusOf(outcome);
  return live === undefined
    ? []
    : readAgainst(outcome?.structured?.["committee_votes"] as ToolCommitteeVote[], live.committee_votes);
}
