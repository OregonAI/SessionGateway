/**
 * Text as `pdftotext` prints a printed bill, made searchable for names. A printed bill numbers its
 * lines, and the number prints on a line of its own between two lines of text, so a name the page
 * wraps can have a number in the middle of it ("Department of Consumer and", "45", "Business
 * Services"). Words are also hyphenated at the line end ("Employ-", "12", "ment Department").
 *
 * This puts such a name back together: lines that hold only a line number go, a hyphen at the end
 * of a line joins the word to its continuation in lower case, and whitespace runs, including line
 * breaks, become one space. The result is for matching only: nothing served to an agent comes from it.
 */
export function flattenText(text: string): string {
  return text
    .replace(/^[ \t]*\d{1,3}[ \t]*$/gm, "")
    .replace(/(\p{L})-[ \t]*\n\s*(?=\p{Ll})/gu, "$1")
    .replace(/\s+/g, " ");
}
