// The ingest worker. A full pull reads every Measure of the deployment's Session from OLIS and
// stores it, with the time the pull started as the index's "as of" time. It then fetches every
// document the feed links that the store does not hold yet, once each, and keeps its text.
import { createHash } from "node:crypto";
import type { IngestConfig } from "#/packages/config/index.ts";
import { openIndexWriter } from "#/packages/database/writer.ts";
import { createOlisClient } from "#/packages/olis-client/index.ts";
import { extractPdfText } from "#/packages/pdf-text/index.ts";
import type { Clock } from "#/packages/time/clock.ts";
import { formatPacific, type Timestamp } from "#/packages/time/pacific.ts";

export type IngestDeps = {
  fetch: typeof fetch;
  clock: Clock;
  /** Aborts the pull on shutdown. */
  signal: AbortSignal;
  /** How long one attempt to fetch a document may take, in milliseconds. A day's pull sets 60 seconds. */
  documentTimeoutMs?: number;
};

export type FullPullResult = {
  measures: number;
  asOf: Timestamp;
  /** Documents fetched by this pull; the ones the store already held are not fetched again. */
  documentsFetched: number;
};

/** A document that takes longer than this is an outage, not a slow answer (olis-odata.md gotcha 15). */
const DEFAULT_DOCUMENT_TIMEOUT_MS = 60_000;

export async function runFullPull(config: IngestConfig, deps: IngestDeps): Promise<FullPullResult> {
  const asOf = formatPacific(deps.clock.now());
  const olis = createOlisClient({
    baseUrl: config.olisBaseUrl,
    fetch: deps.fetch,
    documents: {
      origin: config.olisDocumentOrigin,
      timeoutMs: deps.documentTimeoutMs ?? DEFAULT_DOCUMENT_TIMEOUT_MS,
    },
  });
  const measures = await olis.readMeasures(config.session, deps.signal);
  const meetings = await olis.readMeetings(config.session, deps.signal);
  const links = [
    ...(await olis.readDocumentLinks(config.session, deps.signal)),
    ...meetings.flatMap((meeting) => (meeting.agenda === null ? [] : [meeting.agenda])),
  ];
  const writer = openIndexWriter(config.databasePath);
  let documentsFetched = 0;
  try {
    writer.recordFullPull(config.session, measures, asOf);
    const stored = writer.storedDocumentIds(config.session);
    for (const link of links) {
      if (stored.has(link.id)) continue;
      const download = await olis.downloadDocument(link, deps.signal);
      if (download.kind === "failed") throw new Error(download.reason);
      const extracted = await extractPdfText(download.bytes);
      writer.storeDocument(config.session, {
        ...link,
        retrievedAt: formatPacific(deps.clock.now()),
        contentHash: createHash("sha256").update(download.bytes).digest("hex"),
        pageCount: extracted.pageCount,
        hasTextLayer: extracted.hasTextLayer,
        text: extracted.text,
      });
      documentsFetched += 1;
    }
  } finally {
    writer.close();
  }
  return { measures: measures.length, asOf, documentsFetched };
}
