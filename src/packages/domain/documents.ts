// Documents, committees and meetings as the Session graph holds them, and the one place that mints
// their ids (src/CLAUDE.md, "Shape"). The forms are spec #1's (Implementation Decisions, "Session graph")
// and follow ADR-0004's `{kind}-{session}-{key}` shape for what only SessionGateway holds.

import type { MeasureId, MeasureKey } from "./index.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/** What a document is, in the glossary's words. */
export type DocumentKind =
  | "version"
  | "printed_amendment"
  | "proposed_amendment"
  | "analysis"
  | "exhibit"
  | "recording_log"
  | "testimony"
  | "agenda";

export const documentKinds: readonly DocumentKind[] = [
  "version",
  "printed_amendment",
  "proposed_amendment",
  "analysis",
  "exhibit",
  "recording_log",
  "testimony",
  "agenda",
];

/** The id of a document the store holds: what `get_document` takes. */
export type DocumentId = string & { readonly brand: "DocumentId" };
/** The id of a Proposed Amendment: one node per Measure and amendment number, whatever its postings. */
export type AmendmentId = string & { readonly brand: "AmendmentId" };

/** A node a document can point at. */
export type NodeId = MeasureId | AmendmentId;

/** How a document points at a node. */
export type Relation = "measure" | "committee" | "meeting" | "posted_to" | "amendment";

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

export function versionIdOf(key: MeasureKey, versionDescription: string): DocumentId {
  return `version-${measureSlug(key)}-${slug(versionDescription)}` as DocumentId;
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
  relations: DocumentRelation[];
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
