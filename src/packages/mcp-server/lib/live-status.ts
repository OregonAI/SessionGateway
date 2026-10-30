// The live lookup of get_measure (ticket #21; spec #1, module 11; ADR-0005): when a call arrives, one
// Measure's location, history, schedule and votes are read from OLIS and dated by the injected clock.
// A lookup that fails is a value, not an error: the cache still answers (src/CLAUDE.md, "Errors").
import type { SessionKey } from "#/packages/domain/index.ts";
import {
  compareHistoryActions,
  type HistoryAction,
  type MeasureKey,
  type MeasureLocation,
} from "#/packages/domain/index.ts";
import type { Legislator } from "#/packages/domain/legislators.ts";
import { compareAgendaItems, type AgendaItem } from "#/packages/domain/schedule.ts";
import {
  compareCommitteeVoteEntries,
  compareFloorVoteEntries,
  groupCommitteeVotes,
  groupFloorVotes,
  type CommitteeVote,
  type FloorVote,
} from "#/packages/domain/votes.ts";
import type { MeasureLiveRead, OlisClient } from "#/packages/olis-client/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";

/** What a live lookup came to: OLIS's values, or the reason it could not give them. */
export type LiveLookup =
  | {
      kind: "answered";
      /** The injected clock's time when the read began, in Pacific time with its offset. */
      asOf: Timestamp;
      location: MeasureLocation;
      history: HistoryAction[];
      floorVotes: FloorVote[];
      committeeVotes: CommitteeVote[];
      schedule: AgendaItem[];
    }
  | { kind: "failed"; reason: string };

/** A live lookup that failed, for whoever logs it. */
export type LiveLookupFailure = { measure: MeasureKey; error: Error };

export type LiveStatusReader = {
  lookup(key: MeasureKey): Promise<LiveLookup>;
};

export type LiveStatusDeps = {
  olis: OlisClient;
  /** Says who a Legislator Code names, as the index's last full pull resolved it. */
  legislatorOfCode: (session: SessionKey, code: string) => Legislator | undefined;
  clock: Clock;
  /** How long a lookup may take, all its requests together. */
  timeoutMs: number;
  /** Aborts a lookup in flight on shutdown. */
  signal: AbortSignal;
  /** Told of each lookup that failed, with the error behind it. */
  onFailure: (failure: LiveLookupFailure) => void;
};

/** The error's own code when it has one (a refused connection has `ECONNREFUSED`), for the reason an agent reads. */
function codeOf(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** Says in a few words why a lookup failed, for an agent to read. */
function reasonOf(error: unknown, timedOut: boolean, timeoutMs: number): string {
  if (timedOut) return `OLIS did not answer within ${timeoutMs / 1000} seconds`;
  if (error instanceof TypeError && error.message === "fetch failed") {
    const code = codeOf(error);
    return code === undefined ? "the connection to OLIS failed" : `the connection to OLIS failed (${code})`;
  }
  return error instanceof Error ? error.message : "OLIS could not be read";
}

export function createLiveStatusReader(deps: LiveStatusDeps): LiveStatusReader {
  return {
    async lookup(key) {
      const readAt = deps.clock.now();
      const timeout = AbortSignal.timeout(deps.timeoutMs);
      const signal = AbortSignal.any([deps.signal, timeout]);
      /** A lookup that failed is reported to the deployment and answered as a value. */
      const failed = (error: unknown): LiveLookup => {
        deps.onFailure({
          measure: key,
          error: error instanceof Error ? error : new Error("The live lookup failed", { cause: error }),
        });
        return { kind: "failed", reason: reasonOf(error, timeout.aborted, deps.timeoutMs) };
      };

      let read: MeasureLiveRead;
      try {
        read = await deps.olis.readMeasureLive(key, readAt, signal);
      } catch (error) {
        return failed(error);
      }
      if (read.measure === undefined) {
        return failed(new Error(`OLIS lists no Measure ${key.prefix} ${key.number} in ${key.session}`));
      }
      const legislatorOf = (code: string): Legislator | null => deps.legislatorOfCode(key.session, code) ?? null;
      return {
        kind: "answered",
        asOf: formatPacific(readAt),
        location: read.measure.location,
        history: read.history.toSorted(compareHistoryActions),
        schedule: read.schedule.toSorted(compareAgendaItems),
        floorVotes: groupFloorVotes(
          read.floorVotes.toSorted(compareFloorVoteEntries).map((entry) => ({
            historyId: entry.historyId,
            chamber: entry.chamber,
            date: entry.date,
            action: entry.action,
            cast: {
              legislatorCode: entry.legislatorCode,
              legislator: legislatorOf(entry.legislatorCode),
              vote: entry.vote,
            },
          })),
        ),
        committeeVotes: groupCommitteeVotes(
          read.committeeVotes.toSorted(compareCommitteeVoteEntries).map((entry) => ({
            reportId: entry.reportId,
            committeeCode: entry.committeeCode,
            meetingDate: entry.meetingDate,
            cast: {
              legislatorCode: entry.legislatorCode,
              legislator: legislatorOf(entry.legislatorCode),
              vote: entry.vote,
            },
          })),
        ),
      };
    },
  };
}
