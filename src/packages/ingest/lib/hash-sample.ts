// The nightly hash sample (ticket #20, ADR-0005, ADR-0040): a few stored documents are fetched again and their hashes
// compared with the stored ones, to catch a file replaced behind the same URL. A mismatch is reported and nothing is
// stored: a fetched document is unchanging (ADR-0002), so the index goes on serving the file it fetched, and the
// operator decides what a replaced file means.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { StoredDocumentHash } from "#/packages/database/writer.ts";
import type { DocumentId } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { Download, OlisClient } from "#/packages/olis-client/index.ts";
import { compareTimestamps, formatPacific, readTimestamp, type Timestamp } from "#/packages/time/pacific.ts";
import type { Clock } from "#/packages/time/clock.ts";

/** A document whose file now hashes differently from the one the index holds. */
export type HashMismatch = {
  id: DocumentId;
  source_url: string;
  /** The sha256 of the file the index holds. */
  stored_hash: string;
  /** The sha256 of the file OLIS gave tonight. */
  new_hash: string;
  checked_at: Timestamp;
};

/** What the operator reads after a sample (`hash-sample-report.json`, beside the database). */
export type HashSampleReport = {
  session: SessionKey;
  /** When the sample began. */
  as_of: Timestamp;
  /** The configured size (INGEST_HASH_SAMPLE_SIZE). */
  sample_size: number;
  /** The documents drawn: the sample size, or all the index holds when that is fewer. */
  sampled: number;
  /** Of those, the documents OLIS gave and whose hash was compared. */
  checked: number;
  mismatches: HashMismatch[];
  /** Documents drawn that were not compared, with why: OLIS would not give the file, or the night window closed. A document not checked is not a mismatch. */
  not_checked: { id: DocumentId; source_url: string; reason: string }[];
};

/** The report's file: `hash-sample-report.json`, in the directory of the database. */
export function hashSampleReportPath(databasePath: string): string {
  return join(dirname(databasePath), "hash-sample-report.json");
}

/** Writes the report whole or not at all. */
export function writeHashSampleReport(path: string, report: HashSampleReport): void {
  const partial = `${path}.partial`;
  writeFileSync(partial, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(partial, path);
}

/**
 * Draws `size` of the documents, without repeats, by a partial shuffle: each draw takes the item at an index
 * `random()` picks from those left. `random` returns a number in [0, 1), as `Math.random` does.
 */
export function drawSample(
  documents: readonly StoredDocumentHash[],
  size: number,
  random: () => number,
): StoredDocumentHash[] {
  const pool = [...documents];
  const count = Math.min(size, pool.length);
  for (let drawn = 0; drawn < count; drawn += 1) {
    const pick = drawn + Math.floor(random() * (pool.length - drawn));
    const chosen = pool[pick];
    const kept = pool[drawn];
    if (chosen === undefined || kept === undefined) throw new Error("The sample drew outside the documents");
    pool[drawn] = chosen;
    pool[pick] = kept;
  }
  return pool.slice(0, count);
}

const NIGHT_WINDOW_CLOSED = "The night window closed before it was fetched";

export async function sampleHashes(input: {
  session: SessionKey;
  documents: readonly StoredDocumentHash[];
  size: number;
  random: () => number;
  olis: OlisClient;
  clock: Clock;
  /** The worker's shutdown: it ends the sample with an error, as it ends any run. */
  signal: AbortSignal;
  /** The moment the sample must be over: no document is fetched at or after it. */
  deadline: Timestamp | undefined;
  /** Aborts when `deadline` comes, to stop a fetch that is still going then; its documents are reported as not checked. */
  windowSignal?: AbortSignal;
  /** The mismatches the last report held, to keep those tonight's draw does not check. */
  previous: readonly HashMismatch[];
}): Promise<HashSampleReport> {
  const { clock, deadline } = input;
  const drawn = drawSample(input.documents, input.size, input.random);
  const report: HashSampleReport = {
    session: input.session,
    as_of: formatPacific(clock.now()),
    sample_size: input.size,
    sampled: drawn.length,
    checked: 0,
    mismatches: [],
    not_checked: [],
  };
  const compared = new Set<DocumentId>();
  const closed = (document: StoredDocumentHash): void => {
    report.not_checked.push({ id: document.id, source_url: document.sourceUrl, reason: NIGHT_WINDOW_CLOSED });
  };
  const fetchSignal =
    input.windowSignal === undefined ? input.signal : AbortSignal.any([input.signal, input.windowSignal]);
  for (const document of drawn) {
    const now = formatPacific(clock.now());
    if (deadline !== undefined && compareTimestamps(now, deadline) >= 0) {
      closed(document);
      continue;
    }
    let download: Download;
    try {
      download = await input.olis.downloadStoredDocument(document.sourceUrl, fetchSignal);
    } catch (error) {
      // A shutdown is an error; the window closing in the middle of a fetch only leaves the document unchecked.
      if (input.signal.aborted || input.windowSignal?.aborted !== true) throw error;
      closed(document);
      continue;
    }
    switch (download.kind) {
      case "failed":
        report.not_checked.push({ id: document.id, source_url: document.sourceUrl, reason: download.reason });
        break;
      case "fetched": {
        report.checked += 1;
        compared.add(document.id);
        const newHash = createHash("sha256").update(download.bytes).digest("hex");
        if (newHash !== document.contentHash) {
          report.mismatches.push({
            id: document.id,
            source_url: document.sourceUrl,
            stored_hash: document.contentHash,
            new_hash: newHash,
            checked_at: now,
          });
        }
        break;
      }
      default:
        download satisfies never;
    }
  }
  // A mismatch stays in the report until a night compares the document and finds the stored file again: the draw is
  // about 200 documents of several thousand, so the night that found it may be the only one that checks it.
  const kept = input.previous.filter((mismatch) => !compared.has(mismatch.id));
  report.mismatches = [...kept, ...report.mismatches].toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return report;
}

const reportSchema = z.object({
  as_of: z.string(),
  mismatches: z.array(
    z.object({
      id: z.string(),
      source_url: z.string(),
      stored_hash: z.string(),
      new_hash: z.string(),
      checked_at: z.string(),
    }),
  ),
});

/**
 * What the last sample left in its report: when it began and the mismatches it held, or undefined while there is no
 * report. The report is the worker's own file, written whole; one that cannot be read or is not a report is a fault
 * of the machine and throws, with the cause.
 */
export function readHashSampleReport(
  databasePath: string,
): { as_of: Timestamp; mismatches: HashMismatch[] } | undefined {
  const path = hashSampleReportPath(databasePath);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = reportSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    const asOf = readTimestamp(parsed.as_of);
    if (asOf === undefined) throw new Error(`as_of is not a time: ${parsed.as_of}`);
    return {
      as_of: asOf,
      mismatches: parsed.mismatches.map((mismatch) => {
        const checkedAt = readTimestamp(mismatch.checked_at);
        if (checkedAt === undefined) throw new Error(`checked_at is not a time: ${mismatch.checked_at}`);
        return { ...mismatch, id: mismatch.id as DocumentId, checked_at: checkedAt };
      }),
    };
  } catch (error) {
    throw new Error(`The hash sample report cannot be read: ${path}`, { cause: error });
  }
}

/**
 * When the last sample began, from the report it left, or undefined while there is none: how a worker that restarts
 * in the night knows the night's sample has run.
 */
export function lastHashSampleAt(databasePath: string): Timestamp | undefined {
  return readHashSampleReport(databasePath)?.as_of;
}
