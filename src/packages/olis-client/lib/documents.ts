// The documents the feed links (spec #1, "OLIS client"): which rows link one, what each document is
// called in the graph, and how it is fetched. The rows are the feed's own shapes and stay in here.
import { z } from "zod";
import { placeAnalysis } from "#/packages/domain/analysis.ts";
import { measureIdOf, type MeasureKey, type SessionKey } from "#/packages/domain/index.ts";
import {
  amendedVersionDescriptionOf,
  amendmentIdOf,
  analysisIdOf,
  committeeIdOf,
  exhibitIdOf,
  isPrintedAmendment,
  meetingIdOf,
  postingIdOf,
  recordingLogIdOf,
  testimonyIdOf,
  versionIdOf,
  type DocumentId,
  type DocumentLink,
  type DocumentRelation,
} from "#/packages/domain/documents.ts";
import { readEntitySet } from "./feed.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { feedTimestamp } from "./timestamps.ts";
import type { OlisClientOptions } from "./options.ts";

/** Every document OLIS links is on this origin (docs/research/olis-odata.md section 4). */
const OLIS_LINK_ORIGIN = "https://olis.oregonlegislature.gov";

/**
 * The link as OLIS gives it, made safe to use: raw spaces in a MeasureDocuments URL are
 * percent-encoded (olis-odata.md gotcha 10), and a link to any other origin is refused, so the worker
 * only ever fetches from OLIS.
 */
export function sourceUrlOf(link: string): string {
  const url = new URL(link);
  if (url.origin !== OLIS_LINK_ORIGIN) {
    throw new Error(`OLIS linked a document outside ${OLIS_LINK_ORIGIN}: ${url.origin}`);
  }
  return url.href;
}

/** Where a document is fetched from: its path on OLIS, at the origin the deployment names. */
export function downloadUrlOf(sourceUrl: string, documentOrigin: string): URL {
  const url = new URL(sourceUrl);
  return new URL(url.pathname + url.search, documentOrigin);
}

/**
 * The rows of one entity set that belong to the Session. The `$filter` asks the feed for them; the
 * check that follows keeps a row of another Session out even from a feed that ignored the filter.
 */
async function readSessionRows<Row extends { SessionKey: string }>(
  options: OlisClientOptions,
  entitySet: string,
  session: SessionKey,
  rowSchema: z.ZodType<Row>,
  signal: AbortSignal,
): Promise<Row[]> {
  const rows = await readEntitySet(options, entitySet, `SessionKey eq '${session}'`, rowSchema, signal);
  return rows.filter((row) => row.SessionKey === session);
}

function measureRelation(key: MeasureKey, provenance: string): DocumentRelation {
  return { relation: "measure", to: measureIdOf(key), meaning: null, provenance };
}

function versionRelation(version: DocumentId, provenance: string): DocumentRelation {
  return { relation: "version", to: version, meaning: null, provenance };
}

function committeeRelation(session: SessionKey, committeeCode: string, provenance: string): DocumentRelation {
  return { relation: "committee", to: committeeIdOf(session, committeeCode), meaning: null, provenance };
}

/**
 * What a document posted for a meeting points at: the meeting, its committee and, when the row names
 * one, the Measure. The same for an Exhibit and for Testimony.
 */
