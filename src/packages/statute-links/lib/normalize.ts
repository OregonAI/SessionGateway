// What a Proposed Amendment prints at the foot of each page, on three lines:
//   SB 69-1 1/17/25
//   Proposed Amendments to SB 69
//   Page 13
// An amendment to an engrossed bill names it, and may add a note:
//   Proposed Amendments to B-Eng. HB 3544 (A to RC)
// A citation can run over a page break, so the footer has to go for "ORS" and its number to meet.
const pageFooterLines = [
  /^[A-Z]{1,3} \d{1,4}-[A-Z]?\d{1,3} \d{1,2}\/\d{1,2}\/\d{2}$/,
  /^Proposed Amendments to (?:[A-Z]-Eng\. )?[A-Z]{1,3} \d{1,4}(?: \([^)]{1,20}\))?$/,
  /^Page \d{1,3}$/,
];

/**
 * Turns `pdftotext` output into running text. The default (reading-order) mode puts each line
 * number on a line of its own and breaks words with a hyphen at the end of a line, and a page
 * adds its footer, so all three go. Everything else is kept as printed.
 */
export function normalizeExtractedText(text: string): string {
  const lines = text
    .split(/[\n\f]/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^\d{1,2}$/.test(line) && !pageFooterLines.some((footer) => footer.test(line)));
  return lines
    .join("\n")
    .replace(/([a-z])-\n([a-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}
