import { z } from "zod";
import type { SessionKey } from "#/packages/domain/index.ts";
import { agendaIdOf, committeeIdOf, meetingIdOf, type Meeting } from "#/packages/domain/documents.ts";
import { sourceUrlOf } from "./documents.ts";
import { readEntitySet } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";
import { feedTimestamp } from "./timestamps.ts";

const meetingRow = z.looseObject({
  SessionKey: z.string(),
  CommitteeCode: z.string(),
  MeetingDate: feedTimestamp,
  AgendaUrl: z.string().nullable(),
});

/** Every committee meeting of the Session, each with its agenda document when the feed links one. */
export async function readMeetings(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<Meeting[]> {
  const rows = await readEntitySet(options, "CommitteeMeetings", `SessionKey eq '${session}'`, meetingRow, signal);
  return rows
    .filter((row) => row.SessionKey === session)
    .map((row) => {
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
        agenda:
          row.AgendaUrl === null
            ? null
            : {
                id: agendaId,
                nodeId: agendaId,
                kind: "agenda",
                label: "Agenda",
                sourceUrl: sourceUrlOf(row.AgendaUrl),
                postedAt: null,
                relations: [
                  { relation: "meeting", to: id, meaning: null, provenance },
                  { relation: "committee", to: committeeId, meaning: null, provenance },
                ],
              },
      };
    });
}
