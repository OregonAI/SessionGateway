// The ingest worker's loop (ticket #17, ADR-0039): wake at every quarter hour, ask the schedule what is due, and run it
// once. It holds no rule of its own: when things run is `whatRunsAt`, what runs is `runFullPull` and `runIncrement`, and
// the clock and the sleep are passed in, so a test moves a simulated clock through a day without a timer.
import type { IngestConfig } from "#/packages/config/index.ts";
import { openIndexWriter } from "#/packages/database/writer.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";
import { runFullPull, runIncrement, type FullPullResult, type IngestDeps } from "./index.ts";
import { whatRunsAt, type Due, type SessionSchedule } from "./schedule.ts";

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
} {
  const writer = openIndexWriter(config.databasePath);
  try {
    const runs = writer.lastRuns(config.session);
    return {
      // The Session's ConveneTimes and its BeginDate and EndDate are not read yet (ADR-0039): a day the Session meets
      // is a day with a committee meeting.
      schedule: { meetingDays: new Set(writer.meetingDays(config.session)), inProgress: false },
      lastRun: { increment: runs.increment, full_pull: runs.fullPull },
    };
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
  for (const kind of ["increment", "full_pull"] as const) {
    const at = start.lastRun[kind];
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
          const result = await runFullPull(config, deps);
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
