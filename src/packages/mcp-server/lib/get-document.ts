import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { documentKinds, parseDocumentReference, relations } from "#/packages/domain/documents.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";
import { splitIntoParts } from "./parts.ts";
import type { SessionKey } from "#/packages/domain/index.ts";

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
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type GetDocumentOutput = z.infer<typeof getDocumentOutput>;

/** An unknown document is an expected outcome, so it is a value; the MCP edge decides it is a tool error. */
export type GetDocumentResult =
  | { kind: "found"; document: GetDocumentOutput }
  | { kind: "unknown"; id: string; session: SessionKey }
  | { kind: "no_such_part"; id: string; part: number; partCount: number };

export function getDocument(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof getDocumentInput>,
): GetDocumentResult {
  const id = parseDocumentReference(input.id, session);
  const found = id === undefined ? undefined : reader.findDocument(id);
  if (id === undefined || found === undefined) return { kind: "unknown", id: input.id, session };
  const stored = found.document;
  const parts = splitIntoParts(stored.text);
  const part = input.part ?? 1;
  if (part > parts.length) return { kind: "no_such_part", id, part, partCount: parts.length };
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds documents of ${session} but no completed full pull to date them by`);
  }
  return {
    kind: "found",
    document: {
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
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}

/** What an agent is told when no document matches, so it can correct the call. */
export function unknownDocumentMessage(id: string, session: SessionKey): string {
  return `No document "${id}" in the ${session} Session. Give a document id such as version-${session.toLowerCase()}-sb69-a-engrossed.`;
}

/** What an agent is told when it asks for a part past the last one. */
export function noSuchPartMessage(id: string, part: number, partCount: number): string {
  const parts = partCount === 1 ? "1 part" : `${partCount} parts`;
  return `Document "${id}" has ${parts}, so there is no part ${part}. Ask for a part from 1 to ${partCount}.`;
}
