// Oregon keeps Pacific time, and so does the OLIS feed: its timestamps carry no offset and are read
// as Pacific local time (spec #1, "OLIS client"; docs/research/olis-odata.md section 6, inferred).
// Everything this service says about a time carries the Pacific offset in force at that moment.

const PACIFIC = "America/Los_Angeles";

/** An instant written as Pacific local time with its UTC offset, such as "2025-01-29T09:00:00-08:00". */
export type Timestamp = string & { readonly brand: "Timestamp" };

/**
 * Reads a feed timestamp ("2024-12-31T13:18:07": no offset) as Pacific local time and gives the offset
 * in force at that moment. A local time that does not exist (the hour skipped when daylight time
 * begins) is moved forward, and one that happened twice (the hour repeated when it ends) is read as
 * its first occurrence: Temporal's "compatible" rule, since the feed does not say which it means.
 */
export function readPacificLocal(feedTimestamp: string): Timestamp {
  try {
    const zoned = Temporal.PlainDateTime.from(feedTimestamp).toZonedDateTime(PACIFIC, { disambiguation: "compatible" });
    return zoned.toString({ timeZoneName: "never" }) as Timestamp;
  } catch (cause) {
    throw new Error(`Not a feed timestamp: "${feedTimestamp}"`, { cause });
  }
}

/** The time the injected clock reads, as a Timestamp (to the second). */
export function formatPacific(instant: Date): Timestamp {
  const zoned = Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(PACIFIC);
  return zoned.toString({ timeZoneName: "never", smallestUnit: "second" }) as Timestamp;
}
