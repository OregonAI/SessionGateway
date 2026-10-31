import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import {
  acceptsDocument,
  type CitedDocument,
  type DocumentFacts,
  type SearchFilter,
  type SearchIndexReader,
  type UnlistedHolding,
} from "#/packages/database/search.ts";
import { findCitations, type Citation } from "#/packages/domain/citations.ts";
import { documentKinds, type AmendmentId, type DocumentId } from "#/packages/domain/documents.ts";
import { measureIdOf, type SessionKey } from "#/packages/domain/index.ts";
import type { Embedder } from "#/packages/embedder/index.ts";
import { reciprocalRankFusion } from "#/packages/search/ranking.ts";
import {
  citationTermOf,
  looseMatchExpressionOf,
  matchExpressionOf,
  phraseOf,
  snippetOf,
  termsOf,
} from "#/packages/search/text.ts";
import { quantizeUnitVector } from "#/packages/search/vectors.ts";
import { checkFilters, parseAgencyArgument, type FilterFault, type NotAnAgencyId } from "./filters.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";
import type { VectorCache } from "./vector-cache.ts";

/** The most hits one call returns, when the call does not say, and the most it may ask for (spec #1; ADR-0025). */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

/**
 * How many passages each side of the search puts forward before the two are fused: ten for each of the most
 * hits a call may ask for, because one long document can hold dozens of the best passages and the hits are
 * documents (ADR-0025).
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
  agency: z
    .string()
    .optional()
    .describe(
      'Only documents of Measures that have an Agency Link, of any evidence, to this Agency: its slug in the OregonAI agency registry, such as "bureau-of-labor-and-industries". A document that belongs to no Measure (an agenda, a Recording Log) is left out.',
    ),
  include_testimony: z
    .boolean()
    .optional()
    .describe(
      'Whether Testimony may be returned. It is left out of a general search, so that thousands of letters do not crowd out Versions, and included when this is true, when the search is scoped to one Measure with measure, when the query says "testimony", or when the query cites exactly one Measure ("HB 3131"; the search is not filtered to it).',
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
export type SearchResult = { kind: "found"; search: SearchOutput } | FilterFault | NotAnAgencyId;

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

/**
 * Whether Testimony may be returned (ADR-0006: "General searches leave Testimony out unless the question asks for it
 * or is about one Measure"; spec #1 story 11). The call asks for it with `include_testimony`, or with `kind:
 * "testimony"`, or scopes the search to one Measure with `measure`. The question asks for it when it holds the word
 * "testimony", in any case (or "testimonies"), and is about one Measure when it cites exactly one that the index
 * holds ("HB 3131" once): such a question is scoped to that Measure for this rule only, and is not filtered to it.
 */
function allowsTestimony(
  deps: SearchDeps,
  input: z.infer<typeof searchInput>,
  measureGiven: boolean,
  citations: readonly Citation[],
): boolean {
  if (input.include_testimony === true || input.kind === "testimony" || measureGiven) return true;
  if (/\btestimon(?:y|ies)\b/i.test(input.query)) return true;
  const measures = citations.flatMap((citation) => (citation.kind === "measure" ? [citation.measure] : []));
  const [only] = measures;
  return measures.length === 1 && only !== undefined && deps.reader.findMeasure(only) !== undefined;
}

/** What the call's arguments mean for the index: or the reason they can't be met. */
function filterOf(
  deps: SearchDeps,
  session: SessionKey,
  input: z.infer<typeof searchInput>,
  citations: readonly Citation[],
): { kind: "filter"; filter: SearchFilter } | Exclude<SearchResult, { kind: "found" }> {
  const checked = checkFilters(deps.reader, session, input);
  if (checked.kind !== "ok") return checked;
  const { measure, committee } = checked;
  return {
    kind: "filter",
    filter: {
      session,
      withTestimony: allowsTestimony(deps, input, measure !== undefined, citations),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(measure === undefined ? {} : { measure: measureIdOf(measure) }),
      ...(committee === undefined ? {} : { committee: committee.id }),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
    },
  };
}

