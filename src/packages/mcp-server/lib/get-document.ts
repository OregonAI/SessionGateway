import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";
import type { SessionKey } from "#/packages/domain/index.ts";

export const getDocumentInput = z.object({
  id: z.string().describe('A document\'s id, such as "version-2025r1-sb69-a-engrossed" or "testimony-2025r1-117165".'),
  part: z.number().int().min(1).optional().describe("Which part of the text to return, from 1. The first by default."),
});

const related = z.object({
  id: z.string().describe("The id of a node this document points at."),
  relation: z.enum(["measure", "committee", "meeting", "posted_to", "amendment"]).describe("How it points at it."),
});

export const getDocumentOutput = z.object({
  id: z.string().describe("The id that was asked for."),
  kind: z
    .enum([
      "version",
      "printed_amendment",
      "proposed_amendment",
      "analysis",
      "exhibit",
      "recording_log",
      "testimony",
      "agenda",
    ])
    .describe("What the document is."),
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
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type GetDocumentOutput = z.infer<typeof getDocumentOutput>;

/** An unknown document is an expected outcome, so it is a value; the MCP edge decides it is a tool error. */
export type GetDocumentResult =
  { kind: "found"; document: GetDocumentOutput } | { kind: "unknown"; id: string; session: SessionKey };

export function getDocument(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof getDocumentInput>,
): GetDocumentResult {
  const stored = reader.findDocument(input.id);
  if (stored === undefined) return { kind: "unknown", id: input.id, session };
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds documents of ${session} but no completed full pull to date them by`);
  }
  return {
    kind: "found",
    document: {
      id: input.id,
      kind: stored.kind,
      label: stored.label,
      source_url: stored.sourceUrl,
      retrieved_at: stored.retrievedAt,
      content_hash: stored.contentHash,
      page_count: stored.pageCount,
      has_text_layer: stored.hasTextLayer,
      part: 1,
      part_count: 1,
      text: stored.text,
      related: stored.relations.map((relation) => ({ id: relation.to, relation: relation.relation })),
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}

/** What an agent is told when no document matches, so it can correct the call. */
export function unknownDocumentMessage(id: string, session: SessionKey): string {
  return `No document "${id}" in the ${session} Session. Give a document id such as version-${session.toLowerCase()}-sb69-a-engrossed.`;
}