function meetingBoundRelations(
  session: SessionKey,
  row: {
    CommitteeCode: string;
    MeetingDate: Timestamp;
    MeasurePrefix: string | null;
    MeasureNumber: number | null;
  },
  provenance: string,
): DocumentRelation[] {
  const relations: DocumentRelation[] = [
    {
      relation: "meeting",
      to: meetingIdOf(session, row.CommitteeCode, row.MeetingDate),
      meaning: null,
      provenance,
    },
    committeeRelation(session, row.CommitteeCode, provenance),
  ];
  if (row.MeasurePrefix !== null && row.MeasureNumber !== null) {
    relations.push(measureRelation({ session, prefix: row.MeasurePrefix, number: row.MeasureNumber }, provenance));
  }
  return relations;
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
  const rows = await readSessionRows(options, "MeasureDocuments", session, measureDocumentRow, signal);
  // A Printed Amendment points at the Version its description names, but only at one the feed lists.
  const versions = new Set(
    rows
      .filter((row) => !isPrintedAmendment(row.VersionDescription))
      .map((row) =>
        versionIdOf({ session, prefix: row.MeasurePrefix, number: row.MeasureNumber }, row.VersionDescription),
      ),
  );
  return rows.map((row) => {
    const key = { session, prefix: row.MeasurePrefix, number: row.MeasureNumber };
    const id = versionIdOf(key, row.VersionDescription);
    const provenance = `MeasureDocuments ${row.MeasurePrefix}${row.MeasureNumber} ${row.VersionDescription}`;
    const relations = [measureRelation(key, provenance)];
    const amended = isPrintedAmendment(row.VersionDescription)
      ? amendedVersionDescriptionOf(row.VersionDescription)
      : undefined;
    if (amended !== undefined) {
      const amendedId = versionIdOf(key, amended);
      if (versions.has(amendedId)) relations.push(versionRelation(amendedId, provenance));
    }
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
  // "INTRO", "A", "B", ...; blank on most rows (olis-odata.md gotcha 9).
  Version: z.string().nullish(),
  // True for the 18 rows of the 2025R1 cache that are a minority report's (docs/adr/0013).
  IsMinority: z.boolean(),
  DocumentUrl: z.string(),
});

async function readAnalyses(
  options: OlisClientOptions,
  session: SessionKey,
  versions: ReadonlySet<DocumentId>,
  signal: AbortSignal,
): Promise<DocumentLink[]> {
  const rows = await readSessionRows(options, "MeasureAnalysisDocuments", session, analysisRow, signal);
  return rows.map((row) => {
    const key = { session, prefix: row.MeasurePrefix, number: row.MeasureNumber };
    const id = analysisIdOf(session, row.MeasureAnalysisId);
    const provenance = `MeasureAnalysisDocuments ${row.MeasureAnalysisId}`;
    const relations = [measureRelation(key, provenance), committeeRelation(session, row.CommittteCode, provenance)];
    // The one reading of the row, which get_measure shares (domain/analysis.ts). A Version is a node
    // only when the feed lists it for the Measure, so a label that names a Version it lacks points nowhere.
    const versionLabel = row.Version ?? "";
    const isMinority = row.IsMinority;
    const placement = placeAnalysis(key, { versionLabel, isMinority }, (version) => versions.has(version));
    switch (placement.kind) {
      case "version":
        relations.push(versionRelation(placement.versionId, provenance));
        break;
      case "unmapped":
        break;
      default:
        placement satisfies never;
    }
    return {
      id,
      nodeId: id,
      kind: "analysis",
      label: row.DocumentType,
      sourceUrl: sourceUrlOf(row.DocumentUrl),
      postedAt: null,
      versionLabel,
      isMinority,
      relations,
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
  const rows = await readSessionRows(options, "CommitteeMeetingDocuments", session, exhibitRow, signal);
  return rows.map((row) => {
    const isRecordingLog = row.DocumentType === "Recording Log";
    const id = isRecordingLog
      ? recordingLogIdOf(session, row.CommitteeMeetingDocumentId)
      : exhibitIdOf(session, row.CommitteeMeetingDocumentId);
    return {
      id,
      nodeId: id,
      kind: isRecordingLog ? "recording_log" : "exhibit",
      label: row.DocumentType,
      sourceUrl: sourceUrlOf(row.DocumentUrl),
      postedAt: null,
      relations: meetingBoundRelations(session, row, `CommitteeMeetingDocuments ${row.CommitteeMeetingDocumentId}`),
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
  const rows = await readSessionRows(options, "CommitteePublicTestimonies", session, testimonyRow, signal);
  return rows.map((row) => {
    const id = testimonyIdOf(session, row.CommTestId);
    const root = sourceUrlOf(row.DocumentUrl).replace(/\/$/, "");
    return {
      id,
      nodeId: id,
      kind: "testimony",
      label: row.DocumentDescription,
      sourceUrl: `${root}/Downloads/PublicTestimonyDocument/${row.CommTestId}`,
      postedAt: null,
      relations: meetingBoundRelations(session, row, `CommitteePublicTestimonies ${row.CommTestId}`),
    };
  });
}

// A Proposed Amendment is one node per Measure and amendment number; each row is one posting of it to a
// meeting, with a file of its own, which may differ from the file posted to another meeting. The feed
// writes the amendment number "-2 " with a trailing space once (SB 921, ProposedAmendmentId 26923).
const postingRow = z.looseObject({
  SessionKey: z.string(),
  ProposedAmendmentId: z.number().int(),
  CommitteeCode: z.string(),
  MeetingDate: feedTimestamp,
  MeasurePrefix: z.string(),
  MeasureNumber: z.number().int(),
  AmendmentNumber: z.string(),
  Meaning: z.string(),
  ProposedAmendmentUrl: z.string(),
});

async function readPostings(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<DocumentLink[]> {
  const rows = await readSessionRows(options, "CommitteeProposedAmendments", session, postingRow, signal);
  return rows.map((row) => {
    const key = { session, prefix: row.MeasurePrefix, number: row.MeasureNumber };
    const amendmentNumber = row.AmendmentNumber.trim();
    const provenance = `CommitteeProposedAmendments ${row.ProposedAmendmentId}`;
    const meaning = row.Meaning.trim();
    return {
      id: postingIdOf(session, row.ProposedAmendmentId),
      nodeId: amendmentIdOf(key, amendmentNumber),
      kind: "proposed_amendment",
      label: amendmentNumber,
      sourceUrl: sourceUrlOf(row.ProposedAmendmentUrl),
      postedAt: row.MeetingDate,
      relations: [
        measureRelation(key, provenance),
        committeeRelation(session, row.CommitteeCode, provenance),
        {
          relation: "posted_to",
          to: meetingIdOf(session, row.CommitteeCode, row.MeetingDate),
          meaning: meaning === "" ? null : meaning,
          provenance,
        },
        { relation: "amendment", to: amendmentIdOf(key, amendmentNumber), meaning: null, provenance },
      ],
    };
  });
}

export async function readDocumentLinks(
  options: OlisClientOptions,
  session: SessionKey,
  signal: AbortSignal,
): Promise<DocumentLink[]> {
  const versions = await readVersions(options, session, signal);
  const versionIds = new Set(versions.filter((link) => link.kind === "version").map((link) => link.id));
  const analyses = await readAnalyses(options, session, versionIds, signal);
  const exhibits = await readExhibits(options, session, signal);
  const postings = await readPostings(options, session, signal);
  const testimony = await readTestimony(options, session, signal);
  return [...versions, ...analyses, ...postings, ...exhibits, ...testimony];
}

/** The bytes of one document, or why they could not be had. */
export type Download = { kind: "fetched"; bytes: Uint8Array } | { kind: "failed"; reason: string };

/**
 * OLIS downloads are slow and occasionally time out; every one of the six that did in the research
 * succeeded on retry, in 0.5 to 5.2 seconds (olis-odata.md gotcha 15). A document is tried three
 * times, with a pause before the second and the third.
 */
const PAUSES_BEFORE_RETRY_MS = [2_000, 10_000];

/** An answer that says "try again": a timeout, too many requests, or OLIS having trouble. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function downloadDocument(
  options: OlisClientOptions,
  link: DocumentLink,
  signal: AbortSignal,
): Promise<Download> {
  const url = downloadUrlOf(link.sourceUrl, options.documents.origin);
  let reason = "";
  for (let attempt = 0; attempt <= PAUSES_BEFORE_RETRY_MS.length; attempt += 1) {
    const pause = PAUSES_BEFORE_RETRY_MS[attempt - 1];
    if (pause !== undefined) await options.documents.pause(pause, signal);
    try {
      const response = await options.fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(options.documents.timeoutMs)]),
      });
      if (response.ok) return { kind: "fetched", bytes: new Uint8Array(await response.arrayBuffer()) };
      reason = `OLIS answered ${response.status} to ${url.pathname}`;
      if (!isTransientStatus(response.status)) return { kind: "failed", reason };
    } catch (error) {
      // A shutdown ends the pull; a request that timed out or broke off is tried again.
      if (signal.aborted) throw error;
      reason = `OLIS did not answer ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return { kind: "failed", reason: `${reason} (${PAUSES_BEFORE_RETRY_MS.length + 1} attempts)` };
}
