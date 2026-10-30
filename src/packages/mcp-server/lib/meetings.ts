import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";
import { formatPacific, isAtOrAfter } from "#/packages/time/pacific.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";

export const meetingsInput = z.object({
  measure: z.string().describe('A Measure\'s id, such as "measure-2025r1-sb69", or its citation, such as "SB 69".'),
});

const meetingOutput = z.object({
  id: z.string().describe("The meeting's id, such as meeting-2025r1-slb-2025-01-30-0800."),
  committee: z.object({
    id: z.string().describe("The committee's id, such as committee-2025r1-slb."),
    code: z.string().describe("The committee's code as OLIS writes it, such as SLB."),
    name: z.string().describe("The committee's name."),
  }),
  at: z.string().describe("When the meeting starts, in Pacific time with its UTC offset."),
  status: z
    .string()
    .describe(
      'What OLIS says of the meeting: "Scheduled", "Cancelled" or "No Meeting Scheduled". Check it before relying on a meeting.',
    ),
  upcoming: z.boolean().describe("True when the meeting starts at or after the time in `now`."),
});

export const meetingsOutput = z.object({
  now: z.string().describe("The time that `upcoming` is measured from, in Pacific time with its UTC offset."),
  meetings: z.array(meetingOutput).describe("The meetings that match, earliest first."),
  next_meeting_id: z
    .string()
    .nullable()
    .describe('The first meeting that is upcoming and whose status is "Scheduled", or null when there is none.'),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type MeetingsOutput = z.infer<typeof meetingsOutput>;

/** Unknown references are expected outcomes, so they are values; the MCP edge decides they are tool errors. */
export type MeetingsResult =
  { kind: "found"; meetings: MeetingsOutput } | { kind: "unknown_measure"; reference: string; session: SessionKey };

export function meetings(
  reader: IndexReader,
  session: SessionKey,
  now: Date,
  input: z.infer<typeof meetingsInput>,
): MeetingsResult {
  const measure = parseMeasureReference(input.measure, session);
  if (measure === undefined || reader.findMeasure(measure) === undefined) {
    return { kind: "unknown_measure", reference: input.measure, session };
  }
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds meetings of ${session} but no completed full pull to date them by`);
  }
  const found = reader.findMeetings(session, { measure }).map((meeting) => ({
    ...meeting,
    upcoming: isAtOrAfter(meeting.at, now),
  }));
  return {
    kind: "found",
    meetings: {
      now: formatPacific(now),
      meetings: found.map((meeting) => ({
        id: meeting.id,
        committee: meeting.committee,
        at: meeting.at,
        status: meeting.status,
        upcoming: meeting.upcoming,
      })),
      next_meeting_id: found.find((meeting) => meeting.upcoming && meeting.status === "Scheduled")?.id ?? null,
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}
