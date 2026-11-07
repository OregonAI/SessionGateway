// MADE UP: a PDF with these lines and link annotations, for the seam-4 tests of the ingest package (ticket #160). The package's
// tests import no `test/` file, so this is the small part of `test/support/made-up-pdf.ts` they need (one page, Helvetica
// lines, URI link annotations), copied and kept to that. Every file it makes is labelled made up where a test uses it.

/** A link annotation to write on the page: the address and the rectangle in PDF points. */
export type MadeUpLink = { url: string; rect: readonly [number, number, number, number] };

/** The bytes of a one-page PDF with these lines (from the top down, ASCII without parentheses) and these links. */
export function madeUpPdf(lines: readonly string[], links: readonly MadeUpLink[]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [5 0 R] /Count 1 >>");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const stream = lines.map((line, index) => `BT /F1 9 Tf 40 ${760 - index * 12} Td (${line}) Tj ET`).join("\n");
  const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  // The page is object 5, so the annotations come after it.
  const pageNumber = objects.length + 1;
  const annotationIds = links.map((_, index) => pageNumber + 1 + index);
  const annots = annotationIds.length === 0 ? "" : ` /Annots [${annotationIds.map((id) => `${id} 0 R`).join(" ")}]`;
  add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R${annots} >>`,
  );
  for (const link of links) {
    add(
      `<< /Type /Annot /Subtype /Link /Rect [${link.rect.join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${link.url}) >> >>`,
    );
  }
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
