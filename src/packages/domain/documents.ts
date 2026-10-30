// Documents, committees and meetings as the Session graph holds them, and the one place that mints
// their ids (src/CLAUDE.md, "Shape"). The forms are spec #1's (Implementation Decisions, "Session graph")
// and follow ADR-0004's `{kind}-{session}-{key}` shape for what only SessionGateway holds.

import type { MeasureId, MeasureKey, SessionKey } from "./index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/** What a document is, in the glossary's words. */
export const documentKinds = [
  "version",
  "printed_amendment",
  "proposed_amendment",
  "analysis",
  "exhibit",
  "recording_log",
  "testimony",
  "agenda",
] as const;
export type DocumentKind = (typeof documentKinds)[number];

/**
 * How a document points at a node: the Measure, committee or meeting it belongs to, the Version an
 * analysis is of or a Printed Amendment amends, the meeting a posting was posted to, the amendment a
 * posting is of.
 */
export const relations = ["measure", "committee", "meeting", "version", "posted_to", "amendment"] as const;
export type Relation = (typeof relations)[number];

/** The id of a document the store holds: what `get_document` takes. */
export type DocumentId = string & { readonly brand: "DocumentId" };
/** The id of a Proposed Amendment: one node per Measure and amendment number, whatever its postings. */
export type AmendmentId = string & { readonly brand: "AmendmentId" };
export type CommitteeId = string & { readonly brand: "CommitteeId" };
export type MeetingId = string & { readonly brand: "MeetingId" };

/** A node a document can point at. A Version is a document, so its id is a DocumentId. */
export type NodeId = MeasureId | AmendmentId | CommitteeId | MeetingId | DocumentId;

/** Lower case, with every run of other characters as one hyphen: "A-Engrossed" is "a-engrossed". */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function measureSlug(key: MeasureKey): string {
  return `${key.session.toLowerCase()}-${key.prefix.toLowerCase()}${key.number}`;
}

/**
 * Printed Amendments are the texts of amendments a chamber adopted ("House Amendments to
 * Introduced"); every other MeasureDocuments description names a Version.
 */
export function isPrintedAmendment(versionDescription: string): boolean {
  return /\bamendments\b/i.test(versionDescription);
}

/**
 * The description of the Version a Printed Amendment amends, which its own description names:
 * "Senate Amendments to A-Engrossed" amends "A-Engrossed". Undefined when the description names none.
 */
export function amendedVersionDescriptionOf(printedAmendmentDescription: string): string | undefined {
  const named = /\bamendments\s+to\s+(.+)$/i.exec(printedAmendmentDescription.trim())?.[1]?.trim();
  return named === undefined || named === "" ? undefined : named;
}

/** The id of a Version (`version-2025r1-sb69-a-engrossed`) or of a Printed Amendment, by the feed's description. */
export function versionIdOf(key: MeasureKey, versionDescription: string): DocumentId {
  const kind = isPrintedAmendment(versionDescription) ? "printed-amendment" : "version";
  return `${kind}-${measureSlug(key)}-${slug(versionDescription)}` as DocumentId;
}

/** SB 69-2 is `amendment-2025r1-sb69-2`; the feed writes the number "-2" or "-A3", and once "-2 " with a space. */
export function amendmentIdOf(key: MeasureKey, amendmentNumber: string): AmendmentId {
  return `amendment-${measureSlug(key)}-${slug(amendmentNumber)}` as AmendmentId;
}

/** One posting of a Proposed Amendment to a meeting, by the feed's `ProposedAmendmentId`. */
export function postingIdOf(session: SessionKey, proposedAmendmentId: number): DocumentId {
  return `posting-${session.toLowerCase()}-${proposedAmendmentId}` as DocumentId;
}

export function analysisIdOf(session: SessionKey, measureAnalysisId: string): DocumentId {
  return `analysis-${session.toLowerCase()}-${measureAnalysisId}` as DocumentId;
}

export function exhibitIdOf(session: SessionKey, committeeMeetingDocumentId: number): DocumentId {
  return `exhibit-${session.toLowerCase()}-${committeeMeetingDocumentId}` as DocumentId;
}

/**
 * A Recording Log is a CommitteeMeetingDocuments row like an Exhibit, but a document of its own kind:
 * the committee's timecoded index of the meeting's recording, not material posted to the record.
 */
export function recordingLogIdOf(session: SessionKey, committeeMeetingDocumentId: number): DocumentId {
  return `recording-log-${session.toLowerCase()}-${committeeMeetingDocumentId}` as DocumentId;
}

export function testimonyIdOf(session: SessionKey, commTestId: number): DocumentId {
  return `testimony-${session.toLowerCase()}-${commTestId}` as DocumentId;
}

const documentIdPattern =
  /^(version|printed-amendment|posting|analysis|exhibit|recording-log|testimony|agenda|amendment)-(\d{4}[a-z]\d)-([a-z0-9]+(?:-[a-z0-9]+)*)$/i;

