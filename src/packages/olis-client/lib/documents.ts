// The documents the feed links (spec #1, "OLIS client"): which rows link one, what each document is
// called in the graph, and how it is fetched. The rows are the feed's own shapes and stay in here.
import { z } from "zod";
import { measureIdOf, type SessionKey } from "#/packages/domain/index.ts";
import {
  analysisIdOf,
  committeeIdOf,
  exhibitIdOf,
  isPrintedAmendment,
  meetingIdOf,
  testimonyIdOf,
  versionIdOf,
  type DocumentLink,
  type DocumentRelation,
} from "#/packages/domain/documents.ts";
import { readEntitySet } from "./feed.ts";
import { feedTimestamp } from "./timestamps.ts";
import type { OlisClientOptions } from "./options.ts";

/** Every document OLIS links is on this origin (docs/research/olis-odata.md section 4). */
const OLIS_DOCUMENT_ORIGIN = "https://olis.oregonlegislature.gov";

/**
 * The link as OLIS gives it, made safe to use: raw spaces in a MeasureDocuments URL are
 * percent-encoded (olis-odata.md gotcha 10), and a link to any other origin is refused, so the worker
 * only ever fetches from OLIS.
 */
export function sourceUrlOf(link: string): string {
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
        kind: isPrintedAmendment(row.VersionDescription) ? "printed_amendment" : "version",
        label: row.VersionDescription,
        sourceUrl: sourceUrlOf(row.DocumentUrl),
        postedAt: null,
        relations,
      };
    });
}

// The feed spells the committee property `CommittteCode` (three t's) and serializes the decimal key
// `MeasureAnalysisId` as a string (olis-odata.md section 8, gotchas 1 and 7).
const analysisRow = z.looseObject({
  SessionKey: z.string(),
  MeasureAnalysisId: z.string().regex(/^\d+$/),
  CommittteCode: z.string(),
  DocumentType: z.string(),
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  DocumentUrl: z.string(),
});

async function readAnalyses(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<DocumentLink[]> {
  const rows = await readEntitySet(
    options,
    "MeasureAnalysisDocuments",
    `SessionKey eq '${session}'`,
    analysisRow,
    signal,
  );
  return rows
    .filter((row) => row.SessionKey === session)
    .map((row) => {
      const key = { session, prefix: row.MeasurePrefix, number: row.MeasureNumber };
      const id = analysisIdOf(session, row.MeasureAnalysisId);
      const provenance = `MeasureAnalysisDocuments ${row.MeasureAnalysisId}`;
      return {
        id,
        nodeId: id,
        kind: "analysis",
        label: row.DocumentType,
        sourceUrl: sourceUrlOf(row.DocumentUrl),
        postedAt: null,
        relations: [
          { relation: "measure", to: measureIdOf(key), meaning: null, provenance },
          { relation: "committee", to: committeeIdOf(session, row.CommittteCode), meaning: null, provenance },
        ],
      };
    });
}

// An Exhibit row has no navigation to a Measure: `MeasurePrefix` and `MeasureNumber` are null when the
// document belongs to the meeting alone (olis-odata.md section 2).
const exhibitRow = z.looseObject({
  SessionKey: z.string(),
  CommitteeMeetingDocumentId: z.number().int(),
  CommitteeCode: z.string(),
  MeetingDate: feedTimestamp,
  DocumentType: z.string(),
  MeasurePrefix: z.string().nullable(),
  MeasureNumber: z.number().int().nullable(),
  DocumentUrl: z.string(),
});

async function readExhibits(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<DocumentLink[]> {
  const rows = await readEntitySet(
    options,
    "CommitteeMeetingDocuments",
    `SessionKey eq '${session}'`,
    exhibitRow,
    signal,
  );
  return rows
    .filter((row) => row.SessionKey === session)
    .map((row) => {
      const id = exhibitIdOf(session, row.CommitteeMeetingDocumentId);
      const provenance = `CommitteeMeetingDocuments ${row.CommitteeMeetingDocumentId}`;
      const relations: DocumentRelation[] = [
        {
          relation: "meeting",
          to: meetingIdOf(session, row.CommitteeCode, row.MeetingDate),
          meaning: null,
          provenance,
        },
        { relation: "committee", to: committeeIdOf(session, row.CommitteeCode), meaning: null, provenance },
      ];
      if (row.MeasurePrefix !== null && row.MeasureNumber !== null) {
        const key = { session, prefix: row.MeasurePrefix, number: row.MeasureNumber };
        relations.push({ relation: "measure", to: measureIdOf(key), meaning: null, provenance });
      }
      return {
        id,
        nodeId: id,
        kind: "exhibit",
        label: row.DocumentType,
        sourceUrl: sourceUrlOf(row.DocumentUrl),
        postedAt: null,
        relations,
      };
    });
}

// A Testimony row's `DocumentUrl` is only the Session's root on OLIS, for every row (olis-odata.md
// gotcha 2); the file is at /Downloads/PublicTestimonyDocument/{CommTestId} below it.
const testimonyRow = z.looseObject({
  SessionKey: z.string(),
  CommTestId: z.number().int(),
  CommitteeCode: z.string(),
  MeetingDate: feedTimestamp,
  DocumentDescription: z.string(),
  MeasurePrefix: z.string().nullable(),
  MeasureNumber: z.number().int().nullable(),
  DocumentUrl: z.string(),
});

async function readTestimony(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<DocumentLink[]> {
  const rows = await readEntitySet(
    options,
    "CommitteePublicTestimonies",
    `SessionKey eq '${session}'`,
    testimonyRow,
    signal,
  );
  return rows
    .filter((row) => row.SessionKey === session)
    .map((row) => {
      const id = testimonyIdOf(session, row.CommTestId);
      const provenance = `CommitteePublicTestimonies ${row.CommTestId}`;
      const root = sourceUrlOf(row.DocumentUrl).replace(/\/$/, "");
      const relations: DocumentRelation[] = [
        {
          relation: "meeting",
          to: meetingIdOf(session, row.CommitteeCode, row.MeetingDate),
          meaning: null,
          provenance,
        },
        { relation: "committee", to: committeeIdOf(session, row.CommitteeCode), meaning: null, provenance },
      ];
      if (row.MeasurePrefix !== null && row.MeasureNumber !== null) {
        const key = { session, prefix: row.MeasurePrefix, number: row.MeasureNumber };
        relations.push({ relation: "measure", to: measureIdOf(key), meaning: null, provenance });
      }
      return {
        id,
        nodeId: id,
        kind: "testimony",
        label: row.DocumentDescription,
        sourceUrl: `${root}/Downloads/PublicTestimonyDocument/${row.CommTestId}`,
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
  const versions = await readVersions(options, session, signal);
  const analyses = await readAnalyses(options, session, signal);
  const exhibits = await readExhibits(options, session, signal);
  const testimony = await readTestimony(options, session, signal);
  return [...versions, ...analyses, ...exhibits, ...testimony];
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
