import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { z } from "zod";

export type ExtractedPdf = {
  pageCount: number;
  /** Every page's text, in page order, with a form feed (U+000C) between pages and nothing else added. */
  text: string;
  /** False when the extractor found no character but whitespace on any page: a scan or a photograph. */
  hasTextLayer: boolean;
};

/**
 * What reading a file came to. A file that is not a PDF is an expected outcome, so it is a value; a
 * failure of the extractor itself is not, and throws.
 */
export type PdfExtraction = { kind: "read"; pdf: ExtractedPdf } | { kind: "unreadable"; reason: string };

/** pdf.js writes its own warnings (a font with an odd hint program, say) to the console unless told not to. */
const ERRORS_ONLY = 0;

/**
 * What pdf.js hands back for a page, read as `unknown` and parsed here (src/CLAUDE.md, "Parse at the
 * boundary"). A text item has `str` and, at the end of a line, `hasEOL`; the page's other items (marked
 * content) have neither and say nothing in the text.
 */
const pageContent = z.object({
  items: z.array(z.looseObject({ str: z.string().optional(), hasEOL: z.boolean().optional() })),
});

type Page = { getTextContent(parameters: { disableNormalization: boolean }): Promise<unknown> };

/** One page's text: each item's characters, and a line end where pdf.js saw one. */
async function readPage(page: Page, pageNumber: number): Promise<string> {
  // pdf.js normalizes the characters it reads unless told not to (`disableNormalization: false` is its
  // default): it splits the ligature "ﬁ" (U+FB01) into "fi", for one. The text layer's own characters are
  // the text as published (ADR-0002), so they are what is asked for.
  const parsed = pageContent.safeParse(await page.getTextContent({ disableNormalization: true }));
  if (!parsed.success) {
    throw new Error(`pdf.js gave the text of page ${pageNumber} in a shape the pdf-text package does not read`, {
      cause: parsed.error,
    });
  }
  return parsed.data.items
    .filter((item) => item.str !== undefined)
    .map((item) => `${item.str ?? ""}${item.hasEOL === true ? "\n" : ""}`)
    .join("");
}

async function readDocument(bytes: Uint8Array): Promise<ExtractedPdf> {
  // pdf.js takes over the array it is given, so it gets a copy and the caller's bytes stay whole.
  const document = await getDocumentProxy(new Uint8Array(bytes), { verbosity: ERRORS_ONLY });
  try {
    // Page by page, not unpdf's `extractText`: its `mergePages: true` collapses runs of spaces and blank
    // lines, and without it the call still lets pdf.js normalize the characters (see readPage).
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      pages.push(await readPage(await document.getPage(pageNumber), pageNumber));
    }
    const text = pages.join("\f");
    const hasTextLayer = /\S/.test(text);
    // Pages that hold no characters leave nothing to publish, not the page breaks between them.
    return { pageCount: pages.length, text: hasTextLayer ? text : "", hasTextLayer };
  } finally {
    await document.loadingTask.destroy();
  }
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtraction> {
  // Loaded first and outside the try: a bundle that cannot be resolved is a broken install, not a file.
  const pdfjs = await getResolvedPDFJS();
  try {
    return { kind: "read", pdf: await readDocument(bytes) };
  } catch (error) {
    // pdf.js throws InvalidPDFException when the bytes are not a PDF it can open (empty, truncated,
    // random). Anything else is a bug or a failure of the machine, and is not told apart per document.
    if (error instanceof Error && error instanceof pdfjs.InvalidPDFException) {
      return { kind: "unreadable", reason: `The file is not a PDF the extractor can read (${error.message})` };
    }
    throw error;
  }
}
