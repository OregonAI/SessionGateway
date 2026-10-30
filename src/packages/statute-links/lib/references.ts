/** One thing an "ORS ..." reference names: a section as printed ("659A.162"), or a whole chapter ("657B"). */
export type OrsItem = { type: "section"; citation: string } | { type: "chapter"; chapter: string };

/** An "ORS ..." reference found in running text: where it starts and ends, and what it names. */
export type OrsReference = { start: number; end: number; items: OrsItem[] };

const orsWord = /\bORS\s+/g;
const chapterWord = /chapters?\s+/y;
const chapterNumber = /(\d{1,3}[A-Z]?)(?!\d|\.\d)/y;
const sectionNumber = /(\d{1,3}[A-Z]?\.\d{3,4})(?!\d)/y;
const subsections = /(?:\s*\([A-Za-z0-9]{1,3}\))*/y;

function matchAt(pattern: RegExp, text: string, index: number): RegExpExecArray | null {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

/** Finds every "ORS ..." reference in the text, in order. Text that names no ORS section or chapter after "ORS" is skipped. */
export function findOrsReferences(text: string): OrsReference[] {
  const references: OrsReference[] = [];
  for (const word of text.matchAll(orsWord)) {
    const start = word.index;
    let position = start + word[0].length;
    const chapterKeyword = matchAt(chapterWord, text, position);
    if (chapterKeyword !== null) {
      const chapter = matchAt(chapterNumber, text, position + chapterKeyword[0].length);
      if (chapter?.[1] === undefined) continue;
      position = chapterNumber.lastIndex;
      references.push({ start, end: position, items: [{ type: "chapter", chapter: chapter[1] }] });
      continue;
    }
    const section = matchAt(sectionNumber, text, position);
    if (section?.[1] === undefined) continue;
    position = sectionNumber.lastIndex;
    subsections.lastIndex = position;
    subsections.exec(text);
    position = subsections.lastIndex;
    references.push({ start, end: position, items: [{ type: "section", citation: section[1] }] });
  }
  return references;
}
