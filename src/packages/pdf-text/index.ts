// The text of a PDF as published. This package is the only code that reads PDF bytes; what it hands
// on is the text layer's own characters, with nothing added or rewritten (ADR-0002,
// docs/adr/0010-pdf-text-with-unpdf-never-merged.md).
import { extractPdfText as extract, type ExtractedPdf, type PdfExtraction } from "./lib/extract.ts";

export type { ExtractedPdf, PdfExtraction };

/**
 * Reads the text layer of a PDF. A file that is not a PDF the extractor can open comes back as
 * `unreadable`; a failure of the extractor itself (a broken install, a bug) throws.
 */
export function extractPdfText(bytes: Uint8Array): Promise<PdfExtraction> {
  return extract(bytes);
}
