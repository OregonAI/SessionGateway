import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { olisMeetingPageUrlOf } from "#/packages/domain/documents.ts";
import { measureIdOf, parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";
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
    })
    .nullable()
    .describe("The meeting's agenda document, when OLIS links one and this index holds it."),
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
        measure_id: z.string().nullable().describe("The Measure OLIS files the Exhibit under, when it names one."),
        source_url: z.string().describe("Where the Legislature publishes the file."),
      }),
    )
    .describe("The Exhibits posted to this meeting, whichever Measure they are filed under."),
  recording_logs: z
    .array(
      z.object({
        id: z
          .string()
          .describe("The Recording Log's id, such as recording-log-2025r1-288741. Give it to get_document."),
        label: z.string().describe("What OLIS calls it: Recording Log."),
        source_url: z.string().describe("Where the Legislature publishes the file."),
      }),
    )
    .describe(
      "The committee's timecoded index of the meeting's recording: agenda items, motions, votes and speakers. Empty before it is posted, and sometimes more than one.",
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
      }),
    )
    .describe("The Proposed Amendments posted to this meeting, by Measure and number."),
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
      meetings: found.map((meeting) => {
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
              : { id: contents.agenda.id, label: contents.agenda.label, source_url: contents.agenda.sourceUrl },
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
            measure_id: exhibit.measureId,
            source_url: exhibit.sourceUrl,
          })),
          recording_logs: contents.recordingLogs.map((log) => ({
            id: log.id,
            label: log.label,
            source_url: log.sourceUrl,
          })),
          proposed_amendments: contents.amendments.map((amendment) => ({
            id: amendment.id,
            number: amendment.number,
            measure_id: amendment.measureId,
            meaning: amendment.meaning,
            document_id: amendment.documentId,
            source_url: amendment.sourceUrl,
          })),
        };
      }),
      next_meeting_id: found.find((meeting) => meeting.upcoming && meeting.status === "Scheduled")?.id ?? null,
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}
