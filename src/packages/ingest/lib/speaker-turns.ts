// The speaker-turn index of a Recording Log (ticket #126, ADR-0052): the worker reads the file's link annotations, hands
// the text, the links and the Meeting's Agenda items to the Recording Log parser, and resolves each turn's speaker
// among the Meeting's committee members and then among all the Session's Legislators. A turn is never dropped: a speaker
// nobody resolves keeps its text, and a turn's Measure is kept only when the index holds it.
import type { IndexWriter, RecordingLogCopy } from "#/packages/database/writer.ts";
import { committeeIdOf, type DocumentId, type DocumentLink, type MeetingId } from "#/packages/domain/documents.ts";
import { measureIdOf, type SessionKey } from "#/packages/domain/index.ts";
import type { SpeakerTurn, SpeakerTurnIndexOutcome } from "#/packages/domain/speaker-turns.ts";
import type { LegislatorResolver } from "#/packages/legislators/resolver.ts";
import { extractPdfLinks, LINK_ANNOTATIONS_READER_VERSION, linkAnnotationsOf } from "#/packages/pdf-text/index.ts";
import {
  headerNamesMeeting,
  legislatorOfSpeaker,
  measureOfAgendaItem,
  parseRecordingLog,
  playerLinkOf,
  recordingLogHeaderOf,
  SPEAKER_TURN_INDEX_READER_VERSION,
} from "#/packages/recording-log/index.ts";

/** What reading a Recording Log needs besides its file: the store (the Meeting's Agenda items and committee) and who the codes are. */
export type SpeakerTurnContext = {
  session: SessionKey;
  writer: IndexWriter;
  resolver: LegislatorResolver;
};

/**
 * Reads a fetched Recording Log into its index, after storing the link annotations the file holds. The Agenda items and the committee's members are the ones the store holds
 * for the log's Meeting and committee, which the pull stored before it fetched any file, so a full pull and an increment
 * read them the same way. A member's code is resolved through the Legislators rows and the alias file; a code that
 * names no Legislator (a task force's member) is no candidate.
 */
export async function readSpeakerTurnIndex(
  context: SpeakerTurnContext,
  link: DocumentLink,
  bytes: Uint8Array,
  text: string,
  /**
   * What else to store from the file. The annotations are stored unless `annotations` is false: a log fetched again only for its
   * index, whose annotations the current reader made already, keeps them (ticket #187, ADR-0066).
   */
  reading: { annotations: boolean } = { annotations: true },
): Promise<SpeakerTurnIndexOutcome> {
  const extraction = await extractPdfLinks(bytes);
  if (extraction.kind === "unreadable") {
    // The text came from the same bytes, so this is a bug and not a file.
    throw new Error(`The links of ${link.id} (${link.sourceUrl}) could not be read: ${extraction.reason}`, {
      cause: extraction,
    });
  }
  const { links } = extraction;
  // The annotations are stored as the file's read gave them, before the parser derives anything from them (ticket #160,
  // ADR-0058): they are a source the index is not, so a question's expected value can name them and not the index under test.
  if (reading.annotations) {
    context.writer.storeLinkAnnotations(link.id, linkAnnotationsOf(links), LINK_ANNOTATIONS_READER_VERSION);
  }
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

/**
 * Reads a fetched Recording Log's link annotations again and stores them with the current reader's version, and stores nothing
 * else (ticket #187, ADR-0066): the log's index, its Passages cut around the turns, its items' Measures and its Meeting's
 * transcripts are as they were, because they are made by readers of their own and a bump of this one makes none of them again.
 */
export async function rereadLinkAnnotations(
  context: Pick<SpeakerTurnContext, "writer">,
  link: DocumentLink,
  bytes: Uint8Array,
): Promise<void> {
  const extraction = await extractPdfLinks(bytes);
  if (extraction.kind === "unreadable") {
    // The text came from the same bytes, so this is a bug and not a file.
    throw new Error(`The links of ${link.id} (${link.sourceUrl}) could not be read: ${extraction.reason}`, {
      cause: extraction,
    });
  }
  context.writer.storeLinkAnnotations(link.id, linkAnnotationsOf(extraction.links), LINK_ANNOTATIONS_READER_VERSION);
}

/**
 * Sets aside the Recording Logs that are another Meeting's (ticket #177, owner decision of 2026-11-10): where OLIS filed one file
 * (the same `content_hash`) under more than one Meeting, a copy is indexed only under the Meeting its own header names, its
 * committee and its start time (`headerNamesMeeting`). Every other copy gets the `log_of_another_meeting` outcome, which has no
 * turns, so it gives no hearing and no transcript; when no copy's header names its Meeting, none is indexed. A file filed under
 * one Meeting only is read as before, whatever its header says. It runs after the run's logs are read, so the order the copies
 * arrive in does not matter, and it fetches nothing.
 */
export function setAsideCopiesOfOtherMeetings(writer: IndexWriter, session: SessionKey): void {
  for (const copy of writer.recordingLogCopies(session)) {
    if (copy.outcome === "log_of_another_meeting") continue;
    const header = recordingLogHeaderOf(copy.text);
    if (header !== null && headerNamesMeeting(header, copy)) continue;
    writer.storeSpeakerTurnIndex({
      documentId: copy.id,
      outcome: { kind: "log_of_another_meeting" },
      readerVersion: SPEAKER_TURN_INDEX_READER_VERSION,
    });
  }
}

/** The build report's entry for a log set aside as another Meeting's: where it is filed, its header and the other copies. */
export function copyGapsOf(
  copies: readonly RecordingLogCopy[],
): Map<DocumentId, { meetingId: MeetingId; header: string | null; sameFileAs: RecordingLogCopy[] }> {
  return new Map(
    copies.map((copy) => {
      const header = recordingLogHeaderOf(copy.text);
      return [
        copy.id,
        {
          meetingId: copy.meetingId,
          header: header === null ? null : `${header.committee} ${header.time}`,
          sameFileAs: copies.filter((other) => other.contentHash === copy.contentHash && other.id !== copy.id),
        },
      ];
    }),
  );
}
