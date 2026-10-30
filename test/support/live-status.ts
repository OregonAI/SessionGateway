// What the live-status tests share (seam 1): the shape of get_measure's `live_status` block as an agent
// reads it. A change to the shape is made here.
import type { ToolOutcome } from "./mcp-clients.ts";
import type { ToolCommitteeVote, ToolFloorVote } from "./votes.ts";

export type ToolHistoryAction = { chamber: string; date: string; text: string };

/** One upcoming committee agenda item of the live block's `schedule`. */
export type ToolScheduledItem = { committee_code: string; meeting_date: string; meeting_type: string };

export type ToolLiveStatus = {
  source: "olis" | "cache";
  lookup_failed: boolean;
  as_of: string;
  notice: string;
  location: { current: string; committee_code: string | null };
  history: ToolHistoryAction[];
  schedule: ToolScheduledItem[] | null;
  floor_votes: ToolFloorVote[];
  committee_votes: ToolCommitteeVote[];
};

/** The `live_status` of a get_measure outcome, or undefined when the call gave none. */
export function liveStatusOf(outcome: Pick<ToolOutcome, "structured"> | undefined): ToolLiveStatus | undefined {
  return outcome?.structured?.["live_status"] as ToolLiveStatus | undefined;
}
