/**
 * One thing an "ORS ..." reference names: a section as printed ("659A.162"), a range of sections
 * ("418.806 to 418.816", both ends as printed), or a whole chapter ("657B").
 */
export type OrsItem =
  | { type: "section"; citation: string }
  | { type: "range"; from: string; to: string }
  | { type: "chapter"; chapter: string };

/** An "ORS ..." reference found in running text: where it starts and ends, and what it names. */
export type OrsReference = { start: number; end: number; items: OrsItem[] };

const orsWord = /\bORS\s+/g;
const chapterWord = /chapters?\s+/y;
const chapterNumber = /(\d{1,3}[A-Z]?)(?!\d|\.\d)/y;
const sectionNumber = /(\d{1,3}[A-Z]?\.\d{3,4})(?!\d)/y;
const subsections = /(?:\s*\([A-Za-z0-9]{1,3}\))*/y;
const rangeWord = /\s+to\s+/y;
// "A, B", "A and B", "A, and B", "A or B": what Legislative Counsel puts between list items.
const listSeparator = /\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+/y;

// A chapter list is "A, B or C": Legislative Counsel puts no comma before "and" or "or". A comma
// before them ("ORS chapter 183, and 30 days after notice") ends the list.
const chapterListSeparator = /\s*,(?!\s*(?:and|or)\b)\s*|\s+(?:and|or)\s+/y;
// A number of days or weeks is a quantity, not one more chapter ("ORS chapter 659A or 12 weeks of leave").
const quantityUnit = /\s+(?:(?:calendar|business|working) )?(?:days?|weeks?|months?|years?|hours?|percent)\b/y;

function matchAt(pattern: RegExp, text: string, index: number): RegExpExecArray | null {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

/** Reads the "(3)" and "(1)(b)" after a section. Returns where the section reference ends. */
function skipSubsections(text: string, index: number): number {
  return index + (matchAt(subsections, text, index)?.[0].length ?? 0);
}

/** Reads one section or one range of sections at the index. Returns the item and where it ends. */
function readSectionItem(text: string, index: number): { item: OrsItem; end: number } | undefined {
  const first = matchAt(sectionNumber, text, index);
  if (first?.[1] === undefined) return undefined;
  const afterFirst = skipSubsections(text, index + first[0].length);
  const to = matchAt(rangeWord, text, afterFirst);
  if (to !== null) {
    const last = matchAt(sectionNumber, text, afterFirst + to[0].length);
    if (last?.[1] !== undefined) {
      const end = skipSubsections(text, afterFirst + to[0].length + last[0].length);
      return { item: { type: "range", from: first[1], to: last[1] }, end };
    }
  }
  return { item: { type: "section", citation: first[1] }, end: afterFirst };
}

/** After "ORS ": a list of sections and ranges ("A, B to C and D"). */
function readSectionList(text: string, index: number): { items: OrsItem[]; end: number } | undefined {
  const first = readSectionItem(text, index);
  if (first === undefined) return undefined;
  const items = [first.item];
  let end = first.end;
  for (;;) {
    const separator = matchAt(listSeparator, text, end);
    if (separator === null) break;
    const next = readSectionItem(text, end + separator[0].length);
    if (next === undefined) break;
    items.push(next.item);
    end = next.end;
  }
  return { items, end };
}

/** After "ORS chapter ": a list of chapters ("652, 653 or 659A"). */
function readChapterList(text: string, index: number): { items: OrsItem[]; end: number } | undefined {
  const first = matchAt(chapterNumber, text, index);
  if (first?.[1] === undefined) return undefined;
  const items: OrsItem[] = [{ type: "chapter", chapter: first[1] }];
  let end = index + first[0].length;
  for (;;) {
    const separator = matchAt(chapterListSeparator, text, end);
    if (separator === null) break;
    const next = matchAt(chapterNumber, text, end + separator[0].length);
    if (next?.[1] === undefined) break;
    if (matchAt(quantityUnit, text, end + separator[0].length + next[0].length) !== null) break;
    items.push({ type: "chapter", chapter: next[1] });
    end = end + separator[0].length + next[0].length;
  }
  return { items, end };
}

/** Finds every "ORS ..." reference in the text, in order. An "ORS" that names no section or chapter is skipped. */
export function findOrsReferences(text: string): OrsReference[] {
  const references: OrsReference[] = [];
  for (const word of text.matchAll(orsWord)) {
    const start = word.index;
    const afterWord = start + word[0].length;
    const chapterKeyword = matchAt(chapterWord, text, afterWord);
    const read =
      chapterKeyword === null
        ? readSectionList(text, afterWord)
        : readChapterList(text, afterWord + chapterKeyword[0].length);
    if (read !== undefined) references.push({ start, end: read.end, items: read.items });
  }
  return references;
}

const sectionToken = /(?<![\w.])\d{1,3}[A-Z]?\.\d{3,4}(?!\d)/g;

/**
 * Finds every section and range of sections in the text, with or without "ORS" before it. A
 * relating clause edit can insert a bare number ("and 418.808") whose "ORS" is in the title.
 */
export function findSectionItems(text: string): OrsItem[] {
  const items: OrsItem[] = [];
  let readUpTo = 0;
  for (const token of text.matchAll(sectionToken)) {
    if (token.index < readUpTo) continue;
    const list = readSectionList(text, token.index);
    if (list === undefined) continue;
    items.push(...list.items);
    readUpTo = list.end;
  }
  return items;
}
