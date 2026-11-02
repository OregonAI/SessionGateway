// The live lookup's reads: what OLIS says now about one Measure. Each kind of row is one request
// narrowed to the Measure (feed.ts, `MeasureScope`), and the requests run together.
import type { HistoryAction, Measure, MeasureKey } from "#/packages/domain/index.ts";
import type { AgendaItem } from "#/packages/domain/schedule.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";
import { pacificWallClock } from "#/packages/time/pacific.ts";
import { readMeasureAgendaItems } from "./agenda-items.ts";
import { readCommitteeVoteRows } from "./committee-votes.ts";
import { readFloorVoteRows } from "./floor-votes.ts";
import type { MeasureScope } from "./feed.ts";
import { readHistoryActionRows } from "./history.ts";
import { readMeasureRows } from "./measures.ts";
import type { OlisClientOptions } from "./options.ts";

export type MeasureLiveRead = {
  /** The Measures row, or undefined when the feed lists no Measure with the key. */
  measure: Measure | undefined;
  /** The Measure's history, in the feed's order. */
  history: HistoryAction[];
  /** One entry for each Legislator in each of the Measure's floor votes, in the feed's order. */
  floorVotes: FloorVoteEntry[];
  /** One entry for each member in each of the Measure's committee votes, in the feed's order. */
  committeeVotes: CommitteeVoteEntry[];
  /** The Measure's agenda items for meetings at or after the time of the read: its schedule. */
  schedule: AgendaItem[];
};

/** An OData datetime literal for the wall-clock reading in Pacific time at an instant: `datetime'2025-01-29T09:00:00'`. */
function datetimeLiteral(instant: Date): string {
  return `datetime'${pacificWallClock(instant).toString({ smallestUnit: "second" })}'`;
}

export async function readMeasureLive(
  options: OlisClientOptions,
  key: MeasureKey,
  readAt: Date,
  signal: AbortSignal,
): Promise<MeasureLiveRead> {
  const scope: MeasureScope = { kind: "measure", measure: key };
  // Only the meetings still ahead: a past meeting is history, which the Measure's history rows tell.
  const ahead: MeasureScope = { kind: "measure", measure: key, also: `MeetingDate ge ${datetimeLiteral(readAt)}` };
  // The reads do not depend on each other, so they run together; the first to fail stops the others.
  const failed = new AbortController();
  const together = AbortSignal.any([signal, failed.signal]);
  try {
    const [measures, history, floorVotes, committeeVotes, schedule] = await Promise.all([
      readMeasureRows(options, key.session, scope, together),
      readHistoryActionRows(options, key.session, scope, together),
      readFloorVoteRows(options, key.session, scope, together),
      readCommitteeVoteRows(options, key.session, scope, together),
      readMeasureAgendaItems(options, key.session, together, ahead),
    ]);
    if (measures.length > 1)
      throw new Error(`OLIS listed the Measure ${key.prefix} ${key.number} ${measures.length} times`);
    return { measure: measures[0], history, floorVotes, committeeVotes, schedule };
  } catch (error) {
    failed.abort();
    throw error;
  }
}
