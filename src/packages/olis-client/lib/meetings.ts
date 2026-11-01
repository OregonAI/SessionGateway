import { z } from "zod";
import type { SessionKey } from "#/packages/domain/index.ts";
import {
  agendaIdOf,
  committeeIdOf,
  meetingIdOf,
  type AgendaItem,
  type Committee,
  type Meeting,
} from "#/packages/domain/documents.ts";
import { sourceUrlOf } from "./documents.ts";
import { readSessionRows } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

const meetingRow = z.looseObject({
  SessionKey: z.string(),
  CommitteeCode: z.string(),
  MeetingDate: feedTimestamp,
  AgendaUrl: z.string().nullable(),
  AgendaRevisionNumber: z.number().int().nullish(),
  MeetingStatus: z.string(),
});

/** Every committee meeting of the Session, each with its agenda document when the feed links one. */
export async function readMeetings(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<Meeting[]> {
  const rows = await readSessionRows(options, "CommitteeMeetings", session, meetingRow, signal);
  return rows.map((row) => {
    const id = meetingIdOf(session, row.CommitteeCode, row.MeetingDate);
    const committeeId = committeeIdOf(session, row.CommitteeCode);
    const agendaId = agendaIdOf(session, row.CommitteeCode, row.MeetingDate);
    const provenance = `CommitteeMeetings ${row.CommitteeCode} ${row.MeetingDate}`;
    return {
      session,
      committeeCode: row.CommitteeCode,
      id,
      committeeId,
      at: row.MeetingDate,
      status: row.MeetingStatus,
      agenda:
        row.AgendaUrl === null
          ? null
          : {
              id: agendaId,
              nodeId: agendaId,
              kind: "agenda",
              label: "Agenda",
              agendaRevision: row.AgendaRevisionNumber ?? 0,
              sourceUrl: sourceUrlOf(row.AgendaUrl),
              postedAt: null,
              date: row.MeetingDate,
              relations: [
                { relation: "meeting", to: id, meaning: null, provenance },
                { relation: "committee", to: committeeId, meaning: null, provenance },
              ],
            },
    };
  });
}

const committeeRow = z.looseObject({
  SessionKey: z.string(),
  CommitteeCode: z.string(),
  CommitteeName: z.string(),
});

/** Every committee of the Session. */
export async function readCommittees(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<Committee[]> {
  const rows = await readSessionRows(options, "Committees", session, committeeRow, signal);
  return rows.map((row) => ({
    session,
    code: row.CommitteeCode,
    id: committeeIdOf(session, row.CommitteeCode),
    name: row.CommitteeName,
  }));
}

// The feed spells the committee property `CommitteCode` ("Committe", one e short) on agenda items
// (docs/research/olis-odata.md section 8, gotcha 1). `PrintOrder` is a string ("1", "10").
const agendaItemRow = z.looseObject({
  SessionKey: z.string(),
  CommitteeAgendaItemId: z.number().int(),
  CommitteCode: z.string(),
  MeetingDate: feedTimestamp,
  MeasurePrefix: z.string().nullable(),
  MeasureNumber: z.number().int().nullable(),
  MeetingType: z.string().nullable(),
  Action: z.string().nullable(),
  PrintOrder: z.string().nullable(),
  Comments: z.string().nullable(),
  BoardName: z.string().nullable(),
  ExecutiveAppointee: z.string().nullable(),
});

/** Every agenda item of every committee meeting of the Session. */
export async function readAgendaItems(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<AgendaItem[]> {
  const rows = await readSessionRows(options, "CommitteeAgendaItems", session, agendaItemRow, signal);
  return rows.map((row) => ({
    itemId: row.CommitteeAgendaItemId,
    meetingId: meetingIdOf(session, row.CommitteCode, row.MeetingDate),
    measure:
      row.MeasurePrefix === null || row.MeasureNumber === null
        ? null
        : { session, prefix: row.MeasurePrefix, number: row.MeasureNumber },
    meetingType: row.MeetingType,
    action: row.Action,
    printOrder: row.PrintOrder,
    comments: row.Comments,
    boardName: row.BoardName,
    executiveAppointee: row.ExecutiveAppointee,
  }));
}
