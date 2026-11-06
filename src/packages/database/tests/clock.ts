import type { Clock } from "#/packages/time/clock.ts";

/**
 * A clock after every made-up time (the made-up pulls run in January 2099), so the readers hide nothing: the stories of
 * the Listing, of search, of the schema and of the speaker-turn index are not about creation times (ticket #151). The
 * stories that are pass a clock of their own.
 */
export const afterEverythingMadeUp: Clock = { now: () => new Date("2100-01-01T00:00:00Z") };