/**
 * Reads what a caller wrote as the id of a document or of a Proposed Amendment of the deployment's
 * Session. Ids are minted in lower case, so capitals and spaces round the id are forgiven, as for a
 * Measure; the id comes back as minted. An id of another Session, of another kind of node (a Measure)
 * or of no form at all is not one: undefined.
 */
export function parseDocumentReference(text: string, session: SessionKey): DocumentId | AmendmentId | undefined {
  const trimmed = text.trim();
  const parts = documentIdPattern.exec(trimmed);
  if (parts?.[1] === undefined || parts[2] === undefined) return undefined;
  if (parts[2].toUpperCase() !== session) return undefined;
  return parts[1].toLowerCase() === "amendment"
    ? (trimmed.toLowerCase() as AmendmentId)
    : (trimmed.toLowerCase() as DocumentId);
}

export function committeeIdOf(session: SessionKey, committeeCode: string): CommitteeId {
  return `committee-${session.toLowerCase()}-${slug(committeeCode)}` as CommitteeId;
}

/** The part of a Timestamp that reads as the feed's wall clock: "2025-01-30-0800". */
function meetingKey(at: Timestamp): string {
  return `${at.slice(0, 10)}-${at.slice(11, 13)}${at.slice(14, 16)}`;
}

/** `meeting-2025r1-slb-2025-01-30-0800`: the committee and the Pacific wall-clock start of the meeting. */
export function meetingIdOf(session: SessionKey, committeeCode: string, at: Timestamp): MeetingId {
  return `meeting-${session.toLowerCase()}-${slug(committeeCode)}-${meetingKey(at)}` as MeetingId;
}

/** A meeting's agenda is a document of its own. */
export function agendaIdOf(session: SessionKey, committeeCode: string, at: Timestamp): DocumentId {
  return `agenda-${session.toLowerCase()}-${slug(committeeCode)}-${meetingKey(at)}` as DocumentId;
}

/** A node a document points at, and how, with where the feed said so. */
export type DocumentRelation = {
  relation: Relation;
  to: NodeId;
  /** For a posting: what the committee did with the amendment at that meeting (the feed's `Meaning`). */
  meaning: string | null;
  /** Where the feed said so, such as "CommitteeProposedAmendments 26284". */
  provenance: string;
};

/**
 * One document the feed links, before it is fetched: what the feed says about it, in domain terms.
 * `sourceUrl` is the link as OLIS gives it, percent-encoded; the store keeps it as the document's
 * `source_url`.
 */
export type DocumentLink = {
  id: DocumentId;
  /** The id a request may name instead: the Proposed Amendment a posting is of, else the id itself. */
  nodeId: DocumentId | AmendmentId;
  kind: DocumentKind;
  /** The feed's own name for it: the version description, the analysis type, the amendment number... */
  label: string;
  sourceUrl: string;
  /** When it was posted to a meeting, for a posting. */
  postedAt: Timestamp | null;
  /** For an analysis document: the feed's own `Version` label, "" when the feed gives none. */
  versionLabel?: string;
  relations: DocumentRelation[];
};

/** What a document or an amendment points at, with the document whose feed row says so. */
export type RelatedNode = {
  relation: Relation;
  to: NodeId;
  meaning: string | null;
  /** The document that carries the relation: for a posting, the one with the text posted to that meeting. */
  documentId: DocumentId;
};

/** What `get_document` resolves an id to: a document, and the nodes it (or the amendment's postings) point at. */
export type DocumentView = {
  /** The document whose text is served: the id asked for, or an amendment's latest posting. */
  document: Omit<StoredDocument, "relations">;
  related: RelatedNode[];
};

/** A document with its extracted text, as the store keeps it and the server reads it. */
export type StoredDocument = DocumentLink & {
  retrievedAt: Timestamp;
  /** The sha256 of the file OLIS served, in lower-case hex. */
  contentHash: string;
  pageCount: number;
  /** False when extraction found nothing but whitespace: a scan or a photograph. */
  hasTextLayer: boolean;
  /** The text exactly as the extractor read it, with a form feed between pages. */
  text: string;
};

export type Meeting = {
  session: SessionKey;
  committeeCode: string;
  id: MeetingId;
  committeeId: CommitteeId;
  at: Timestamp;
  /** The meeting's agenda, when the feed links one. */
  agenda: DocumentLink | null;
};

export type Committee = {
  session: SessionKey;
  code: string;
  id: CommitteeId;
  name: string;
};

/** What the index holds of a Session. */
export type IndexCounts = {
  measures: number;
  committees: number;
  meetings: number;
  /** Proposed Amendments as nodes: one per Measure and amendment number, however many postings. */
  proposedAmendments: number;
  /** Documents the store holds, one per file fetched (a Proposed Amendment has one for each posting). */
  documents: number;
  documentsWithoutTextLayer: number;
  documentsByKind: Record<DocumentKind, number>;
};
