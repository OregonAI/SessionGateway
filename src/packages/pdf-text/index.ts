// The text of a PDF as published. This package is the only code that reads PDF bytes; what it hands
// on is the text layer's own characters, with nothing added or rewritten (ADR-0002,
// docs/adr/0010-pdf-text-with-unpdf-never-merged.md).
import { extractPdfText as extract, type ExtractedPdf, type PdfExtraction } from "./lib/extract.ts";
import {
  extractPdfLinks as extractLinks,
  linkAnnotationsOf,
  type LinkAnnotation,
  type PdfLink,
  type PdfLinkExtraction,
} from "./lib/links.ts";

export { linkAnnotationsOf };
export type { ExtractedPdf, LinkAnnotation, PdfExtraction, PdfLink, PdfLinkExtraction };

/**
 * Reads the text layer of a PDF. A file that is not a PDF the extractor can open, or that needs a password to open, comes
 * back as `unreadable`; a failure of the extractor itself (a broken install, a bug) throws.
 */
export function extractPdfText(bytes: Uint8Array): Promise<PdfExtraction> {
  return extract(bytes);
}

/**
 * Reads the link annotations of a PDF that point at an address, as { page, url, rect }, in page order and, within a page,
 * in the order the file holds them. Like `extractPdfText`, a file the extractor cannot open comes back as `unreadable`.
 */
export function extractPdfLinks(bytes: Uint8Array): Promise<PdfLinkExtraction> {
  return extractLinks(bytes);
}
