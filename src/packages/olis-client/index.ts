// The OLIS client: the only code that sees the feed's own shapes (src/CLAUDE.md, "Shape"). It reads
// the OData v3 feed and hands everything else domain types named as GLOSSARY.md names them.
import type { Measure, SessionKey } from "#/packages/domain/index.ts";
import type { DocumentLink } from "#/packages/domain/documents.ts";
import { downloadDocument, readDocumentLinks, type Download } from "./lib/documents.ts";
import { readMeasureRows } from "./lib/measures.ts";
import type { OlisClientOptions } from "./lib/options.ts";

export type { Download, OlisClientOptions };

export type OlisClient = {
  /** Every Measure of the Session, as the feed lists them. */
  readMeasures(session: SessionKey, signal: AbortSignal): Promise<Measure[]>;
  /** Every document the feed links for the Session, not yet fetched. */
  readDocumentLinks(session: SessionKey, signal: AbortSignal): Promise<DocumentLink[]>;
  /** Fetches one document from OLIS. */
  downloadDocument(link: DocumentLink, signal: AbortSignal): Promise<Download>;
};

export function createOlisClient(options: OlisClientOptions): OlisClient {
  return {
    readMeasures: (session, signal) => readMeasureRows(options, session, signal),
    readDocumentLinks: (session, signal) => readDocumentLinks(options, session, signal),
    downloadDocument: (link, signal) => downloadDocument(options, link, signal),
  };
}
