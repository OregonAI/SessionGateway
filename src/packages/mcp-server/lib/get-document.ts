import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { documentKinds, parseDocumentReference, relations, type UnheldDocument } from "#/packages/domain/documents.ts";
import type { Outcome } from "./outcome.ts";
import { floorLetterDocumentOutput, floorLetterDocumentShown } from "./floor-letters.ts";
import { documentListingOutput, documentListingShown } from "./listing.ts";
import { splitIntoParts } from "./parts.ts";
import { splitLogWithTranscript } from "./transcript-parts.ts";
import { speakerTurnsOutput, speakerTurnsShown } from "./speaker-turns.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

export const getDocumentInput = z.object({
  id: z.string().describe('A document\'s id, such as "version-2025r1-sb69-a-engrossed" or "testimony-2025r1-117165".'),
  part: z.number().int().min(1).optional().describe("Which part of the text to return, from 1. The first by default."),
});

const related = z.object({
  id: z.string().describe("The id of a node this document points at."),
  relation: z
    .enum(relations)
    .describe(
      "How it points at it: the Measure, committee or meeting a document belongs to, the Version an analysis is of or a Printed Amendment amends, the meeting a Proposed Amendment was posted to, or the amendment a posting is of.",
    ),
  meaning: z
    .string()
    .nullable()
    .describe("For a posting: what the committee did with the amendment at that meeting, such as Proposed or Adopted."),
  document_id: z
    .string()
    .nullable()
    .describe("For a posting: the document with the text posted to that meeting, which may differ from the others."),
});

export const getDocumentOutput = z.object({
  id: z.string().describe("The id that was asked for, as the service writes ids: in lower case."),
  document_id: z
    .string()
    .describe(
      "The document whose text this is. It differs from id when id names a Proposed Amendment: then it is the latest posting.",
    ),
  kind: z.enum(documentKinds).describe("What the document is."),
  label: z.string().describe("The Legislature's own name for it, such as the version or the analysis type."),
  source_url: z.string().describe("Where the Legislature publishes the document."),
  retrieved_at: z.string().describe("When this service fetched it, in Pacific time with its UTC offset."),
  content_hash: z.string().describe("The sha256 of the file as the Legislature served it, in hex."),
  page_count: z.number().describe("How many pages the file has."),
  has_text_layer: z
    .boolean()
    .describe("False when the file has no text to read, as with a scan or a photograph: the text is then empty."),
  part: z.number().describe("Which part of the text this is."),
  part_count: z.number().describe("How many parts the text has."),
  text: z.string().describe("This part of the text, exactly as published, with a form feed between pages."),
  related: z.array(related).describe("The nodes this document points at."),
  floor_letter: floorLetterDocumentOutput,
  speaker_turns: speakerTurnsOutput,
  ...documentListingOutput,
});

export type GetDocumentOutput = z.infer<typeof getDocumentOutput>;

/** Why a call cannot be met. These are expected outcomes, so they are values; the envelope tells the agent they are tool errors. */
export type GetDocumentFault =
  | { kind: "unknown"; id: string; session: SessionKey }
  /** A Testimony the feed lists and the store has not fetched: a fact about the index, not a wrong id. */
  | { kind: "not_held"; id: string; session: SessionKey }
  /**
   * A Version the feed lists and the store holds no file of (ticket #116): the id is right, and nothing is known of
   * whether a later pull will fetch the file, so the answer says only that the row is listed and has no file.
   */
  | { kind: "listed_version_not_held"; id: string; session: SessionKey }
  /**
   * A row the feed no longer lists and the store never fetched the file of: the id is right, and no pull will
   * fetch the file now.
   */
  | { kind: "no_longer_listed_not_held"; id: string; session: SessionKey; lastListedAt: Timestamp }
  | { kind: "no_such_part"; id: string; part: number; partCount: number };

export type GetDocumentOutcome = Outcome<GetDocumentOutput, GetDocumentFault>;

export function getDocument(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof getDocumentInput>,
  /** The publication gate (ticket #134, ADR-0055): the Recording Log's machine transcript is shown only while it is on. */
  transcriptsPublished: boolean,
): GetDocumentOutcome {
  const id = parseDocumentReference(input.id, session);
  if (id === undefined) return { kind: "fault", fault: { kind: "unknown", id: input.id, session } };
  const found = reader.findDocument(id);
  if (found === undefined) return { kind: "fault", fault: { kind: "unknown", id: input.id, session } };
  switch (found.held) {
    case true:
      break;
    case false:
      return unheldResult(found, id, input.id, session);
    default:
      return found satisfies never;
  }
  const stored = found.document;
  const floorLetter = stored.kind === "floor_letter" ? reader.floorLetterDetails(stored.id) : undefined;
  const speakerTurns = stored.kind === "recording_log" ? reader.speakerTurnIndexOf(stored.id) : undefined;
  // Read only while the gate is on, so that with it off nothing of a transcript is read, let alone shown.
  const transcript =
    stored.kind === "recording_log" && transcriptsPublished ? reader.transcriptOfLog(stored.id) : undefined;
  // A log with a transcript is paged with it (ADR-0055): each part holds the transcript of the turns in that part, and no part
  // is over the part size because of transcript text. Any other document, and a log without one, is cut as its text alone.
  if (
    transcript !== undefined &&
    speakerTurns?.kind === "indexed" &&
    transcript.turns.length !== speakerTurns.turns.length
  ) {
    throw new Error(
      `The transcript of ${stored.id} has the passages of ${String(transcript.turns.length)} turns and the index has ${String(speakerTurns.turns.length)}`,
    );
  }
  const paged =
    transcript !== undefined && speakerTurns?.kind === "indexed"
      ? splitLogWithTranscript(stored.text, speakerTurns.turns, transcript)
      : undefined;
  const parts = paged === undefined ? splitIntoParts(stored.text) : paged.map((each) => each.text);
  const part = input.part ?? 1;
  if (part > parts.length) return { kind: "fault", fault: { kind: "no_such_part", id, part, partCount: parts.length } };
  return {
    kind: "answer",
    answer: {
      id,
      document_id: stored.id,
      kind: stored.kind,
      label: stored.label,
      source_url: stored.sourceUrl,
      retrieved_at: stored.retrievedAt,
      content_hash: stored.contentHash,
      page_count: stored.pageCount,
      has_text_layer: stored.hasTextLayer,
      part,
      part_count: parts.length,
      text: parts[part - 1] ?? "",
      related: found.related.map((node) => ({
        id: node.to,
        relation: node.relation,
        meaning: node.meaning,
        document_id: node.relation === "posted_to" ? node.documentId : null,
      })),
      ...(floorLetter === undefined ? {} : { floor_letter: floorLetterDocumentShown(floorLetter) }),
      ...(speakerTurns === undefined
        ? {}
        : { speaker_turns: speakerTurnsShown(speakerTurns, paged?.[part - 1]?.transcript) }),
      ...documentListingShown(found.listing),
    },
  };
}

