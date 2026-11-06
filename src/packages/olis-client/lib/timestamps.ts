import { z } from "zod";
import { atPacificLocalTime, type Timestamp } from "#/packages/time/pacific.ts";

// The feed's timestamps are Edm.DateTime: a date and time with no offset, like "2024-12-31T13:18:07" or
// "2025-01-17T15:16:44.993", whose values appear to be Pacific local time (docs/research/olis-odata.md
// section 6; spec #1, "OLIS client"). Only this client knows that, so only it reads them.
const feedTimestampForm = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/**
 * A feed timestamp read as Pacific local time and exposed with its offset. A string in any other
 * form, an offset or a "Z" included, is refused: reading its clock digits as Pacific time would
 * shift the instant without a word.
 */
export const feedTimestamp = z.string().transform((text, context): Timestamp => {
  if (!feedTimestampForm.test(text)) {
    context.addIssue({
      code: "custom",
      message: "must be a date and time with no UTC offset, such as 2025-01-22T08:00:00",
    });
    return z.NEVER;
  }
  try {
    return atPacificLocalTime(Temporal.PlainDateTime.from(text));
  } catch {
    context.addIssue({ code: "custom", message: "must be a date and time that exist" });
    return z.NEVER;
  }
});

/** The `createdAt` of a record: the row's own `CreatedDate`, when the row has one, so a row without it has no `createdAt` at all (ADR-0056: it is shown). */
export function createdAtOf(createdDate: Timestamp | null | undefined): { createdAt?: Timestamp } {
  return createdDate === null || createdDate === undefined ? {} : { createdAt: createdDate };
}
