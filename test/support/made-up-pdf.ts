// A PDF built from lines of text, for a test that needs a document the fixture does not hold (a made-up Statutes
// Affected Table, test/support/statutes-affected-table.ts). One Helvetica line to a row of the page, one page to an
// array: PDF.js reads each line as a line of text, as it reads the real table's rows. Only ASCII and the three
// characters the table uses beyond it (§ and the curly quotes) can be written.

const winAnsi: Record<string, string> = { "§": "\\247", "“": "\\223", "”": "\\224" };

function literal(line: string): string {
  let written = "";
  for (const character of line) {
    const code = character.charCodeAt(0);
    if (character === "(" || character === ")" || character === "\\") written += `\\${character}`;
    else if (winAnsi[character] !== undefined) written += winAnsi[character];
    else if (code < 0x20 || code > 0x7e) throw new Error(`A made-up PDF cannot write "${character}"`);
    else written += character;
  }
  return written;
}

/** A link annotation to write: the page (from 1), the address and the rectangle in PDF points. */
export type MadeUpLink = { page: number; url: string; rect: readonly [number, number, number, number] };

/**
 * The bytes of a PDF with these pages, each a list of lines from the top of the page down, and the link annotations
 * `options.links` gives, each on its page (ticket #126: a made-up Recording Log has player links). A link's address is
 * written as a URI action, as OLIS's logs do; it covers its rectangle and the page's lines are left as they are.
 */
export function madeUpPdf(
  pages: readonly (readonly string[])[],
  options: { links?: readonly MadeUpLink[] } = {},
): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const [pageIndex, lines] of pages.entries()) {
    const annotationIds = (options.links ?? [])
      .filter((link) => link.page === pageIndex + 1)
      .map((link) =>
        add(
          `<< /Type /Annot /Subtype /Link /Rect [${link.rect.join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${literal(link.url)}) >> >>`,
        ),
      );
    const annots = annotationIds.length === 0 ? "" : ` /Annots [${annotationIds.map((id) => `${id} 0 R`).join(" ")}]`;
    const stream = lines
      .map((line, index) => `BT /F1 9 Tf 40 ${760 - index * 12} Td (${literal(line)}) Tj ET`)
      .join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R${annots} >>`,
      ),
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const crossReference = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${crossReference}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
