/**
 * Turns `pdftotext` output into running text. The default (reading-order) mode puts each line
 * number on a line of its own and breaks words with a hyphen at the end of a line, so both go.
 * Everything else is kept as printed.
 */
export function normalizeExtractedText(text: string): string {
  const lines = text
    .split(/[\n\f]/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^\d{1,2}$/.test(line));
  return lines
    .join("\n")
    .replace(/([a-z])-\n([a-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}
