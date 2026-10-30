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
import { citationTermOf, matchExpressionOf, phraseOf, snippetOf, termsOf } from "#/packages/search/text.ts";
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
  notes: z
    .array(z.string())
    .describe(
      'What the search found nothing for, in words: a citation in the query that names nothing the index holds ("SB 69-3" when the amendment was never posted). No hit is then an exact match for it. Empty when there is nothing to say.',
    ),
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

type FoundBy = "citation" | "keyword" | "embedding";
/** The order `found_by` lists how a hit was found in. */
const foundByOrder: readonly FoundBy[] = ["citation", "keyword", "embedding"];

/** The id a hit carries: a document's, or for a posting its Proposed Amendment's. */
type HitId = DocumentId | AmendmentId;

/** A document a hit is made from, the passage its snippet is cut from, and how it was found. */
type Candidate = {
  documentId: DocumentId;
  passageId: number | null;
  /** Where the citation that named the document starts in its text, when a citation did. */
  citedAt?: number;
  foundBy: Set<FoundBy>;
};

/** What the call's arguments mean for the index: or the reason they can't be met. */
function filterOf(
  deps: SearchDeps,
  session: SessionKey,
  input: z.infer<typeof searchInput>,
): { kind: "filter"; filter: SearchFilter } | Exclude<SearchResult, { kind: "found" }> {
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
  return {
    kind: "filter",
    filter: {
      session,
      // Testimony is left out unless the call asks for it, or for it by kind, or the search is scoped to one
      // Measure (spec #1 story 11).
      withTestimony: input.include_testimony === true || input.kind === "testimony" || measure !== undefined,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(measure === undefined ? {} : { measure: measureIdOf(measure) }),
      ...(committee === undefined ? {} : { committee: committee.id }),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
    },
  };
}

/** What the query names exactly, in the order it names it, each document once (docs/adr/0025, "Exact citations come first"). */
function citedCandidates(
  index: SearchIndexReader,
  citations: readonly Citation[],
  filter: SearchFilter,
): Map<HitId, Candidate> {
  const cited = new Map<HitId, Candidate>();
  for (const citation of citations) {
    for (const found of documentsCitedBy(index, citation, filter)) {
      if (cited.has(found.nodeId)) continue;
      cited.set(found.nodeId, {
        documentId: found.documentId,
        passageId: found.passageId,
        ...(found.citedAt === undefined ? {} : { citedAt: found.citedAt }),
        foundBy: new Set(["citation"]),
      });
    }
  }
  return cited;
}

/** The documents whose passages match the words, best first, each at its best passage. */
function keywordCandidates(
  index: SearchIndexReader,
  match: string | undefined,
  filter: SearchFilter,
): Map<HitId, Candidate> {
  const found = new Map<HitId, Candidate>();
  if (match === undefined) return found;
  for (const passage of index.keyword(match, filter, CANDIDATE_PASSAGES)) {
    if (found.has(passage.nodeId)) continue;
    found.set(passage.nodeId, {
      documentId: passage.documentId,
      passageId: passage.passageId,
      foundBy: new Set(["keyword"]),
    });
  }
  return found;
}

/**
 * The documents whose passages are nearest the question in meaning, nearest first, each at its nearest
 * passage. A query with no keywords besides its citations has no meaning to look for, and an index with no
 * vectors has nothing to look in, so neither embeds the question.
 */
async function embeddingCandidates(
  deps: SearchDeps,
  query: string,
  terms: readonly string[],
  filter: SearchFilter,
): Promise<Map<HitId, Candidate>> {
  const found = new Map<HitId, Candidate>();
  if (terms.length === 0) return found;
  const vectors = deps.vectors.current();
  if (vectors.index.size === 0) return found;
  const question = quantizeUnitVector(await deps.embedder.embedQuestion(query));
  const near = vectors.index.nearest(
    question,
    (documentIndex) => acceptsDocument(filter, vectors.documents.facts[documentIndex] as DocumentFacts),
    CANDIDATE_PASSAGES,
  );
  for (const passage of near) {
    const nodeId = vectors.documents.nodeIds[passage.documentIndex] as HitId;
    if (found.has(nodeId)) continue;
    found.set(nodeId, {
      documentId: vectors.documents.documentIds[passage.documentIndex] as DocumentId,
      passageId: passage.passageId,
      foundBy: new Set(["embedding"]),
    });
  }
  return found;
}

/**
 * The hits in order: what a citation names exactly first, then the keyword and meaning rankings fused by
 * reciprocal rank fusion. A hit's snippet is cut from the passage the words matched, else the one the meaning
 * matched, and it says every way it was found.
 */
