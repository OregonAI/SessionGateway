// The nightly hash sample (ticket #20, ADR-0005, ADR-0040): a few stored documents are fetched again and their hashes
// compared with the stored ones, to catch a file replaced behind the same URL. A mismatch is reported and nothing is
// stored: a fetched document is unchanging (ADR-0002), so the index goes on serving the file it fetched, and the
// operator decides what a replaced file means.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { DocumentId } from "#/packages/domain/documents.ts";
import type { SessionKey } from "#/packages/domain/index.ts";
import type { OlisClient } from "#/packages/olis-client/index.ts";
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

type Stored = { id: DocumentId; sourceUrl: string; contentHash: string };

/**
 * Draws `size` of the documents, without repeats, by a partial shuffle: each draw takes the item at an index
 * `random()` picks from those left. `random` returns a number in [0, 1), as `Math.random` does.
 */
export function drawSample(documents: readonly Stored[], size: number, random: () => number): Stored[] {
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

export async function sampleHashes(input: {
  session: SessionKey;
  documents: readonly Stored[];
  size: number;
  random: () => number;
  olis: OlisClient;
  clock: Clock;
  signal: AbortSignal;
  /** The moment the sample must be over: no document is fetched at or after it. */
  deadline: Timestamp | undefined;
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
  for (const document of drawn) {
    const now = formatPacific(clock.now());
    if (deadline !== undefined && compareTimestamps(now, deadline) >= 0) {
      report.not_checked.push({
        id: document.id,
        source_url: document.sourceUrl,
        reason: "The night window closed before it was fetched",
      });
      continue;
    }
    const download = await input.olis.downloadStoredDocument(document.sourceUrl, input.signal);
    switch (download.kind) {
      case "failed":
        report.not_checked.push({ id: document.id, source_url: document.sourceUrl, reason: download.reason });
        break;
      case "fetched": {
        report.checked += 1;
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
  return report;
}

/**
 * When the last sample began, from the report it left, or undefined while there is none: how a worker that restarts
 * in the night knows the night's sample has run. The report is the worker's own file; one that cannot be read is no
 * sample, and the night's sample runs again.
 */
export function lastHashSampleAt(databasePath: string): Timestamp | undefined {
  const path = hashSampleReportPath(databasePath);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = z.object({ as_of: z.string() }).safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? readTimestamp(parsed.data.as_of) : undefined;
  } catch {
    return undefined;
  }
}
