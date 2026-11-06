import { z } from "zod";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { CommitteeVoteEntry } from "#/packages/domain/votes.ts";
import { readSessionRows, type RowSelection } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

const committeeVoteRow = z.looseObject({
  SessionKey: z.string(),
  CommitteeVoteId: z.number().int(),
  CommitteeReportId: z.number().int(),
  CommitteeCode: z.string(),
  MeetingDate: feedTimestamp,
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  // The Legislator Code is in a property called VoteName, and the vote itself in one called Meaning
  // (MeasureVotes has them the other way round: VoteName and Vote).
  VoteName: z.string(),
  Meaning: z.string(),
  CreatedDate: feedTimestamp.nullish(),
});

export async function readCommitteeVoteRows(
  options: OlisClientOptions,
  session: SessionKey,
  selection: RowSelection,
  signal: AbortSignal,
): Promise<CommitteeVoteEntry[]> {
  const rows = await readSessionRows(options, "CommitteeVotes", session, committeeVoteRow, selection, signal);
  return rows.map((row) => ({
    id: row.CommitteeVoteId,
    measure: { session, prefix: row.MeasurePrefix, number: row.MeasureNumber },
    reportId: row.CommitteeReportId,
    committeeCode: row.CommitteeCode,
    meetingDate: row.MeetingDate,
    legislatorCode: row.VoteName,
    vote: row.Meaning,
    ...(row.CreatedDate === null || row.CreatedDate === undefined ? {} : { createdAt: row.CreatedDate }),
  }));
}
