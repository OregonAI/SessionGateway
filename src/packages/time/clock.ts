/** The time, passed in so that one simulated clock can drive the OLIS fake, the worker and the server. */
export type Clock = {
  now(): Date;
};

/** The system clock: the only place that reads the real time (src/CLAUDE.md, "Dependencies are passed in"). */
export const systemClock: Clock = {
  now: () => new Date(),
};
