/**
 * Split text into retrieval passages of roughly `maxChars`, breaking on
 * paragraph boundaries. A paragraph longer than `maxChars` is split on
 * whitespace so no passage is unbounded.
 */
export function chunkText(text: string, maxChars = 1500): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .flatMap((p) => splitLong(p, maxChars));

  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > maxChars) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLong(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const parts: string[] = [];
  let current = "";
  for (const word of paragraph.split(/\s+/)) {
    if (current && current.length + word.length + 1 > maxChars) {
      parts.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) parts.push(current);
  return parts;
}
