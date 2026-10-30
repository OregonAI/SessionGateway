/**
 * The index of the bracket that closes the one at `open`, or -1 when the text never closes it.
 * Brackets nest: struck matter can hold a bracketed paragraph number.
 */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const character = text[index];
    if (character === "[") depth++;
    else if (character === "]" && --depth === 0) return index;
  }
  return -1;
}

/**
 * The text without the matter the measure marks to be omitted. Every measure says so in its NOTE:
 * "Matter in boldfaced type in an amended section is new; matter [italic and bracketed] is existing
 * law to be omitted." `pdftotext` drops the type and keeps the brackets, so a mention inside them
 * is one the measure strikes and the citation beside it is the one it writes into law (#6 F3, F4).
 * A bracket the text never closes is kept as it is, so a stray "[" cannot swallow the rest.
 */
export function withoutOmittedMatter(text: string): string {
  let kept = "";
  let from = 0;
  for (let open = text.indexOf("[", from); open >= 0; open = text.indexOf("[", from)) {
    const close = closingBracket(text, open);
    if (close < 0) {
      kept += text.slice(from, open + 1);
      from = open + 1;
    } else {
      kept += text.slice(from, open);
      from = close + 1;
    }
  }
  return kept + text.slice(from);
}
