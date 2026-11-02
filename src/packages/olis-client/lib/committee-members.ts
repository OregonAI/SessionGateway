import { z } from "zod";
import type { CommitteeMember } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import { readSessionRows } from "./feed.ts";
import type { OlisClientOptions, PullRead } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

// The set's declared key is (CommitteeCode, CreatedDate, Title), with no SessionKey or LegislatorCode in it, and it
// is not unique: in 2025R1, 98 key values cover 235 extra rows (docs/research/olis-odata.md section 8, gotcha 5). A
// client that de-duplicates entities by key would keep one of Rep Helm and Rep Owens, who are both Co-Chairs of
// HALNRW from the same instant. The row is therefore kept whole.
const memberRow = z.looseObject({
  SessionKey: z.string(),
  CommitteeCode: z.string(),
  LegislatorCode: z.string(),
  Title: z.string(),
  CreatedDate: feedTimestamp,
  ModifiedDate: feedTimestamp.nullable(),
});

/**
 * The row as one string, whatever the feed sent in it: every property, named, in the order of the names. Two
 * rows have one key only if they are the same in every property.
 */
function wholeRowKey(row: Record<string, unknown>): string {
  const properties = Object.entries(row).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(properties);
}

/** Every CommitteeMembers row of the Session, one entry for each row. */
export async function readCommitteeMembers(
  options: OlisClientOptions,
  session: SessionKey,
  read: PullRead,
  signal: AbortSignal,
): Promise<CommitteeMember[]> {
  const rows = await readSessionRows(options, "CommitteeMembers", session, memberRow, signal, read);
  return rows.map((row) => ({
    session,
    key: wholeRowKey(row),
    committeeCode: row.CommitteeCode,
    legislatorCode: row.LegislatorCode,
    title: row.Title,
    createdAt: row.CreatedDate,
    modifiedAt: row.ModifiedDate,
  }));
}
