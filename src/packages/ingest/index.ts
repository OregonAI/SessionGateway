// The ingest worker. A full pull reads the deployment's Session from OLIS (its Measures, committees,
// meetings and the documents they link) and stores the feed with the time the pull started as the
// index's "as of" time. It refreshes what the feed says about the documents it already holds, fetches
// every linked document the store does not hold yet, once each, keeps its text, and writes the build
// report (docs/adr/0011-an-amendment-is-a-node-and-its-postings-are-documents.md).
import { createHash } from "node:crypto";
import type { IngestConfig } from "#/packages/config/index.ts";
import { openIndexWriter } from "#/packages/database/writer.ts";
import { buildReportPath, writeBuildReport, type BuildReport } from "./lib/build-report.ts";
import type { DocumentLink } from "#/packages/domain/documents.ts";
import { createOlisClient, type OlisClient } from "#/packages/olis-client/index.ts";
import { loadSnapshot } from "#/packages/oregonai-snapshot/index.ts";
import { extractPdfText, type ExtractedPdf } from "#/packages/pdf-text/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";

export type IngestDeps = {
  fetch: typeof fetch;
  clock: Clock;
  /** Aborts the pull on shutdown. */
  signal: AbortSignal;
  /** Waits between attempts to fetch a document. Created in the entry script, so a test need not wait. */
  pause: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** How long one attempt to fetch a document may take, in milliseconds. 60 seconds by default. */
  documentTimeoutMs?: number;
};

export type FullPullResult = {
  measures: number;
  asOf: Timestamp;
  /** Documents fetched by this pull; the ones the store already held are not fetched again. */
  documentsFetched: number;
  /** Documents the feed links that this pull could not get or read. The next pull tries them again. */
  documentsNotFetched: number;
};

/** A document that takes longer than this is an outage, not a slow answer (olis-odata.md gotcha 15). */
const DEFAULT_DOCUMENT_TIMEOUT_MS = 60_000;

/** What a pull made of one linked document: its file and text, or why it is left out of the store. */
type Fetched = { kind: "fetched"; bytes: Uint8Array; pdf: ExtractedPdf } | { kind: "left_out"; reason: string };

/**
 * Fetches one document and reads its text. A document OLIS will not give, or a file that is not a PDF,
 * is an expected outcome and is left out with its reason. A failure of the extractor is not: it throws,
 * naming the document, so a broken install stops the pull instead of filling the report.
 */
async function fetchAndRead(olis: OlisClient, link: DocumentLink, signal: AbortSignal): Promise<Fetched> {
  const download = await olis.downloadDocument(link, signal);
  switch (download.kind) {
    case "fetched": {
      const extraction = await readPdf(link, download.bytes);
      switch (extraction.kind) {
        case "read":
          return { kind: "fetched", bytes: download.bytes, pdf: extraction.pdf };
        case "unreadable":
          return { kind: "left_out", reason: extraction.reason };
        default:
          return extraction satisfies never;
      }
    }
    case "failed":
      return { kind: "left_out", reason: download.reason };
    default:
      return download satisfies never;
  }
}

async function readPdf(link: DocumentLink, bytes: Uint8Array): ReturnType<typeof extractPdfText> {
  try {
    return await extractPdfText(bytes);
  } catch (error) {
    throw new Error(`The PDF extractor failed on ${link.id} (${link.sourceUrl})`, { cause: error });
  }
}

export async function runFullPull(config: IngestConfig, deps: IngestDeps): Promise<FullPullResult> {
  // The snapshot is read before OLIS is: a build with no usable snapshot fails at once, naming the file.
  const snapshot = await loadSnapshot(config.snapshotPath);
  const asOf = formatPacific(deps.clock.now());
  const olis = createOlisClient({
    baseUrl: config.olisBaseUrl,
    fetch: deps.fetch,
    documents: {
      origin: config.olisDocumentOrigin,
      timeoutMs: deps.documentTimeoutMs ?? DEFAULT_DOCUMENT_TIMEOUT_MS,
      pause: deps.pause,
    },
  });
  const measures = await olis.readMeasures(config.session, deps.signal);
  const committees = await olis.readCommittees(config.session, deps.signal);
  const meetings = await olis.readMeetings(config.session, deps.signal);
  const links = [
    ...(await olis.readDocumentLinks(config.session, deps.signal)),
    ...meetings.flatMap((meeting) => (meeting.agenda === null ? [] : [meeting.agenda])),
  ];
  const writer = openIndexWriter(config.databasePath);
  let documentsFetched = 0;
  const notFetched: BuildReport["documents_not_fetched"] = [];
  try {
    writer.recordFullPull(config.session, measures, asOf, snapshot.version);
    writer.recordMeetings(config.session, committees, meetings);
    const stored = writer.storedDocumentIds(config.session);
    // A fetched file is unchanging (ADR-0005) but its feed row is not: OLIS changes a posting's Meaning,
    // a Testimony's Measure. What the row says about a stored document is refreshed without fetching it.
    writer.refreshDocuments(
      config.session,
      links.filter((link) => stored.has(link.id)),
    );
    for (const link of links) {
      if (stored.has(link.id)) continue;
      const fetched = await fetchAndRead(olis, link, deps.signal);
      if (fetched.kind === "left_out") {
        notFetched.push({ id: link.id, source_url: link.sourceUrl, reason: fetched.reason });
        continue;
      }
      writer.storeDocument(config.session, {
        ...link,
        retrievedAt: formatPacific(deps.clock.now()),
        contentHash: createHash("sha256").update(fetched.bytes).digest("hex"),
        pageCount: fetched.pdf.pageCount,
        hasTextLayer: fetched.pdf.hasTextLayer,
        text: fetched.pdf.text,
      });
      stored.add(link.id);
      documentsFetched += 1;
    }
    writeBuildReport(buildReportPath(config.databasePath), {
      session: config.session,
      as_of: asOf,
      documents_without_text_layer: writer.documentsWithoutTextLayer(config.session).map((document) => ({
        id: document.id,
        source_url: document.sourceUrl,
      })),
      documents_not_fetched: notFetched,
    });
  } finally {
    writer.close();
  }
  return { measures: measures.length, asOf, documentsFetched, documentsNotFetched: notFetched.length };
}
