import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { z } from "zod";
import { unreadableReason } from "./extract.ts";

/** One link annotation of a PDF: the page it is on (from 1), where it points and the rectangle it covers. */
export type PdfLink = {
  page: number;
  url: string;
  /** PDF.js's `rect`: [x0, y0, x1, y1] in PDF points, y up from the bottom of the page. */
  rect: readonly [number, number, number, number];
};

/**
 * What the worker stores of a link annotation (ticket #160): where it points and the page it is on, as the file holds them.
 * The same shape as `StoredLinkAnnotation` in `domain`, and not one type: the parser packages import no other package (this one
 * reads PDF bytes and nothing else), and the domain must not import a PDF reader. The shapes are structural, so the worker
 * passes one to the writer with no conversion and the compiler fails if they drift apart.
 */
export type LinkAnnotation = { page: number; url: string };

/**
 * A PDF's link annotations as stored: the address and the page of each, in the order `extractPdfLinks` gives them. It adds and
 * derives nothing, so a stored list is the file's own and is a source independent of anything read from it later.
 */
export function linkAnnotationsOf(links: readonly PdfLink[]): LinkAnnotation[] {
  return links.map(({ page, url }) => ({ page, url }));
}

export type PdfLinkExtraction = { kind: "read"; links: PdfLink[] } | { kind: "unreadable"; reason: string };

/** pdf.js writes its own warnings to the console unless told not to. */
const ERRORS_ONLY = 0;

/**
 * What pdf.js hands back for a page's annotations, read as `unknown` and parsed here (src/CLAUDE.md, "Parse at the
 * boundary"). Only a link to an address matters: a link inside the file has no `url`, and a widget or a note is not a link.
 */
const annotation = z.looseObject({
  subtype: z.string().optional(),
  url: z.string().optional(),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});
const annotations = z.array(annotation);

const pageCount = z.number().int().nonnegative();

async function readLinks(bytes: Uint8Array): Promise<PdfLink[]> {
  // pdf.js takes over the array it is given, so it gets a copy and the caller's bytes stay whole.
  const document = await getDocumentProxy(new Uint8Array(bytes), { verbosity: ERRORS_ONLY });
  try {
    const links: PdfLink[] = [];
    const total = pageCount.parse(document.numPages);
    for (let page = 1; page <= total; page += 1) {
      const parsed = annotations.safeParse(await (await document.getPage(page)).getAnnotations());
      if (!parsed.success) {
        throw new Error(`pdf.js gave the annotations of page ${page} in a shape the pdf-text package does not read`, {
          cause: parsed.error,
        });
      }
      for (const item of parsed.data) {
        if (item.subtype === "Link" && item.url !== undefined && item.rect !== undefined) {
          links.push({ page, url: item.url, rect: item.rect });
        }
      }
    }
    return links;
  } finally {
    await document.loadingTask.destroy();
  }
}

export async function extractPdfLinks(bytes: Uint8Array): Promise<PdfLinkExtraction> {
  // Loaded first and outside the try: a bundle that cannot be resolved is a broken install, not a file.
  const pdfjs = await getResolvedPDFJS();
  try {
    return { kind: "read", links: await readLinks(bytes) };
  } catch (error) {
    const reason = unreadableReason(pdfjs, error);
    if (reason !== undefined) return { kind: "unreadable", reason };
    throw error;
  }
}
