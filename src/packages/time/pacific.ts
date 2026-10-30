// Oregon keeps Pacific time, and so does the OLIS feed: its timestamps carry no offset and are read
// as Pacific local time (spec #1, "OLIS client"; docs/research/olis-odata.md section 6, inferred).
// Everything this service says about a time carries the Pacific offset in force at that moment.

const PACIFIC = "America/Los_Angeles";

/** An instant written as Pacific local time with its UTC offset, such as "2025-01-29T09:00:00-08:00". */
export type Timestamp = string & { readonly brand: "Timestamp" };

/** The time the injected clock reads, as a Timestamp (to the second). */
export function formatPacific(instant: Date): Timestamp {
  const zoned = Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(PACIFIC);
  return zoned.toString({ timeZoneName: "never", smallestUnit: "second" }) as Timestamp;
}
