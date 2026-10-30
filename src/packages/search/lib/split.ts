import { createHash } from "node:crypto";
import type { Passage } from "#/packages/domain/search.ts";

/** What splitting needs of the embedder: how many tokens a text is, and how many a passage may hold. */
export type TokenMeter = {
  countTokens(text: string): number;
  maxPassageTokens: number;
};

type Span = { start: number; end: number };

/** The sha256 of a passage's text as UTF-8, in lower-case hex. */
export function hashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The lines of a text, each with the line break that ends it; the last may have none. */
function linesOf(text: string): Span[] {
  const lines: Span[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline + 1;
    lines.push({ start, end });
    start = end;
  }
  return lines;
}

/** The words of a span, as runs of text between white space, with where each is in the text. */
function wordsOf(text: string, span: Span): Span[] {
  const words: Span[] = [];
  for (const match of text.slice(span.start, span.end).matchAll(/\S+/g)) {
    words.push({ start: span.start + match.index, end: span.start + match.index + match[0].length });
  }
  return words;
}

/**
 * How many UTF-16 code units of a word, from its start, are the longest prefix that is at most
 * `maxPassageTokens` tokens. The word is known to be longer than that, so the answer is shorter than the
 * word; it is at least one code point, and never ends between the halves of a surrogate pair.
 */
function longestPrefix(word: string, meter: TokenMeter): number {
  let best = isHighSurrogate(word.charCodeAt(0)) ? 2 : 1;
  let low = best;
  let high = word.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cut = isHighSurrogate(word.charCodeAt(middle - 1)) ? middle + 1 : middle;
    if (cut < word.length && meter.countTokens(word.slice(0, cut)) <= meter.maxPassageTokens) {
      best = Math.max(best, cut);
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Cuts a line that is longer than a passage may be. It is cut between its words, so that every piece is
 * at most `maxPassageTokens` tokens (a text's tokens are the sum of its words', because the model's
 * tokenizer splits at white space); a single word that is longer than that is cut inside, at the longest
 * prefix that fits.
 */
function cutLine(text: string, line: Span, meter: TokenMeter): Span[] {
  const pieces: Span[] = [];
  let pieceStart = -1;
  let pieceEnd = -1;
  let pieceTokens = 0;
  const close = (): void => {
    if (pieceStart >= 0) pieces.push({ start: pieceStart, end: pieceEnd });
    pieceStart = -1;
    pieceTokens = 0;
  };
  for (const word of wordsOf(text, line)) {
    let rest = word;
    for (;;) {
      const tokens = meter.countTokens(text.slice(rest.start, rest.end));
      if (tokens > meter.maxPassageTokens) {
        close();
        const length = longestPrefix(text.slice(rest.start, rest.end), meter);
        pieces.push({ start: rest.start, end: rest.start + length });
        rest = { start: rest.start + length, end: rest.end };
        continue;
      }
      if (pieceStart >= 0 && pieceTokens + tokens > meter.maxPassageTokens) close();
      if (pieceStart < 0) pieceStart = rest.start;
      pieceEnd = rest.end;
      pieceTokens += tokens;
      break;
    }
  }
  close();
  // The line's own break stays with its last piece.
  const last = pieces.at(-1);
  if (last !== undefined) last.end = line.end;
  return pieces;
}

/**
 * Cuts a document's text into passages of at most `maxPassageTokens` tokens, by the embedder's own count
 * (spec #1 module 9). A passage is whole lines, as many as fit, and ends where a line ends; a line that is
 * longer than a passage is cut between words (or inside a word that is longer than a passage). Passages
 * do not overlap, and a line that is nothing but white space starts none. The passages are slices of the
 * text, so what they hold is exactly what the document says.
 */
export function splitPassages(text: string, meter: TokenMeter): Passage[] {
  const spans: Span[] = [];
  let open: (Span & { tokens: number }) | undefined;
  const close = (): void => {
    if (open !== undefined) spans.push({ start: open.start, end: open.end });
    open = undefined;
  };
  for (const line of linesOf(text)) {
    const tokens = meter.countTokens(text.slice(line.start, line.end));
    if (tokens === 0) {
      if (open !== undefined) open.end = line.end;
      continue;
    }
    if (tokens > meter.maxPassageTokens) {
      close();
      const pieces = cutLine(text, line, meter);
      const tail = pieces.pop();
      spans.push(...pieces);
      if (tail !== undefined) {
        open = { ...tail, tokens: meter.countTokens(text.slice(tail.start, tail.end)) };
      }
      continue;
    }
    if (open !== undefined && open.tokens + tokens > meter.maxPassageTokens) close();
    open ??= { start: line.start, end: line.start, tokens: 0 };
    open.end = line.end;
    open.tokens += tokens;
  }
  close();
  return spans.map((span) => {
    const passageText = text.slice(span.start, span.end);
    return { start: span.start, end: span.end, text: passageText, hash: hashOf(passageText) };
  });
}
