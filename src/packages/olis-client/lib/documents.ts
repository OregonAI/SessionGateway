// The documents the feed links (spec #1, "OLIS client"): which rows link one, what each document is
// called in the graph, and how it is fetched. The rows are the feed's own shapes and stay in here.
import { z } from "zod";
import { measureIdOf, type SessionKey } from "#/packages/domain/index.ts";
import { versionIdOf, type DocumentLink, type DocumentRelation } from "#/packages/domain/documents.ts";
import { readEntitySet } from "./feed.ts";
import type { OlisClientOptions } from "./options.ts";

/** Every document OLIS links is on this origin (docs/research/olis-odata.md section 4). */
const OLIS_DOCUMENT_ORIGIN = "https://olis.oregonlegislature.gov";

/**
 * The link as OLIS gives it, made safe to use: raw spaces in a MeasureDocuments URL are
 * percent-encoded (olis-odata.md gotcha 10), and a link to any other origin is refused, so the worker
 * only ever fetches from OLIS.
 */
function sourceUrlOf(link: string): string {
  const url = new URL(link);
  if (url.origin !== OLIS_DOCUMENT_ORIGIN) {
    throw new Error(`OLIS linked a document outside ${OLIS_DOCUMENT_ORIGIN}: ${url.origin}`);
  }
  return url.href;
}

/** Where a document is fetched from: its path on OLIS, at the origin the deployment names. */
export function downloadUrlOf(sourceUrl: string, documentOrigin: string): URL {
  const url = new URL(sourceUrl);
  return new URL(url.pathname + url.search, documentOrigin);
}

const measureDocumentRow = z.looseObject({
  SessionKey: z.string(),
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  VersionDescription: z.string(),
  DocumentUrl: z.string(),
});

async function readVersions(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<DocumentLink[]> {
  const rows = await readEntitySet(
    options,
    "MeasureDocuments",
    `SessionKey eq '${session}'`,
    measureDocumentRow,
    signal,
  );
  return rows
    .filter((row) => row.SessionKey === session)
    .map((row) => {
      const key = { session, prefix: row.MeasurePrefix, number: row.MeasureNumber };
      const id = versionIdOf(key, row.VersionDescription);
      const relations: DocumentRelation[] = [
        {
          relation: "measure",
          to: measureIdOf(key),
          meaning: null,
          provenance: `MeasureDocuments ${row.MeasurePrefix}${row.MeasureNumber} ${row.VersionDescription}`,
        },
      ];
      return {
        id,
        nodeId: id,
        kind: "version",
        label: row.VersionDescription,
        sourceUrl: sourceUrlOf(row.DocumentUrl),
        postedAt: null,
        relations,
      };
    });
}

export async function readDocumentLinks(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<DocumentLink[]> {
  return readVersions(options, session, signal);
}

/** The bytes of one document, or why they could not be had. */
export type Download = { kind: "fetched"; bytes: Uint8Array } | { kind: "failed"; reason: string };

export async function downloadDocument(
  options: OlisClientOptions,
  link: DocumentLink,
  signal: AbortSignal,
): Promise<Download> {
  const url = downloadUrlOf(link.sourceUrl, options.documents.origin);
  const response = await options.fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(options.documents.timeoutMs)]),
  });
  if (!response.ok) return { kind: "failed", reason: `OLIS answered ${response.status} to ${url.pathname}` };
  return { kind: "fetched", bytes: new Uint8Array(await response.arrayBuffer()) };
}
