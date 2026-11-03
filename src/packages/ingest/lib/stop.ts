// What a stop is (ticket #113). The shutdown asking the worker to stop is not a failure, and it is told from the
// deadline's abort by the signal's reason, not by the error's name: Node's own `timers/promises` setTimeout rejects
// with an `AbortError` on any abort, the deadline's included, but the signal's reason is a `TimeoutError` then.

/** Whether the signal was aborted by a request to stop (`AbortController.abort()` gives an `AbortError`), not by a timeout. */
function abortedByRequest(signal: AbortSignal): boolean {
  const reason: unknown = signal.reason;
  return signal.aborted && reason instanceof DOMException && reason.name === "AbortError";
}

/**
 * Whether `error` is the abort of `signal` by a request to stop, and not a failure. An `AbortError` after the deadline
 * (`AbortSignal.timeout`, reason `TimeoutError`) is not one, and neither is an error of another kind that happens after
 * the stop: it is reported as itself.
 */
export function isStopRequest(signal: AbortSignal, error: unknown): boolean {
  return abortedByRequest(signal) && error instanceof Error && error.name === "AbortError";
}

/**
 * A full pull that a stop ended, with what the Index held when it did (`undefined` when that could not be counted).
 * Not a failure: the next pull fetches the rest.
 */
export type FullPullStopped = Error & { name: "FullPullStopped"; documentsStored: number | undefined };

export function fullPullStopped(documentsStored: number | undefined, cause: unknown): FullPullStopped {
  const held = documentsStored === undefined ? "could not be counted" : `holds ${documentsStored} documents`;
  return Object.assign(new Error(`The full pull was stopped by the shutdown; the index ${held}`, { cause }), {
    name: "FullPullStopped" as const,
    documentsStored,
  });
}

export function isFullPullStopped(error: unknown): error is FullPullStopped {
  return error instanceof Error && error.name === "FullPullStopped";
}

/** Whether a run of the loop ended because the shutdown (the loop's own signal) asked it to: not a run that failed. */
export function endedByShutdown(shutdown: AbortSignal, error: unknown): boolean {
  return shutdown.aborted && (isFullPullStopped(error) || isStopRequest(shutdown, error));
}
