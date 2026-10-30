import { z } from "zod";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { FloorVoteEntry } from "#/packages/domain/votes.ts";
import { feedChamber } from "./chamber.ts";
import { readSessionRows } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

const floorVoteRow = z.looseObject({
  SessionKey: z.string(),
  MeasureVoteId: z.number().int(),
  MeasureHistoryId: z.number().int(),
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  Chamber: feedChamber,
  ActionDate: feedTimestamp,
  ActionText: z.string(),
  // The Legislator Code is in a property called VoteName, and the vote in one called Vote
  // (CommitteeVotes has them the other way round: VoteName and Meaning).
  VoteName: z.string(),
  Vote: z.string(),
});

export async function readFloorVoteRows(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<FloorVoteEntry[]> {
  const rows = await readSessionRows(options, "MeasureVotes", session, floorVoteRow, signal);
  return rows.map((row) => ({
    id: row.MeasureVoteId,
    measure: { session, prefix: row.MeasurePrefix, number: row.MeasureNumber },
    historyId: row.MeasureHistoryId,
    chamber: row.Chamber,
    date: row.ActionDate,
    action: row.ActionText,
    legislatorCode: row.VoteName,
    vote: row.Vote,
  }));
}