/** What the query names exactly, in the order it names it, each document once (ADR-0025, "Exact citations come first"). */
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

/** The documents whose passages match an expression, best first, each at its best passage. */
function keywordCandidates(
  index: SearchIndexReader,
  match: string | undefined,
  filter: SearchFilter,
  keywordOnly: boolean,
): Map<HitId, Candidate> {
  const found = new Map<HitId, Candidate>();
  if (match === undefined) return found;
  for (const passage of index.keyword(match, filter, CANDIDATE_PASSAGES, keywordOnly)) {
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
 * What the words of the question find (ADR-0025, "Keyword side"): the documents with a passage that holds
 * every keyword, or a citation's phrase, and, as a ranking of their own, the keyword-only documents with a
 * passage that holds some of the keywords. A keyword-only document is never embedded, so a question with one
 * word it lacks would never find it; any other document needs all the words, because the meaning of its
 * passages is looked at too, and a generic word ("power", "program") that a question shares with a long
 * document is no evidence that it is the answer.
 */
function keywordRankings(
  index: SearchIndexReader,
  terms: readonly string[],
  phrases: readonly string[],
  filter: SearchFilter,
): { everyWord: Map<HitId, Candidate>; someWords: Map<HitId, Candidate> } {
  const everyWord = keywordCandidates(index, matchExpressionOf(terms, phrases), filter, false);
  const someWords = keywordCandidates(index, looseMatchExpressionOf(terms), filter, true);
  for (const id of everyWord.keys()) someWords.delete(id);
  return { everyWord, someWords };
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
 * The hits in order: what a citation names exactly first, then the three rankings fused by reciprocal rank
 * fusion: the documents that hold every keyword, the documents nearest the question in meaning, and the
 * keyword-only documents that hold some of the keywords. Equal scores come in that order, so a keyword-only
 * document that shares a word with the question does not outrank a document found by meaning at the same rank.
 * A hit's snippet is cut from the passage the words matched, else the one the meaning matched, and it says every
 * way it was found.
 */
function orderedCandidates(
  cited: ReadonlyMap<HitId, Candidate>,
  byEveryWord: ReadonlyMap<HitId, Candidate>,
  byEmbedding: ReadonlyMap<HitId, Candidate>,
  bySomeWords: ReadonlyMap<HitId, Candidate>,
): Candidate[] {
  const ranked = new Map<HitId, Candidate>(cited);
  for (const id of reciprocalRankFusion([[...byEveryWord.keys()], [...byEmbedding.keys()], [...bySomeWords.keys()]])) {
    const sides = [byEveryWord.get(id), byEmbedding.get(id), bySomeWords.get(id)].filter(
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
  const citations = findCitations(input.query, session);
  const resolved = filterOf(deps, session, input, citations);
  if (resolved.kind !== "filter") return resolved;
  const agency = input.agency === undefined ? undefined : parseAgencyArgument(input.agency);
  if (typeof agency === "object") return agency;
  const agencyMeasures =
    agency === undefined ? undefined : new Set(deps.reader.measuresWithAgencyLink(session, agency));
  const filter: SearchFilter = agencyMeasures === undefined ? resolved.filter : { ...resolved.filter, agencyMeasures };

  // A citation's own words and numbers are the citation's, not keywords: "3" of "SB 69-3" matches the margin
  // numbers of a PDF's lines. The citation is looked for as a whole (exact hits, and its words in order).
  const withoutCitations = citations.reduce((text, citation) => text.replaceAll(citation.text, " "), input.query);
  const terms = termsOf(withoutCitations);
  const cited = citedCandidates(deps.searchIndex, citations, filter);
  const byWords = keywordRankings(deps.searchIndex, terms, citations.map(phraseOf), filter);
  const byEmbedding = await embeddingCandidates(deps, input.query, terms, filter);
  const citationTerms = citations.map(citationTermOf);

  const results = orderedCandidates(cited, byWords.everyWord, byEmbedding, byWords.someWords)
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
  const notes = citations.flatMap((citation) => notesAbout(holdingOf(deps, session, citation), citation));
  if (agencyMeasures?.size === 0) notes.push(noAgencyLinkNote(input.agency?.trim() ?? ""));
  return { kind: "found", search: { query: input.query, results, notes, as_of: asOf, notice: NON_OFFICIAL_NOTICE } };
}

/**
 * What the index holds of the item a citation names, whatever the filters say: the Measure, the Proposed Amendment
 * (a stored posting of it), or a document whose text names the ORS section. An item the index holds and the feed no
 * longer lists is held, but search leaves it out (ADR-0030): it is a case of its own, with its own note, and not an
 * item the index lacks.
 */
type Holding = { kind: "listed" } | { kind: "absent" } | { kind: "unlisted"; note: string };

function holdingOf(deps: SearchDeps, session: SessionKey, citation: Citation): Holding {
  const unfiltered: SearchFilter = { session, withTestimony: true };
  switch (citation.kind) {
    case "measure":
      return deps.reader.findMeasure(citation.measure) === undefined ? { kind: "absent" } : { kind: "listed" };
    case "amendment": {
      if (deps.searchIndex.postingOf(citation.id, unfiltered) !== undefined) return { kind: "listed" };
      const held = deps.searchIndex.unlistedPostings(citation.id, session);
      return held === undefined
        ? { kind: "absent" }
        : { kind: "unlisted", note: unlistedAmendmentNote(citation, held) };
    }
    case "ors": {
      if (deps.searchIndex.citing(citation.id, unfiltered, 1).length > 0) return { kind: "listed" };
      const held = deps.searchIndex.unlistedCiting(citation.id, session);
      return held === undefined ? { kind: "absent" } : { kind: "unlisted", note: unlistedOrsNote(citation, held) };
    }
    default:
      return citation satisfies never;
  }
}

/** The notes a citation earns: none when the item is held and listed. */
function notesAbout(holding: Holding, citation: Citation): string[] {
  switch (holding.kind) {
    case "listed":
      return [];
    case "absent":
      return [unplacedCitationNote(citation)];
    case "unlisted":
      return [holding.note];
    default:
      return holding satisfies never;
  }
}

/** What the result says when the Agency filter names a slug no Agency Link in the index has. */
function noAgencyLinkNote(agency: string): string {
  return `The index holds no Agency Link to ${agency}, so no hit has a Measure with one. Check the slug against the OregonAI agency registry.`;
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
 * What the result says of a Proposed Amendment the index holds and the feed no longer lists: its id, that
 * `get_document` still serves it, and when the feed last listed it. It never says the index has no such item.
 */
function unlistedAmendmentNote(citation: Extract<Citation, { kind: "amendment" }>, held: UnlistedHolding): string {
  return `The Proposed Amendment "${citation.text}" (${citation.id}) is in the index, but the Legislature's feed no longer lists it, so search leaves it out and no hit is an exact match for it. get_document still serves it; the feed last listed it ${held.latest.lastListedAt}.`;
}

/**
 * What the result says of an ORS section that only documents the feed no longer lists name: the section's id, how
 * many such documents the index holds, that `get_document` serves them, and when the feed last listed the latest.
 */
function unlistedOrsNote(citation: Extract<Citation, { kind: "ors" }>, held: UnlistedHolding): string {
  const only = held.count === 1;
  const documents = only ? "1 document that names it and is" : `${held.count} documents that name it and are`;
  const latest = only ? "it" : `the latest of them, ${held.latest.documentId},`;
  return `No document the feed lists names "${citation.text}" (${citation.id}), so no hit is an exact match for it. The index still holds ${documents} no longer listed: get_document serves ${only ? "it" : "them"}, and ${latest} was last listed ${held.latest.lastListedAt}.`;
}

/**
 * The documents a citation names exactly (ADR-0025, "Exact citations come first"): a Measure's Versions, from Introduced to
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
