import type { OrsSectionId } from "#/packages/domain/statute-links.ts";
import { orsSectionIdOf } from "#/packages/domain/statute-links.ts";
import type { RangeExpander } from "./ranges.ts";
import { findSectionItems } from "./references.ts";

/**
 * One edit a Proposed Amendment makes to the measure's relating clause, the text that says what the
 * measure does to the statutes ("Relating to ...; amending ORS 409.711."). It is what the amendment
 * says, not the clause after the edit: what the amendment deletes is not worked out (ADR-0001).
 */
export type RelatingClauseEdit = {
  /** The words the amendment quotes as deleted, or null when it quotes none. */
  deleted: string | null;
  /** The lines it deletes without quoting their words, as it names them: "line 3", "lines 3 and 4", "the rest of the line". */
  deletedLines: string[];
  /** The words it inserts, or null when it only deletes. */
  inserted: string | null;
  /** The ORS sections the inserted words name, ranges expanded, each once, in order. */
  insertedSections: OrsSectionId[];
};

// Legislative Counsel writes the place of an edit on page 1 in a few forms:
//   "In line 2 of the printed bill, ..."
//   "On page 1 of the printed A-engrossed bill, line 2, ..."
//   "On page 1 of the printed bill, delete lines 3 and 4 and insert ..."  (the lines come with the edit)
// and the edits that follow on the same page start "In line 3, ...".
const firstPlace =
  /(?:In line (\d+) of the printed(?: [\w-]+)? bill,|On page 1,? of the printed(?: [\w-]+)? bill,(?: line (\d+),)?)\s+/g;
const nextPlace = /\s*In line (\d+),\s+/y;

// What an edit does, in the words Legislative Counsel uses. An edit is read only when every word of its
// sentence is one of these, so an instruction this does not know is left out whole, not half read.
const anchor = /(?:after|before) (?:the (?:first|second) )?(?:“[^”]{0,200}”|the period|the semicolon),?\s+/y;
const deleteWords = /delete “([^”]{0,2000})”/y;
const lineNames = String.raw`(lines? \d+(?: (?:and|through) \d+)?)`;
const deleteRestOfLine = new RegExp(String.raw`delete (the rest of the line)(?: and (?:delete )?${lineNames})?`, "y");
const deleteLines = new RegExp(String.raw`delete ${lineNames}`, "y");
const insertWords = /insert “([^”]{0,2000})”/y;
const insertPunctuation = /insert a (comma|semicolon)/y;
const joiner = / and /y;

/** What the clause reads before the amendment's edits that follow it: "Delete lines 5 through 25" starts the body at line 5. */
const bodyStart = /\s*(?:On page 1,? of the printed(?: [\w-]+)? bill, )?[Dd]elete lines (\d+) through \d+/y;
/** Without a body start, the clause is read as far as line 3: the amendment does not say how long it is. */
const defaultLastLine = 3;

type Operation = {
  deleted: string | null;
  deletedLines: string[];
  inserted: string | null;
};

/** One thing a sentence does, and where it ends. An insertion says whether the sentence named a place for it. */
type Step =
  | { type: "delete"; deleted: string | null; deletedLines: string[]; end: number }
  | { type: "insert"; inserted: string; end: number };

type Sentence = { operations: Operation[]; lines: number[]; end: number };

