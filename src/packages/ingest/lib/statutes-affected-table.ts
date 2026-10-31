import { createHash } from "node:crypto";
import type { IndexWriter } from "#/packages/database/writer.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import type { OlisClient } from "#/packages/olis-client/index.ts";
import { extractPdfText } from "#/packages/pdf-text/index.ts";
import { parseStatutesAffectedTable } from "#/packages/statute-links/index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * What a full pull did about Legislative Counsel's Statutes Affected Table, for the build report (ADR-0034).
 * `outcome` says what happened to the copy this pull fetched; `held` says whether the index holds a table after the
 * pull, which it can when this pull got nothing, because a copy that was loaded once is kept.
 */
export type StatutesAffectedTableReport = {
  source_url: string;
  outcome:
    | "loaded" // new bytes were read and stored
    | "unchanged" // the bytes are the ones the index holds, so nothing was read again
    | "not_published" // the server answered 404: the table does not exist yet, or no longer
    | "not_fetched" // any other failure to get the bytes
    | "not_read"; // got bytes that are not a table the parser reads
  held: boolean;
  /** For "loaded": the entries read, and the lines of the ORS table the parser could not read. */
  entries?: number;
  unread_lines?: number;
  /** For "not_fetched" and "not_read": why. */
  reason?: string;
};

type LoadArguments = {
  /** The address the deployment names, as the configuration gives it. */
  url: string;
  olis: OlisClient;
  writer: IndexWriter;
  session: SessionKey;
  /** The snapshot's ORS section list, which a series in the table is expanded against. */
  orsSections: readonly OrsSectionId[];
  /** The time of the fetch, for the copy's retrieval time. */
  now: () => Timestamp;
  signal: AbortSignal;
};

/**
 * Fetches the Statutes Affected Table and, when its bytes differ from the copy the index holds, reads and stores it.
 * Nothing that goes wrong with the table stops the pull or changes what the index holds: a table that is not
 * published yet, a failed fetch and a file that is not a table all leave the copy as it was (ADR-0034). A failure of
 * the PDF extractor itself is a bug and throws, as it does for a document.
 */
export async function loadStatutesAffectedTable(load: LoadArguments): Promise<StatutesAffectedTableReport> {
  const held = load.writer.statutesAffectedTableHash(load.session) !== undefined;
  const report = { source_url: load.url };
  const retrievedAt = load.now();
  const download = await load.olis.downloadFile(new URL(load.url), load.signal);
  if (download.kind === "failed") {
    return download.status === 404
      ? { ...report, outcome: "not_published", held }
      : { ...report, outcome: "not_fetched", held, reason: download.reason };
  }
  const contentHash = createHash("sha256").update(download.bytes).digest("hex");
  if (contentHash === load.writer.statutesAffectedTableHash(load.session)) {
    return { ...report, outcome: "unchanged", held: true };
  }
  const extraction = await extractTableText(load.url, download.bytes);
  if (extraction.kind === "unreadable") return { ...report, outcome: "not_read", held, reason: extraction.reason };
  if (!extraction.pdf.hasTextLayer) {
    return { ...report, outcome: "not_read", held, reason: "The file has no text layer (a scan or a photograph)" };
  }
  const parsed = parseStatutesAffectedTable({ text: extraction.pdf.text, orsSections: load.orsSections });
  if (parsed.entries.length === 0) {
    return { ...report, outcome: "not_read", held, reason: "The text holds no row of an ORS table" };
  }
  load.writer.storeStatutesAffectedTable(load.session, {
    sourceUrl: load.url,
    retrievedAt,
    contentHash,
    pageCount: extraction.pdf.pageCount,
    text: extraction.pdf.text,
    entries: parsed.entries,
  });
  return {
    ...report,
    outcome: "loaded",
    held: true,
    entries: parsed.entries.length,
    unread_lines: parsed.unreadLines.length,
  };
}

async function extractTableText(url: string, bytes: Uint8Array): ReturnType<typeof extractPdfText> {
  try {
    return await extractPdfText(bytes);
  } catch (error) {
    throw new Error(`The PDF extractor failed on the Statutes Affected Table (${url})`, { cause: error });
  }
}
