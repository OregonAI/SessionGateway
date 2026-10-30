import type { Clock } from "#/packages/time/clock.ts";

/** A clock the test moves by hand. One of these drives the fake OLIS, the worker and the server. */
export type SimulatedClock = Clock & {
  set(to: string): void;
  advance(milliseconds: number): void;
};

/** `start` is an ISO-8601 instant with an offset, for example "2025-01-29T17:00:00Z". */
export function createSimulatedClock(start: string): SimulatedClock {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    set(to) {
      current = new Date(to);
    },
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}
