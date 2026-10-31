// Oregon keeps Pacific time. Everything this service says about a time carries the Pacific offset in
// force at that moment. This module knows the zone and nothing about any source's timestamp format:
// reading a source's text (the OLIS feed's offset-less form) belongs to the code that sees the source
// (src/CLAUDE.md, "Shape"). The one text it reads is ISO 8601's, as a person writes it in a tool argument
// (`readTimestamp`), because that is the standard's form and not a source's, and the zone is its to apply.

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

/** The Timestamp for an instant, in Pacific time with the offset in force then, to the fraction of a second it has. */
export function pacificTimestampOf(instant: Temporal.Instant): Timestamp {
  return instant.toZonedDateTimeISO(PACIFIC).toString({ timeZoneName: "never" }) as Timestamp;
}

/**
 * Reads a time written as ISO 8601 or RFC 9557 does into a Timestamp (ticket #16 F1): a date alone (midnight), a time
 * with a UTC offset or "Z", or one with a time zone annotation in brackets, with "T" or a space between the date and the
 * time. A time that names an instant (it has an offset or "Z") is that instant, and the annotation after an offset is
 * only a label for it. A time with a bracketed zone and no offset is that zone's wall clock. A time with neither is
 * Pacific wall-clock time, read the way `atPacificLocalTime` reads one. Undefined when the text is none of these.
 * Temporal's own parsers decide which a text is: `Temporal.PlainDateTime.from` quietly drops an offset, so it is tried
 * last, on text that has none.
 */
export function readTimestamp(text: string): Timestamp | undefined {
  const written = text.trim();
  try {
    return pacificTimestampOf(Temporal.Instant.from(written));
  } catch {
    // No offset and no "Z": a zone annotation or nothing.
  }
  try {
    return pacificTimestampOf(Temporal.ZonedDateTime.from(written).toInstant());
  } catch {
    // No zone annotation either.
  }
  try {
    return atPacificLocalTime(Temporal.PlainDateTime.from(written));
  } catch {
    return undefined;
  }
}

/** Orders two Timestamps by the instants they name, which their text does not (a change of offset): negative if `a` is earlier. */
export function compareTimestamps(a: Timestamp, b: Timestamp): number {
  return Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b));
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