function matchAt(pattern: RegExp, text: string, index: number): RegExpExecArray | null {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

/** The line numbers in phrases such as "lines 3 and 4" and "line 3". */
function linesOf(names: string[]): number[] {
  return names.flatMap((name) => [...name.matchAll(/\d+/g)].map((digits) => Number(digits[0])));
}

/** Reads one deletion or insertion at the index, or undefined if the words there are not one. */
function readStep(text: string, index: number): Step | undefined {
  const words = matchAt(deleteWords, text, index);
  if (words?.[1] !== undefined) {
    return { type: "delete", deleted: words[1], deletedLines: [], end: index + words[0].length };
  }
  const rest = matchAt(deleteRestOfLine, text, index);
  if (rest?.[1] !== undefined) {
    const deletedLines = rest[2] === undefined ? [rest[1]] : [rest[1], rest[2]];
    return { type: "delete", deleted: null, deletedLines, end: index + rest[0].length };
  }
  const lines = matchAt(deleteLines, text, index);
  if (lines?.[1] !== undefined) {
    return { type: "delete", deleted: null, deletedLines: [lines[1]], end: index + lines[0].length };
  }
  const insertion = matchAt(insertWords, text, index);
  if (insertion?.[1] !== undefined) return { type: "insert", inserted: insertion[1], end: index + insertion[0].length };
  const punctuation = matchAt(insertPunctuation, text, index);
  if (punctuation?.[1] !== undefined) {
    return { type: "insert", inserted: punctuation[1] === "comma" ? "," : ";", end: index + punctuation[0].length };
  }
  return undefined;
}

/** Reads the operations of one sentence from the index to its full stop, or undefined if any of it is not understood. */
function readSentence(text: string, start: number): Sentence | undefined {
  const operations: Operation[] = [];
  const named: string[] = [];
  let index = start;
  for (;;) {
    const anchored = matchAt(anchor, text, index);
    index += anchored?.[0].length ?? 0;
    const step = readStep(text, index);
    if (step === undefined) return undefined;
    const previous = operations.at(-1);
    if (step.type === "delete") {
      operations.push({ deleted: step.deleted, deletedLines: step.deletedLines, inserted: null });
      named.push(...step.deletedLines);
    } else if (anchored === null && previous !== undefined && previous.inserted === null && isDeletion(previous)) {
      // "delete X and insert Y" is one edit; "delete X and after Z insert Y" is two.
      previous.inserted = step.inserted;
    } else {
      operations.push({ deleted: null, deletedLines: [], inserted: step.inserted });
    }
    index = step.end;
    if (text[index] === ".") return { operations, lines: linesOf(named), end: index + 1 };
    const next = matchAt(joiner, text, index);
    if (next === null) return undefined;
    index += next[0].length;
  }
}

function isDeletion(operation: Operation): boolean {
  return operation.deleted !== null || operation.deletedLines.length > 0;
}

/** The last line of the relating clause the amendment shows: two before the first line of the body it deletes. */
function lastClauseLine(text: string, index: number): number {
  const body = matchAt(bodyStart, text, index);
  return body?.[1] === undefined ? defaultLastLine : Number(body[1]) - 2;
}

function insertedSectionsOf(inserted: string | null, expandRange: RangeExpander): OrsSectionId[] {
  const sections = new Set<OrsSectionId>();
  for (const item of inserted === null ? [] : findSectionItems(inserted)) {
    if (item.type === "chapter") continue;
    const named = item.type === "range" ? expandRange(item.from, item.to) : [orsSectionIdOf(item.citation)];
    for (const id of named) if (id !== undefined) sections.add(id);
  }
  return [...sections];
}

/** A sentence of edits on page 1 and the line it names, which for "delete lines 3 and 4" is the first line deleted. */
type PlacedSentence = { sentence: Sentence; line: number };

/** The edits that follow one another on page 1, from the first place on: each sentence parsed, and where the last ends. */
function readChain(text: string, place: RegExpExecArray): { sentences: PlacedSentence[]; end: number } | undefined {
  const first = readSentence(text, place.index + place[0].length);
  const firstLine = Number(place[1] ?? place[2] ?? first?.lines[0]);
  if (first === undefined) return undefined;
  const sentences: PlacedSentence[] = [{ sentence: first, line: firstLine }];
  let end = first.end;
  for (let next = matchAt(nextPlace, text, end); next !== null; next = matchAt(nextPlace, text, end)) {
    const sentence = readSentence(text, next.index + next[0].length);
    if (sentence === undefined) break;
    sentences.push({ sentence, line: Number(next[1]) });
    end = sentence.end;
  }
  return { sentences, end };
}

/**
 * Reads the relating clause edits of a Proposed Amendment's normalized text, in order: the edits on
 * page 1, from line 2 to the last line of the clause (see `lastClauseLine`).
 */
export function readRelatingClauseEdits(text: string, expandRange: RangeExpander): RelatingClauseEdit[] {
  const edits: RelatingClauseEdit[] = [];
  let readUpTo = 0;
  for (const place of text.matchAll(firstPlace)) {
    if (place.index < readUpTo) continue;
    const chain = readChain(text, place);
    if (chain === undefined) continue;
    readUpTo = chain.end;
    const last = lastClauseLine(text, chain.end);
    for (const { sentence, line } of chain.sentences) {
      if ([line, ...sentence.lines].some((number) => !(number >= 2 && number <= last))) continue;
      for (const operation of sentence.operations) {
        edits.push({ ...operation, insertedSections: insertedSectionsOf(operation.inserted, expandRange) });
      }
    }
  }
  return edits;
}