/**
 * What an agent is told of an id the index holds no file of. A row the feed no longer lists is a fact whatever it is; a
 * listed Testimony is one the last pull could not store (ADR-0059); a listed Version is a listed row with no file; any other listed row
 * without a file is no id this index serves.
 */
function unheldResult(found: UnheldDocument, id: string, asked: string, session: SessionKey): GetDocumentOutcome {
  switch (found.listing.listed) {
    case false:
      return {
        kind: "fault",
        fault: { kind: "no_longer_listed_not_held", id, session, lastListedAt: found.listing.lastListedAt },
      };
    case true:
      if (found.testimony) return { kind: "fault", fault: { kind: "not_held", id, session } };
      // A Version's id is written "version-<session>-...": the id says the kind, as `parseDocumentReference` reads it.
      return id.startsWith("version-")
        ? { kind: "fault", fault: { kind: "listed_version_not_held", id, session } }
        : { kind: "fault", fault: { kind: "unknown", id: asked, session } };
    default:
      return found.listing satisfies never;
  }
}

/** What an agent is told when a call to get_document is a fault. */
export function getDocumentFaultMessage(fault: GetDocumentFault): string {
  switch (fault.kind) {
    case "unknown":
      return unknownDocumentMessage(fault.id, fault.session);
    case "not_held":
      return testimonyNotHeldMessage(fault.id, fault.session);
    case "listed_version_not_held":
      return listedVersionNotHeldMessage(fault.id, fault.session);
    case "no_longer_listed_not_held":
      return noLongerListedNotHeldMessage(fault.id, fault.session, fault.lastListedAt);
    case "no_such_part":
      return noSuchPartMessage(fault.id, fault.part, fault.partCount);
    default:
      return fault satisfies never;
  }
}

/** What an agent is told when no document matches, so it can correct the call. */
function unknownDocumentMessage(id: string, session: SessionKey): string {
  return `No document "${id}" in the ${session} Session. Give a document id such as version-${session.toLowerCase()}-sb69-a-engrossed.`;
}

/**
 * What an agent is told when the id is a Testimony that `testimony` lists but whose file the worker has not stored
 * (ADR-0059). The id is right. The cause is not stored where the server reads, so the answer says what is known and
 * promises nothing of a later pull.
 */
function testimonyNotHeldMessage(id: string, session: SessionKey): string {
  return `Testimony "${id}" is listed in the ${session} Session. This index does not hold its file: the last pull could not store it. OLIS may serve it empty or broken, or the request failed; the build report says which.`;
}

/** What an agent is told when the id is a Version the feed lists and the index holds no file of: the id is right. */
function listedVersionNotHeldMessage(id: string, session: SessionKey): string {
  return `The Version "${id}" is listed in the ${session} Session, and this index holds no file for it, so it holds no text for it.`;
}

/**
 * What an agent is told when the id is a row the feed no longer lists (two complete full pulls in a row did not list
 * it) and the store never fetched its file. The id is right, but no pull will fetch the file now, because the feed
 * does not list the row.
 */
function noLongerListedNotHeldMessage(id: string, session: SessionKey, lastListedAt: string): string {
  return `The document "${id}" was listed in the ${session} Session and is not any more (the feed last listed it ${lastListedAt}). This index never fetched its file, and no later pull will fetch it, because the Legislature's feed no longer lists it, so the index holds no text for it.`;
}

/** What an agent is told when it asks for a part past the last one. */
function noSuchPartMessage(id: string, part: number, partCount: number): string {
  const parts = partCount === 1 ? "1 part" : `${partCount} parts`;
  return `Document "${id}" has ${parts}, so there is no part ${part}. Ask for a part from 1 to ${partCount}.`;
}

/** Whether an answer holds the words of a machine-transcript passage, for the envelope's notice (ticket #134). */
export function getDocumentCarriesTranscript(answer: GetDocumentOutput): boolean {
  return (answer.speaker_turns?.transcript?.passage_count ?? 0) > 0;
}