function orderedCandidates(
  cited: ReadonlyMap<HitId, Candidate>,
  byKeyword: ReadonlyMap<HitId, Candidate>,
  byEmbedding: ReadonlyMap<HitId, Candidate>,
): Candidate[] {
  const ranked = new Map<HitId, Candidate>(cited);
  for (const id of reciprocalRankFusion([[...byKeyword.keys()], [...byEmbedding.keys()]])) {
    const sides = [byKeyword.get(id), byEmbedding.get(id)].filter(
      (candidate): candidate is Candidate => candidate !== undefined,
    );
    const already = ranked.get(id);
    if (already !== undefined) {
      for (const side of sides) for (const how of side.foundBy) already.foundBy.add(how);
      continue;
    }
    const [first] = sides;
    if (first === undefined) continue;
    ranked.set(id, {
      documentId: first.documentId,
      passageId: first.passageId,
      foundBy: new Set(sides.flatMap((side) => [...side.foundBy])),
    });
  }
  return [...ranked.values()];
}

export async function search(
  deps: SearchDeps,
  session: SessionKey,
  input: z.infer<typeof searchInput>,
): Promise<SearchResult> {
  const asOf = deps.reader.asOf(session);
  if (asOf === undefined) throw new Error(`The index holds no completed full pull of ${session} to date it by`);
  const resolved = filterOf(deps, session, input);
  if (resolved.kind !== "filter") return resolved;
  const filter = resolved.filter;

  const citations = findCitations(input.query, session);
  // A citation's own words and numbers are the citation's, not keywords: "3" of "SB 69-3" matches the margin
  // numbers of a PDF's lines. The citation is looked for as a whole (exact hits, and its words in order).
  const withoutCitations = citations.reduce((text, citation) => text.replaceAll(citation.text, " "), input.query);
  const terms = termsOf(withoutCitations);
  const cited = citedCandidates(deps.searchIndex, citations, filter);
  const byKeyword = keywordCandidates(deps.searchIndex, matchExpressionOf(terms, citations.map(phraseOf)), filter);
  const byEmbedding = await embeddingCandidates(deps, input.query, terms, filter);
  const citationTerms = citations.map(citationTermOf);

  const results = orderedCandidates(cited, byKeyword, byEmbedding)
    .slice(0, input.limit ?? DEFAULT_LIMIT)
    .map((candidate): SearchOutput["results"][number] => {
      const details = deps.searchIndex.details(candidate);
      return {
        id: details.nodeId,
        document_id: details.documentId,
        kind: details.kind,
        title: details.title,
        measure: details.measureId,
        date: details.date,
        // A hit that a citation named is shown round the citation; any other round the words that matched.
        snippet: snippetOf(details.passageText, candidate.foundBy.has("citation") ? citationTerms : terms),
        source_url: details.sourceUrl,
        found_by: foundByOrder.filter((how) => candidate.foundBy.has(how)),
      };
    });
  const notes = citations.filter((citation) => !indexHolds(deps, session, citation)).map(unplacedCitationNote);
  return { kind: "found", search: { query: input.query, results, notes, as_of: asOf, notice: NON_OFFICIAL_NOTICE } };
}

/**
 * Whether the index holds the item a citation names, whatever the filters say: the Measure, the Proposed
 * Amendment (a stored posting of it), or a document whose text names the ORS section.
 */
function indexHolds(deps: SearchDeps, session: SessionKey, citation: Citation): boolean {
  const unfiltered: SearchFilter = { session, withTestimony: true };
  switch (citation.kind) {
    case "measure":
      return deps.reader.findMeasure(citation.measure) !== undefined;
    case "amendment":
      return deps.searchIndex.postingOf(citation.id, unfiltered) !== undefined;
    case "ors":
      return deps.searchIndex.citing(citation.id, unfiltered, 1).length > 0;
    default:
      return citation satisfies never;
  }
}

/** What the result says of a citation the index holds nothing for: which one, and that no hit is an exact match. */
function unplacedCitationNote(citation: Citation): string {
  switch (citation.kind) {
    case "measure":
      return `The index has no Measure "${citation.text}", so no hit is an exact match for it.`;
    case "amendment":
      return `The index has no Proposed Amendment "${citation.text}", so no hit is an exact match for it.`;
    case "ors":
      return `No document in the index names "${citation.text}", so no hit is an exact match for it.`;
    default:
      return citation satisfies never;
  }
}

/**
 * The documents a citation names exactly (docs/adr/0025, "Citations"): a Measure's Versions, from Introduced to
 * Enrolled; a Proposed Amendment's latest posting; and for an ORS section the documents whose whole text holds
 * the citation, oldest first. Only those that pass the filter.
 */
function documentsCitedBy(index: SearchIndexReader, citation: Citation, filter: SearchFilter): CitedDocument[] {
  switch (citation.kind) {
    case "measure":
      return index.versionsOf(citation.id, filter);
    case "amendment": {
      const posting = index.postingOf(citation.id, filter);
      return posting === undefined ? [] : [posting];
    }
    case "ors":
      // The index read the citations of each document's whole text when the worker stored it.
      return index.citing(citation.id, filter, MAX_LIMIT);
    default:
      return citation satisfies never;
  }
}
