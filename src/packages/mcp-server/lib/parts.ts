/**
 * The most characters one part of a document's text holds. At about four characters to a token
 * (docs/research/olis-odata.md section 7, inferred) that is some 5,000 tokens: a few percent of an
 * agent's context. The longest fixture document, a 94-page letter of 393,000 characters, is 20 parts
 * (docs/adr/0011-an-amendment-is-a-node-and-its-postings-are-documents.md).
 */
export const PART_SIZE_CHARACTERS = 20_000;

/**
 * Cuts a text into parts of at most `PART_SIZE_CHARACTERS` characters, each ending where a line ends so
 * no line is split, unless a line is longer than a part. Joined, the parts are the text exactly: nothing
 * is added, dropped or trimmed. An empty text is one empty part.
 */
export function splitIntoParts(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (text.length - start > PART_SIZE_CHARACTERS) {
    const limit = start + PART_SIZE_CHARACTERS;
    let end = text.lastIndexOf("\n", limit - 1) + 1;
    if (end <= start) {
      end = limit;
      // Never cut a surrogate pair in two.
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  parts.push(text.slice(start));
  return parts;
}
