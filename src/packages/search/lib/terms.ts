import type { Citation } from "#/packages/domain/citations.ts";
import { orsSectionCitationOf } from "#/packages/domain/oregonai.ts";

/** About how many characters a snippet holds (spec #1 story 13; docs/adr/0025). */
export const SNIPPET_CHARACTERS = 300;

/** Words that carry nothing a keyword search can use. A question's keywords are what is left. */
const stopWords: ReadonlySet<string> = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "if",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "so",
  "than",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "why",
  "will",
  "with",
]);

/** The most keywords one question puts to the keyword side: a longer question is cut. */
const MAX_TERMS = 24;

/**
 * The keywords of a question: its words in lower case, once each, in the order they come, without the
 * stop words and the one-letter words. A number is a keyword ("3131").
 */
export function termsOf(question: string): string[] {
  const terms: string[] = [];
  for (const match of question.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    if (word.length < 2 || stopWords.has(word) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length === MAX_TERMS) break;
  }
  return terms;
}

/** A word or phrase as an FTS5 string: in double quotes, so that nothing in it is syntax. */
function quoted(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * The FTS5 expression for the keyword side: a passage matches when it holds every one of the keywords, or
 * holds one of the phrases (a phrase is words next to each other, in order). Every keyword and not any
 * one: a question has words in it that the document has no need of, and a passage that holds one of
 * them is no evidence it is the answer; the embedding side is for the question that is not in the
 * document's words. Undefined when there is nothing to look for.
 */
export function matchExpressionOf(terms: readonly string[], phrases: readonly string[]): string | undefined {
  const parts = phrases.map((phrase) => quoted(phrase));
  if (terms.length > 0) parts.push(`(${terms.map((term) => quoted(term)).join(" AND ")})`);
  return parts.length === 0 ? undefined : parts.join(" OR ");
}

/**
 * About `SNIPPET_CHARACTERS` characters of a passage, starting a little before the first place one of the
 * keywords begins a word, with the passage's line breaks and runs of white space as single spaces, and an
 * ellipsis where the passage goes on. A passage with none of the keywords starts at its beginning.
 */
export function snippetOf(passage: string, terms: readonly string[]): string {
  // A PDF's extracted text starts with the numbers of its margin lines ("1 2 3 4 ..."), which are no part of a snippet.
  const flat = passage
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:\d{1,3} ){3,}/, "");
  const lower = flat.toLowerCase();
  let first = -1;
  for (const term of terms) {
    const found = new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").exec(lower);
    if (found !== null && (first === -1 || found.index < first)) first = found.index;
  }
  let start = first === -1 ? 0 : Math.max(0, first - Math.floor(SNIPPET_CHARACTERS / 4));
  // Begin at a word, not in the middle of one.
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    start = space === -1 || space - start > 30 ? start : space + 1;
  }
  let end = Math.min(flat.length, start + SNIPPET_CHARACTERS);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    end = space > start + SNIPPET_CHARACTERS / 2 ? space : end;
  }
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** The words a citation is written with in a document, for the keyword side: "hb 3131", "sb 69 2", "ors 468 130". */
export function phraseOf(citation: Citation): string {
  switch (citation.kind) {
    case "measure":
      return `${citation.measure.prefix.toLowerCase()} ${citation.measure.number}`;
    case "amendment":
      return `${citation.measure.prefix.toLowerCase()} ${citation.measure.number} ${citation.number.toLowerCase()}`;
    case "ors":
      return `ors ${orsSectionCitationOf(citation.id).toLowerCase().replaceAll(".", " ")}`;
    default:
      return citation satisfies never;
  }
}

/**
 * How a citation is written in a document, in lower case, for finding it in a passage: "hb 3131", "sb 69-2",
 * "ors 468.130". A snippet of a hit that a citation named is cut round it.
 */
export function citationTermOf(citation: Citation): string {
  switch (citation.kind) {
    case "measure":
      return `${citation.measure.prefix.toLowerCase()} ${citation.measure.number}`;
    case "amendment":
      return `${citation.measure.prefix.toLowerCase()} ${citation.measure.number}-${citation.number.toLowerCase()}`;
    case "ors":
      return `ors ${orsSectionCitationOf(citation.id).toLowerCase()}`;
    default:
      return citation satisfies never;
  }
}
