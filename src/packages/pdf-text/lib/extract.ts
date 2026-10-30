import { extractText, getDocumentProxy } from "unpdf";

export type ExtractedPdf = {
  pageCount: number;
  /** Every page's text, in page order, with a form feed (U+000C) between pages and nothing else added. */
  text: string;
  /** False when the extractor found no character but whitespace on any page: a scan or a photograph. */
  hasTextLayer: boolean;
};

/** pdf.js writes its own warnings (a font with an odd hint program, say) to the console unless told not to. */
const ERRORS_ONLY = 0;

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  // pdf.js takes over the array it is given, so it gets a copy and the caller's bytes stay whole.
  const document = await getDocumentProxy(new Uint8Array(bytes), { verbosity: ERRORS_ONLY });
  try {
    // `mergePages: true` would collapse runs of spaces and blank lines (unpdf's normalizeMergedText),
    // which is rewriting; the per-page text is what pdf.js read, line ends included.
    const { text: pages } = await extractText(document, { mergePages: false });
    const text = pages.join("\f");
    const hasTextLayer = /\S/.test(text);
    // Pages that hold no characters leave nothing to publish, not the page breaks between them.
    return { pageCount: pages.length, text: hasTextLayer ? text : "", hasTextLayer };
  } finally {
    await document.loadingTask.destroy();
  }
}
