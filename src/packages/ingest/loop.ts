// The ingest worker's loop (ticket #17, ADR-0039): wake at every quarter hour, ask the schedule what is due, and run it
// once. It holds no rule of its own: when things run is `whatRunsAt`, what runs is `runFullPull` and `runIncrement`, and
// the clock and the sleep are passed in, so a test moves a simulated clock through a day without a timer.
import type { IngestConfig } from "#/packages/config/index.ts";
import { openIndexWriter } from "#/packages/database/writer.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";
import { runFullPull, runIncrement, type FullPullResult, type IngestDeps } from "./index.ts";
import { fullPullDeadline, sessionScheduleOf, whatRunsAt, type Due, type SessionSchedule } from "./schedule.ts";

export type LoopDeps = IngestDeps & {
  /** Waits this long, or until the signal aborts. Created in the entry script, like the clock. */
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** Told of a run that failed. The loop goes on: the next slot tries again, and the last good run still answers. */
  onRunFailed: (run: "increment" | "full_pull", error: unknown) => void;
  /** Told of each full pull that finished, so the entry script can write its reports. */
  afterFullPull?: (result: FullPullResult) => Promise<void>;
};

/** The loop wakes on the quarter hours, the grain of the 15-minute increments. Pacific offsets are whole hours. */
const TICK_MILLISECONDS = 15 * 60 * 1000;

type RunKind = "increment" | "full_pull";

/** What the index says of the runs so far and of the days the Session meets. */
function readState(config: IngestConfig): {
  schedule: SessionSchedule;
  lastRun: Record<RunKind, Timestamp | undefined>;
  /** The last full pull begun, complete or refused: what the day's one full pull is counted from. */
  lastFullPullBegun: Timestamp | undefined;
} {
  const writer = openIndexWriter(config.databasePath);
  try {
    const runs = writer.lastRuns(config.session);
    return {
      schedule: sessionScheduleOf(writer.meetingDays(config.session)),
      lastRun: { increment: runs.increment, full_pull: runs.fullPull },
      lastFullPullBegun: runs.fullPullAttempt,
    };
  } finally {
    writer.close();
  }
}

function recordFullPullBegun(config: IngestConfig, startedAt: Timestamp): void {
  const writer = openIndexWriter(config.databasePath);
  try {
    writer.recordFullPullAttempt(config.session, startedAt);
  } finally {
    writer.close();
  }
}

/** Runs what the schedule says is due, at most once for each slot, until the signal aborts. */
export async function runIngestLoop(config: IngestConfig, deps: LoopDeps): Promise<void> {
  const settings = { increments: config.increments, fullPull: config.fullPull };
  // The slot each kind of run last ran in. A worker that restarts finds it from the database, so it does not run the
  // night's full pull a second time on the same date (the Acceptable Use Agreement allows one a day).
  const ran: Record<RunKind, string | undefined> = { increment: undefined, full_pull: undefined };
  const start = readState(config);
  // A full pull counts from when it was begun, so one that was refused for a short read still holds its night.
  const startedAt: Record<RunKind, Timestamp | undefined> = {
    increment: start.lastRun.increment,
    full_pull: start.lastFullPullBegun ?? start.lastRun.full_pull,
  };
  for (const kind of ["increment", "full_pull"] as const) {
    const at = startedAt[kind];
    if (at === undefined) continue;
    const then = whatRunsAt(at, settings, start.schedule);
    if (then.kind === kind) ran[kind] = then.slot;
  }
  while (!deps.signal.aborted) {
    const now = deps.clock.now();
    const state = readState(config);
    const due: Due = whatRunsAt(formatPacific(now), settings, state.schedule);
    // An increment reads from the last run, so it waits for a first full pull.
    const ready = due.kind !== "increment" || state.lastRun.full_pull !== undefined;
    if (due.kind !== "nothing" && ready && ran[due.kind] !== due.slot) {
      // Marked before it runs: a run that fails waits for the next slot and does not start again at once.
      ran[due.kind] = due.slot;
      try {
        if (due.kind === "full_pull") {
          recordFullPullBegun(config, formatPacific(now));
          // A pull still running at 6 am is stopped there and stores nothing more: it ran only in the window.
          const deadline = fullPullDeadline(formatPacific(now));
          const untilDeadline =
            deadline === undefined ? undefined : Temporal.Instant.from(deadline).epochMilliseconds - now.getTime();
          const signal =
            untilDeadline === undefined
              ? deps.signal
              : AbortSignal.any([deps.signal, AbortSignal.timeout(Math.max(untilDeadline, 1))]);
          const result = await runFullPull(config, { ...deps, signal });
          await deps.afterFullPull?.(result);
        } else {
          await runIncrement(config, deps);
        }
      } catch (error) {
        deps.onRunFailed(due.kind, error);
      }
    }
    await deps.sleep(TICK_MILLISECONDS - (deps.clock.now().getTime() % TICK_MILLISECONDS), deps.signal);
  }
}
