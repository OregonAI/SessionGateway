import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import type { SearchIndexReader } from "#/packages/database/search.ts";
import { documentKinds, type AmendmentId, type DocumentId } from "#/packages/domain/documents.ts";
import { measureIdOf, parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";
import { matchExpressionOf, snippetOf, termsOf } from "#/packages/search/text.ts";
import type { SearchFilter } from "#/packages/database/search.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";

/** The most hits one call returns, when the call does not say, and the most it may ask for (spec #1; docs/adr/0025). */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

/** How many passages each side of the search puts forward before the two are fused (docs/adr/0025). */
const CANDIDATE_PASSAGES = 200;

export const searchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      'What to look for: a question in your own words, or words from the document, or a citation such as "HB 3131", "SB 69-2" or "ORS 468.130".',
    ),
  measure: z
    .string()
    .optional()
    .describe(
      'Only documents of this Measure: its id, such as "measure-2025r1-sb69", or its citation, such as "SB 69". Testimony is included when a Measure is given.',
    ),
  include_testimony: z
    .boolean()
    .optional()
    .describe(
      "Whether Testimony may be returned. It is left out of a general search, so that thousands of letters do not crowd out Versions, and included when this is true or when the search is scoped to one Measure.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`How many hits to return, at most. ${DEFAULT_LIMIT} by default, ${MAX_LIMIT} at most.`),
});

const hit = z.object({
  id: z
    .string()
    .describe(
      "The hit's id, which get_document takes: a document's, or for a Proposed Amendment the amendment's, such as amendment-2025r1-sb69-2.",
    ),
  document_id: z
    .string()
    .describe(
      "The document whose text matched. It is id, except for a Proposed Amendment, where it is the posting whose text matched.",
    ),
  kind: z.enum(documentKinds).describe("What the document is."),
  title: z.string().describe('What to call it, such as "SB 64 Introduced".'),
  measure: z.string().nullable().describe("The id of the Measure it belongs to, when it belongs to one."),
  date: z
    .string()
    .nullable()
    .describe(
      "The date it is filed under, in Pacific time with its UTC offset: the start of the meeting it was posted to or for, else when OLIS created its row.",
    ),
  snippet: z.string().describe("About 300 characters of the passage that matched."),
  source_url: z.string().describe("Where the Legislature publishes the document."),
  found_by: z
    .array(z.enum(["keyword", "embedding"]))
    .describe("How it was found: by its words, by the meaning of its passages, or both."),
});

export const searchOutput = z.object({
  query: z.string().describe("The query that was searched."),
  results: z.array(hit).describe("The hits, best first."),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type SearchOutput = z.infer<typeof searchOutput>;

export type SearchDeps = {
  reader: IndexReader;
  searchIndex: SearchIndexReader;
};

/** An unknown Measure is an expected outcome, so it is a value; the MCP edge decides it is a tool error. */
export type SearchResult =
  | { kind: "found"; search: SearchOutput }
  | { kind: "unknown_measure"; reference: string; session: SessionKey };

export function search(deps: SearchDeps, session: SessionKey, input: z.infer<typeof searchInput>): SearchResult {
  const asOf = deps.reader.asOf(session);
  if (asOf === undefined) throw new Error(`The index holds no completed full pull of ${session} to date it by`);
  const limit = input.limit ?? DEFAULT_LIMIT;
  const terms = termsOf(input.query);
  const match = matchExpressionOf(terms, []);
  const measure = input.measure === undefined ? undefined : parseMeasureReference(input.measure, session);
  if (input.measure !== undefined && (measure === undefined || deps.reader.findMeasure(measure) === undefined)) {
    return { kind: "unknown_measure", reference: input.measure, session };
  }
  // Testimony is left out unless the call asks for it or the search is scoped to one Measure (spec #1 story 11).
  const filter: SearchFilter = {
    session,
    withTestimony: input.include_testimony === true || measure !== undefined,
    ...(measure === undefined ? {} : { measure: measureIdOf(measure) }),
  };
  const passages = match === undefined ? [] : deps.searchIndex.keyword(match, filter, CANDIDATE_PASSAGES);
  // One hit for each document id a hit carries, at the best passage that matched it.
  const best = new Map<DocumentId | AmendmentId, (typeof passages)[number]>();
  for (const passage of passages) if (!best.has(passage.nodeId)) best.set(passage.nodeId, passage);
  const results = [...best.values()].slice(0, limit).map((passage): SearchOutput["results"][number] => {
    const details = deps.searchIndex.details(passage);
    return {
      id: details.nodeId,
      document_id: details.documentId,
      kind: details.kind,
      title: details.title,
      measure: details.measureId,
      date: details.date,
      snippet: snippetOf(details.passageText, terms),
      source_url: details.sourceUrl,
      found_by: ["keyword"],
    };
  });
  return { kind: "found", search: { query: input.query, results, as_of: asOf, notice: NON_OFFICIAL_NOTICE } };
}
