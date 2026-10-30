import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import {
  acceptsDocument,
  type CitedDocument,
  type DocumentFacts,
  type SearchFilter,
  type SearchIndexReader,
} from "#/packages/database/search.ts";
import { findCitations, type Citation } from "#/packages/domain/citations.ts";
import { documentKinds, type AmendmentId, type DocumentId } from "#/packages/domain/documents.ts";
import { measureIdOf, parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import { reciprocalRankFusion } from "#/packages/search/ranking.ts";
import { matchExpressionOf, orsCitationPattern, phraseOf, snippetOf, termsOf } from "#/packages/search/text.ts";
import { quantizeUnitVector } from "#/packages/search/vectors.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";
import type { VectorCache } from "./vector-cache.ts";

/** The most hits one call returns, when the call does not say, and the most it may ask for (spec #1; docs/adr/0025). */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

/**
 * How many passages each side of the search puts forward before the two are fused: ten for each of the most
 * hits a call may ask for, because one long document can hold dozens of the best passages and the hits are
 * documents (docs/adr/0025).
 */
const CANDIDATE_PASSAGES = 10 * MAX_LIMIT;

export const searchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      'What to look for: a question in your own words, or words from the document, or a citation such as "HB 3131", "SB 69-2" or "ORS 468.130".',
    ),
  kind: z
    .enum(documentKinds)
    .optional()
    .describe("Only documents of this kind. Asking for testimony includes Testimony, as include_testimony does."),
  measure: z
    .string()
    .optional()
    .describe(
      'Only documents of this Measure: its id, such as "measure-2025r1-sb69", or its citation, such as "SB 69". Testimony is included when a Measure is given.',
    ),
  committee: z
    .string()
    .optional()
    .describe(
      'Only documents of this committee (posted to it or of it): its code, such as "SLB", or its id, such as "committee-2025r1-slb".',
    ),
  from: z.iso
    .date()
    .optional()
    .describe(
      "Only documents dated on this date or later, as a Pacific date such as 2025-01-21. A document is dated by the meeting it was posted to or for, else by when OLIS created its row.",
    ),
  to: z.iso
    .date()
    .optional()
    .describe(
      "Only documents dated on this date or earlier, as a Pacific date such as 2025-01-28. The whole day counts.",
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
    .array(z.enum(["citation", "keyword", "embedding"]))
    .describe(
      "How it was found: named exactly by a citation in the query, by its words, by the meaning of its passages, or by several of these.",
    ),
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
  /** The vectors of the passages, in memory. */
  vectors: VectorCache;
  /** Embeds the question. */
  embedder: Embedder;
};

/** An unknown Measure is an expected outcome, so it is a value; the MCP edge decides it is a tool error. */
export type SearchResult =
  | { kind: "found"; search: SearchOutput }
  | { kind: "unknown_measure"; reference: string; session: SessionKey }
  | { kind: "unknown_committee"; reference: string; session: SessionKey }
  | { kind: "backwards_range"; from: string; to: string };

/** A passage or document a hit is made from, and how it was found. */
type Candidate = {
  documentId: DocumentId;
  passageId: number | null;
  foundBy: Set<FoundBy>;
};
type FoundBy = "citation" | "keyword" | "embedding";

