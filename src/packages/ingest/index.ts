// The ingest worker. A full pull reads the deployment's Session from OLIS (its Measures, committees,
// meetings and the documents they link) and stores the feed with the time the pull started as the
// index's "as of" time. It then fetches every linked document the store does not hold yet, once each,
// keeps its text, and writes the build report (docs/adr/0011-an-amendment-is-a-node-and-its-postings-are-documents.md).
import { createHash } from "node:crypto";
import type { IngestConfig } from "#/packages/config/index.ts";
import { openIndexWriter } from "#/packages/database/writer.ts";
import { buildReportPath, writeBuildReport, type BuildReport } from "./lib/build-report.ts";
import { createOlisClient } from "#/packages/olis-client/index.ts";
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

/** A file OLIS served that is not a PDF the extractor can open is an expected outcome, not a crash. */
async function readPdf(
  bytes: Uint8Array,
): Promise<{ kind: "read"; pdf: ExtractedPdf } | { kind: "unreadable"; reason: string }> {
  try {
    return { kind: "read", pdf: await extractPdfText(bytes) };
  } catch (error) {
    const why = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { kind: "unreadable", reason: `The file is not a PDF the extractor can read (${why})` };
  }
}

export async function runFullPull(config: IngestConfig, deps: IngestDeps): Promise<FullPullResult> {
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
    writer.recordFullPull(config.session, measures, asOf);
    writer.recordMeetings(config.session, committees, meetings);
    const stored = writer.storedDocumentIds(config.session);
    for (const link of links) {
      if (stored.has(link.id)) continue;
      const download = await olis.downloadDocument(link, deps.signal);
      if (download.kind === "failed") {
        notFetched.push({ id: link.id, source_url: link.sourceUrl, reason: download.reason });
        continue;
      }
      const extracted = await readPdf(download.bytes);
      if (extracted.kind === "unreadable") {
        notFetched.push({ id: link.id, source_url: link.sourceUrl, reason: extracted.reason });
        continue;
      }
      writer.storeDocument(config.session, {
        ...link,
        retrievedAt: formatPacific(deps.clock.now()),
        contentHash: createHash("sha256").update(download.bytes).digest("hex"),
        pageCount: extracted.pdf.pageCount,
        hasTextLayer: extracted.pdf.hasTextLayer,
        text: extracted.pdf.text,
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
