// The text of a PDF as published. This package is the only code that reads PDF bytes; what it hands
// on is the text the extractor read, untouched (ADR-0002, docs/adr/0010-pdf-text-extractor.md).
import { extractPdfText as extract, type ExtractedPdf } from "./lib/extract.ts";

export type { ExtractedPdf };

/** Reads the text layer of a PDF. Throws if the bytes are not a PDF the extractor can open. */
export function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  return extract(bytes);
}
