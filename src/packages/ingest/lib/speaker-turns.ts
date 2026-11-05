// The speaker-turn index of a Recording Log (ticket #126, ADR-0052): the worker reads the file's link annotations, hands
// the text, the links and the Meeting's Agenda items to the Recording Log parser, and resolves each turn's speaker
// among the Meeting's committee members and then among all the Session's Legislators. A turn is never dropped: a speaker
// nobody resolves keeps its text, and a turn's Measure is kept only when the index holds it.
import type { IndexWriter } from "#/packages/database/writer.ts";
import { committeeIdOf, type DocumentLink, type MeetingId } from "#/packages/domain/documents.ts";
import { measureIdOf, type SessionKey } from "#/packages/domain/index.ts";
import type { SpeakerTurn, SpeakerTurnIndexOutcome } from "#/packages/domain/speaker-turns.ts";
import type { LegislatorResolver } from "#/packages/legislators/resolver.ts";
import { extractPdfLinks } from "#/packages/pdf-text/index.ts";
import {
  legislatorOfSpeaker,
  measureOfAgendaItem,
  parseRecordingLog,
  playerLinkOf,
} from "#/packages/recording-log/index.ts";

/** What reading a Recording Log needs besides its file: the store (the Meeting's Agenda items and committee) and who the codes are. */
export type SpeakerTurnContext = {
  session: SessionKey;
  writer: IndexWriter;
  resolver: LegislatorResolver;
};

/**
 * Reads a fetched Recording Log into its index. The Agenda items and the committee's members are the ones the store holds
 * for the log's Meeting and committee, which the pull stored before it fetched any file, so a full pull and an increment
 * read them the same way. A member's code is resolved through the Legislators rows and the alias file; a code that
 * names no Legislator (a task force's member) is no candidate.
 */
export async function readSpeakerTurnIndex(
  context: SpeakerTurnContext,
  link: DocumentLink,
  bytes: Uint8Array,
  text: string,
): Promise<SpeakerTurnIndexOutcome> {
  const extraction = await extractPdfLinks(bytes);
  if (extraction.kind === "unreadable") {
    // The text came from the same bytes, so this is a bug and not a file.
    throw new Error(`The links of ${link.id} (${link.sourceUrl}) could not be read: ${extraction.reason}`, {
      cause: extraction,
    });
  }
  const { links } = extraction;
  const meeting = link.relations.find((relation) => relation.relation === "meeting")?.to;
  const committee = link.relations.find((relation) => relation.relation === "committee")?.to;
  const agendaItems = meeting === undefined ? [] : context.writer.agendaItemsOfMeeting(meeting as MeetingId);
  const legislatorOfCode = new Map(context.resolver.codes.map(({ code, legislator }) => [code, legislator]));
  const sessionLegislators = context.resolver.codes.map(({ code, legislator }) => ({ code, name: legislator.name }));
  const heldMeasures = context.writer.heldMeasureIds(context.session);
  const members = context.writer
    .committeeMembers(context.session)
    .filter((member) => committeeIdOf(context.session, member.committeeCode) === committee)
    .flatMap((member) => {
      const legislator = legislatorOfCode.get(member.legislatorCode);
      return legislator === undefined ? [] : [{ code: member.legislatorCode, name: legislator.name }];
    });

  const parsed = parseRecordingLog({ text, links, agendaItems });
  switch (parsed.kind) {
    case "no-event-id":
      return { kind: "no_event_id" };
    case "conflicting-event-ids":
      return { kind: "conflicting_event_ids", eventIds: parsed.eventIds };
    case "parsed": {
      const turns = parsed.speakerTurns.map((turn): SpeakerTurn => {
        const code = legislatorOfSpeaker(turn.speaker, members, sessionLegislators);
        const named = measureOfAgendaItem(turn.agendaItem);
        const measureId = named === null ? null : measureIdOf({ session: context.session, ...named });
        const playerLink = playerLinkOf(links, parsed.eventId, turn.offsetSeconds);
        if (playerLink === null) {
          throw new Error(`${link.id} has an event ID and no player link for it`, {
            cause: { eventId: parsed.eventId, linkCount: links.length },
          });
        }
        return {
          timecode: turn.timecode,
          offsetSeconds: turn.offsetSeconds,
          offsetSource: turn.offsetSource,
          speaker: turn.speaker,
          legislatorCode: code,
          legislator: code === null ? null : (legislatorOfCode.get(code) ?? null),
          agendaItem: turn.agendaItem,
          // The Agenda item's text is kept either way; its Measure only when the index holds that Measure.
          measureId: measureId !== null && heldMeasures.has(measureId) ? measureId : null,
          playerLink,
        };
      });
      return { kind: "indexed", eventId: parsed.eventId, pagesReadByTimecode: parsed.pagesReadByTimecode, turns };
    }
    default:
      return parsed satisfies never;
  }
}
