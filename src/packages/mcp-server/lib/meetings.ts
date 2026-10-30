import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { olisMeetingPageUrlOf } from "#/packages/domain/documents.ts";
import { measureIdOf, parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";
import { formatPacific, isAtOrAfter } from "#/packages/time/pacific.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";

export const meetingsInput = z.object({
  measure: z
    .string()
    .optional()
    .describe(
      'Only meetings with an agenda item about this Measure: its id, such as "measure-2025r1-sb69", or its citation, such as "SB 69".',
    ),
  committee: z
    .string()
    .optional()
    .describe('Only meetings of this committee: its code, such as "SLB", or its id, such as "committee-2025r1-slb".'),
  from: z.iso.date().optional().describe("Only meetings on this date or later, as a Pacific date such as 2025-01-21."),
  to: z.iso
    .date()
    .optional()
    .describe("Only meetings on this date or earlier, as a Pacific date such as 2025-01-28. The whole day counts."),
});

/**
 * The most meetings one call returns. A meeting with its agenda items and documents runs to a few thousand
 * characters, and one meeting of the 2025R1 feed has 70 agenda items and another 99 documents, so an
 * unbounded range would overflow an agent's context (the reason `get_document` serves parts).
 */
export const MAX_MEETINGS = 25;

const meetingOutput = z.object({
  id: z.string().describe("The meeting's id, such as meeting-2025r1-slb-2025-01-30-0800."),
  committee: z.object({
    id: z.string().describe("The committee's id, such as committee-2025r1-slb."),
    code: z.string().describe("The committee's code as OLIS writes it, such as SLB."),
    name: z.string().describe("The committee's name."),
  }),
  at: z.string().describe("When the meeting starts, in Pacific time with its UTC offset."),
  status: z.string().describe('What OLIS says of the meeting: "Scheduled", "Cancelled" or "No Meeting Scheduled".'),
  upcoming: z.boolean().describe("True when the meeting starts at or after the time in `now`."),
  olis_page_url: z
    .string()
    .describe(
      "The meeting's page on OLIS, where its agenda, documents and recording are. This service links it and never opens it.",
    ),
  agenda: z
    .object({
      id: z.string().describe("The agenda's id, such as agenda-2025r1-slb-2025-01-30-0800. Give it to get_document."),
      label: z.string().describe("What OLIS calls it: Agenda."),
      source_url: z.string().describe("Where the Legislature publishes the file."),
      fetched: z
        .boolean()
        .describe(
          "True when this index holds the file, so get_document serves the id. False when OLIS lists it but the file is not here yet (a failed or not yet reached fetch): source_url is where to read it, and get_document does not know the id until a later pull fetches it.",
        ),
    })
    .nullable()
    .describe("The meeting's agenda document, when OLIS links one."),
  agenda_items: z
    .array(
      z.object({
        print_order: z.string().nullable().describe('The item\'s place on the agenda, as OLIS writes it ("1", "10").'),
        measure_id: z.string().nullable().describe("The Measure the item is about, when it is about one."),
        meeting_type: z
          .string()
          .nullable()
          .describe('What the committee does with the item: "Public Hearing", "Work Session"...'),
        action: z
          .string()
          .nullable()
          .describe('What the committee did: "Heard", "Heard and Reported Out with Amendments"... Null before it has.'),
        comments: z
          .string()
          .nullable()
          .describe("OLIS's text for the item, as published. It can hold HTML tags, tabs and line breaks."),
        board_name: z.string().nullable().describe("For an executive appointment: the board."),
        executive_appointee: z.string().nullable().describe("For an executive appointment: the appointee."),
      }),
    )
    .describe("The meeting's agenda items, in print order. They are the meeting's, not only the Measure asked for."),
  exhibits: z
    .array(
      z.object({
        id: z.string().describe("The Exhibit's id, such as exhibit-2025r1-288650. Give it to get_document."),
        label: z
          .string()
          .describe(
            'What kind of Exhibit OLIS says it is: "Meeting Material", "Preliminary SMS", "Witness Registration"...',
          ),
        title: z
          .string()
          .nullable()
          .describe(
            'OLIS\'s title for the Exhibit, as published, such as "SB 69  -2 Preliminary SMS": what tells one Exhibit from another.',
          ),
        measure_id: z.string().nullable().describe("The Measure OLIS files the Exhibit under, when it names one."),
        source_url: z.string().describe("Where the Legislature publishes the file."),
        fetched: z
          .boolean()
          .describe(
            "True when this index holds the file, so get_document serves the id. False when OLIS lists it but the file is not here yet (a failed or not yet reached fetch): source_url is where to read it, and get_document does not know the id until a later pull fetches it.",
          ),
      }),
    )
    .describe(
      "The Exhibits OLIS lists for this meeting, whichever Measure they are filed under, fetched or not (see `fetched`).",
    ),
  recording_logs: z
    .array(
      z.object({
        id: z
          .string()
          .describe("The Recording Log's id, such as recording-log-2025r1-288741. Give it to get_document."),
        label: z.string().describe("What OLIS calls it: Recording Log."),
        source_url: z.string().describe("Where the Legislature publishes the file."),
        fetched: z
          .boolean()
          .describe(
            "True when this index holds the file, so get_document serves the id. False when OLIS lists it but the file is not here yet (a failed or not yet reached fetch): source_url is where to read it, and get_document does not know the id until a later pull fetches it.",
          ),
      }),
    )
    .describe(
      "The committee's timecoded index of the meeting's recording: agenda items, motions, votes and speakers. Empty before OLIS lists one, and sometimes more than one.",
    ),
  proposed_amendments: z
    .array(
      z.object({
        id: z
          .string()
          .describe("The Proposed Amendment's id, such as amendment-2025r1-sb69-2. Give it to get_document."),
        number: z.string().describe('Its number, such as "-2" or "-A3".'),
        measure_id: z.string().describe("The Measure it would amend."),
        meaning: z
          .string()
          .nullable()
          .describe("What the committee did with it at this meeting: Proposed, Adopted, Combined or Recommended."),
        document_id: z
          .string()
          .describe("The posting: the document with the text posted to this meeting. Give it to get_document."),
        source_url: z.string().describe("Where the Legislature publishes the posted file."),
        fetched: z
          .boolean()
          .describe(
            "True when this index holds the file, so get_document serves the id. False when OLIS lists it but the file is not here yet (a failed or not yet reached fetch): source_url is where to read it, and get_document does not know the id until a later pull fetches it.",
          ),
      }),
    )
    .describe(
      "The Proposed Amendments OLIS lists as posted to this meeting, by Measure and number, fetched or not (see `fetched`, which is about the posting's file, `document_id`).",
    ),
});

export const meetingsOutput = z.object({
  now: z.string().describe("The time that `upcoming` is measured from, in Pacific time with its UTC offset."),
  meetings: z
    .array(meetingOutput)
    .describe(
      `The meetings that match, earliest first: the first ${MAX_MEETINGS} when more match (see \`truncated\`).`,
    ),
  matching_meetings: z.number().describe(`How many meetings match, including any past the first ${MAX_MEETINGS}.`),
  truncated: z
    .boolean()
    .describe("True when more meetings match than `meetings` holds. Narrow the question with from and to."),
  next_meeting_id: z
    .string()
    .nullable()
    .describe(
      'The first meeting among all that match that is upcoming and whose status is "Scheduled", or null when there is none. When `truncated` is true it may not be in `meetings`: ask again with from set to its date.',
    ),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type MeetingsOutput = z.infer<typeof meetingsOutput>;

/** Unknown references and empty questions are expected outcomes, so they are values; the MCP edge decides they are tool errors. */
export type MeetingsResult =
  | { kind: "found"; meetings: MeetingsOutput }
  | { kind: "unknown_measure"; reference: string; session: SessionKey }
  | { kind: "unknown_committee"; reference: string; session: SessionKey }
  | { kind: "no_filter" }
  | { kind: "backwards_range"; from: string; to: string };

export function meetings(
  reader: IndexReader,
  session: SessionKey,
  now: Date,
  input: z.infer<typeof meetingsInput>,
): MeetingsResult {
  if (
    input.measure === undefined &&
    input.committee === undefined &&
    input.from === undefined &&
    input.to === undefined
  ) {
    return { kind: "no_filter" };
  }
  if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
    return { kind: "backwards_range", from: input.from, to: input.to };
  }
  const measure = input.measure === undefined ? undefined : parseMeasureReference(input.measure, session);
  if (input.measure !== undefined && (measure === undefined || reader.findMeasure(measure) === undefined)) {
    return { kind: "unknown_measure", reference: input.measure, session };
  }
  const committee = input.committee === undefined ? undefined : reader.findCommittee(session, input.committee);
  if (input.committee !== undefined && committee === undefined) {
    return { kind: "unknown_committee", reference: input.committee, session };
  }
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds meetings of ${session} but no completed full pull to date them by`);
  }
  const found = reader
    .findMeetings(session, {
      ...(measure === undefined ? {} : { measure }),
      ...(committee === undefined ? {} : { committeeCode: committee.code }),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
    })
    .map((meeting) => ({
      ...meeting,
      upcoming: isAtOrAfter(meeting.at, now),
    }));
  return {
    kind: "found",
    meetings: {
      now: formatPacific(now),
      meetings: found.slice(0, MAX_MEETINGS).map((meeting) => {
        const contents = reader.meetingContents(meeting.id);
        return {
          id: meeting.id,
          committee: meeting.committee,
          at: meeting.at,
          status: meeting.status,
          upcoming: meeting.upcoming,
          olis_page_url: olisMeetingPageUrlOf(session, meeting.committee.code, meeting.at),
          agenda:
            contents.agenda === null
              ? null
              : {
                  id: contents.agenda.id,
                  label: contents.agenda.label,
                  source_url: contents.agenda.sourceUrl,
                  fetched: contents.agenda.fetched,
                },
          agenda_items: contents.agendaItems.map((item) => ({
            print_order: item.printOrder,
            measure_id: item.measure === null ? null : measureIdOf(item.measure),
            meeting_type: item.meetingType,
            action: item.action,
            comments: item.comments,
            board_name: item.boardName,
            executive_appointee: item.executiveAppointee,
          })),
          exhibits: contents.exhibits.map((exhibit) => ({
            id: exhibit.id,
            label: exhibit.label,
            title: exhibit.title,
            measure_id: exhibit.measureId,
            source_url: exhibit.sourceUrl,
            fetched: exhibit.fetched,
          })),
          recording_logs: contents.recordingLogs.map((log) => ({
            id: log.id,
            label: log.label,
            source_url: log.sourceUrl,
            fetched: log.fetched,
          })),
          proposed_amendments: contents.amendments.map((amendment) => ({
            id: amendment.id,
            number: amendment.number,
            measure_id: amendment.measureId,
            meaning: amendment.meaning,
            document_id: amendment.documentId,
            source_url: amendment.sourceUrl,
            fetched: amendment.fetched,
          })),
        };
      }),
      matching_meetings: found.length,
      truncated: found.length > MAX_MEETINGS,
      next_meeting_id: found.find((meeting) => meeting.upcoming && meeting.status === "Scheduled")?.id ?? null,
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}

/** What an agent is told when no committee matches, so it can correct the call. */
export function unknownCommitteeMessage(reference: string, session: SessionKey): string {
  return `No committee "${reference}" in the ${session} Session. Give a committee code such as SLB or a committee id such as committee-${session.toLowerCase()}-slb.`;
}

/** What an agent is told when it asks for meetings without saying which. */
export const NO_FILTER_MESSAGE =
  "Give a Measure, a committee or a date range (measure, committee, from, to). Without one, the answer would be every meeting of the Session.";

/** What an agent is told when a date range ends before it starts. */
export function backwardsRangeMessage(from: string, to: string): string {
  return `The date range runs backwards: from ${from} is after to ${to}. Give a from that is on or before to.`;
}
