// Oregon keeps Pacific time. Everything this service says about a time carries the Pacific offset in
// force at that moment. This module knows the zone and nothing about any source's timestamp format:
// reading a source's text (the OLIS feed's offset-less form) belongs to the code that sees the source
// (src/CLAUDE.md, "Shape").

const PACIFIC = "America/Los_Angeles";

/** An instant written as Pacific local time with its UTC offset, such as "2025-01-29T09:00:00-08:00". */
export type Timestamp = string & { readonly brand: "Timestamp" };

/**
 * The Timestamp for a wall-clock reading in Pacific time, with the offset in force at that moment. A
 * local time that does not exist (the hour skipped when daylight time begins) is moved forward, and
 * one that happened twice (the hour repeated when it ends) is read as its first occurrence:
 * Temporal's "compatible" rule, for sources that do not say which they mean.
 */
export function atPacificLocalTime(local: Temporal.PlainDateTime): Timestamp {
  const zoned = local.toZonedDateTime(PACIFIC, { disambiguation: "compatible" });
  return zoned.toString({ timeZoneName: "never" }) as Timestamp;
}

/** The time the injected clock reads, as a Timestamp (to the second). */
export function formatPacific(instant: Date): Timestamp {
  const zoned = Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(PACIFIC);
  return zoned.toString({ timeZoneName: "never", smallestUnit: "second" }) as Timestamp;
}

/** The wall-clock reading in Pacific time at an instant, with no offset: for a source that words its times that way. */
export function pacificWallClock(instant: Date): Temporal.PlainDateTime {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(PACIFIC).toPlainDateTime();
}

/** Whether a Timestamp is at or after an instant: "has not started yet", for a meeting and the clock's now. */
export function isAtOrAfter(at: Timestamp, instant: Date): boolean {
  return Temporal.Instant.from(at).epochMilliseconds >= instant.getTime();
}
