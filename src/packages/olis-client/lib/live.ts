// The live lookup's reads: what OLIS says now about one Measure. Each kind of row is one request
// narrowed to the Measure (feed.ts, `MeasureScope`), and the requests run together.
import type { HistoryAction, Measure, MeasureKey } from "#/packages/domain/index.ts";
import type { CommitteeVoteEntry, FloorVoteEntry } from "#/packages/domain/votes.ts";
import { readCommitteeVoteRows } from "./committee-votes.ts";
import { readFloorVoteRows } from "./floor-votes.ts";
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
};

export async function readMeasureLive(
  options: OlisClientOptions,
  key: MeasureKey,
  signal: AbortSignal,
): Promise<MeasureLiveRead> {
  const scope = { measure: key };
  // The reads do not depend on each other, so they run together; the first to fail stops the others.
  const failed = new AbortController();
  const together = AbortSignal.any([signal, failed.signal]);
  try {
    const [measures, history, floorVotes, committeeVotes] = await Promise.all([
      readMeasureRows(options, key.session, together, scope),
      readHistoryActionRows(options, key.session, together, scope),
      readFloorVoteRows(options, key.session, together, scope),
      readCommitteeVoteRows(options, key.session, together, scope),
    ]);
    if (measures.length > 1)
      throw new Error(`OLIS listed the Measure ${key.prefix} ${key.number} ${measures.length} times`);
    return { measure: measures[0], history, floorVotes, committeeVotes };
  } catch (error) {
    failed.abort();
    throw error;
  }
}