export async function search(
  deps: SearchDeps,
  session: SessionKey,
  input: z.infer<typeof searchInput>,
): Promise<SearchResult> {
  const asOf = deps.reader.asOf(session);
  if (asOf === undefined) throw new Error(`The index holds no completed full pull of ${session} to date it by`);
  const limit = input.limit ?? DEFAULT_LIMIT;
  const measure = input.measure === undefined ? undefined : parseMeasureReference(input.measure, session);
  if (input.measure !== undefined && (measure === undefined || deps.reader.findMeasure(measure) === undefined)) {
    return { kind: "unknown_measure", reference: input.measure, session };
  }
  const committee = input.committee === undefined ? undefined : deps.reader.findCommittee(session, input.committee);
  if (input.committee !== undefined && committee === undefined) {
    return { kind: "unknown_committee", reference: input.committee, session };
  }
  if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
    return { kind: "backwards_range", from: input.from, to: input.to };
  }
  // Testimony is left out unless the call asks for it, or for it by kind, or the search is scoped to one
  // Measure (spec #1 story 11).
  const filter: SearchFilter = {
    session,
    withTestimony: input.include_testimony === true || input.kind === "testimony" || measure !== undefined,
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(measure === undefined ? {} : { measure: measureIdOf(measure) }),
    ...(committee === undefined ? {} : { committee: committee.id }),
    ...(input.from === undefined ? {} : { from: input.from }),
    ...(input.to === undefined ? {} : { to: input.to }),
  };

  // What the query names exactly comes first, in the order it names it (docs/adr/0025, "Citations").
  const citations = findCitations(input.query, session);
  const cited = new Map<DocumentId | AmendmentId, Candidate>();
  for (const citation of citations) {
    for (const found of documentsCitedBy(deps.searchIndex, citation, filter)) {
      if (!cited.has(found.nodeId)) {
        cited.set(found.nodeId, {
          documentId: found.documentId,
          passageId: found.passageId,
          foundBy: new Set(["citation"]),
        });
      }
    }
  }

  const terms = termsOf(input.query);
  const match = matchExpressionOf(terms, citations.map(phraseOf));
  const passages = match === undefined ? [] : deps.searchIndex.keyword(match, filter, CANDIDATE_PASSAGES);
  // One entry for each id a hit carries, at the best passage that matched it, best first.
  const byKeyword = new Map<DocumentId | AmendmentId, Candidate>();
  for (const passage of passages) {
    if (byKeyword.has(passage.nodeId)) continue;
    byKeyword.set(passage.nodeId, {
      documentId: passage.documentId,
      passageId: passage.passageId,
      foundBy: new Set(["keyword"]),
    });
  }

  // The meaning side. A query that is nothing but citations has no meaning to look for, and an index with no
  // vectors has nothing to look in, so neither embeds the question.
  const byEmbedding = new Map<DocumentId | AmendmentId, Candidate>();
  const withoutCitations = citations.reduce((text, citation) => text.replace(citation.text, " "), input.query);
  const vectors = deps.vectors.current();
  if (termsOf(withoutCitations).length > 0 && vectors.index.size > 0) {
    const question = quantizeUnitVector(await deps.embedder.embedQuestion(input.query));
    const near = vectors.index.nearest(
      question,
      (documentIndex) => acceptsDocument(filter, vectors.documents.facts[documentIndex] as DocumentFacts),
      CANDIDATE_PASSAGES,
    );
    for (const passage of near) {
      const nodeId = vectors.documents.nodeIds[passage.documentIndex] as DocumentId | AmendmentId;
      if (byEmbedding.has(nodeId)) continue;
      byEmbedding.set(nodeId, {
        documentId: vectors.documents.documentIds[passage.documentIndex] as DocumentId,
        passageId: passage.passageId,
        foundBy: new Set(["embedding"]),
      });
    }
  }

  // The two sides become one list by reciprocal rank fusion; what a citation names exactly comes before it.
  const ranked = new Map<DocumentId | AmendmentId, Candidate>(cited);
  for (const nodeId of reciprocalRankFusion([[...byKeyword.keys()], [...byEmbedding.keys()]])) {
    const sides = [byKeyword.get(nodeId), byEmbedding.get(nodeId)].filter(
      (candidate): candidate is Candidate => candidate !== undefined,
    );
    const already = ranked.get(nodeId);
    for (const side of sides) for (const how of side.foundBy) already?.foundBy.add(how);
    // The passage a snippet is cut from is the one the words matched, else the one the meaning matched.
    if (already === undefined) {
      const [first] = sides;
      ranked.set(nodeId, {
        documentId: (first as Candidate).documentId,
        passageId: (first as Candidate).passageId,
        foundBy: new Set(sides.flatMap((side) => [...side.foundBy])),
      });
    }
  }
  const results = [...ranked.values()].slice(0, limit).map((candidate): SearchOutput["results"][number] => {
    const details = deps.searchIndex.details(candidate);
    return {
      id: details.nodeId,
      document_id: details.documentId,
      kind: details.kind,
      title: details.title,
      measure: details.measureId,
      date: details.date,
      snippet: snippetOf(details.passageText, terms),
      source_url: details.sourceUrl,
      found_by: [...candidate.foundBy],
    };
  });
  return { kind: "found", search: { query: input.query, results, as_of: asOf, notice: NON_OFFICIAL_NOTICE } };
}

/**
 * The documents a citation names exactly (docs/adr/0025, "Citations"): a Measure's Versions, from Introduced to
 * Enrolled; a Proposed Amendment's latest posting; and for an ORS section the documents whose text holds
 * the citation, best first. Only those that pass the filter.
 */
function documentsCitedBy(index: SearchIndexReader, citation: Citation, filter: SearchFilter): CitedDocument[] {
  switch (citation.kind) {
    case "measure":
      return index.versionsOf(citation.id, filter);
    case "amendment": {
      const posting = index.postingOf(citation.id, filter);
      return posting === undefined ? [] : [posting];
    }
    case "ors": {
      const exact = orsCitationPattern(citation.id);
      const documents = new Map<DocumentId | AmendmentId, CitedDocument>();
      // The keyword side finds the passages that hold the words in order; the pattern keeps those that
      // hold the citation and not a longer number.
      for (const passage of index.keyword(
        matchExpressionOf([], [phraseOf(citation)]) ?? "",
        filter,
        CANDIDATE_PASSAGES,
      )) {
        if (documents.has(passage.nodeId) || !exact.test(index.details(passage).passageText)) continue;
        documents.set(passage.nodeId, passage);
      }
      return [...documents.values()];
    }
    default:
      return citation satisfies never;
  }
}
