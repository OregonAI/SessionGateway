/**
 * The most characters one part of a document's text holds. At about four characters to a token that is
 * some 5,000 tokens: well inside an agent's context, and under the 10,000 tokens at which MCP clients
 * start to warn about a tool result. The longest fixture document, a 94-page letter of 393,000
 * characters, is 20 parts.
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
