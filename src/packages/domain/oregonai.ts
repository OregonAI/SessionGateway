// The words of the OregonAI side of the pairing (ADR-0004) as types: the ids of Agencies and of ORS
// sections and chapters, and the version of the snapshot copied from OregonAI at build time. Like
// index.ts, this is where the ids are minted and parsed (src/CLAUDE.md, "Shape").
import type { Timestamp } from "#/packages/time/pacific.ts";

/** An Agency's id: the slug of the OregonAI agency registry, such as `department-of-environmental-quality`. */
export type AgencySlug = string & { readonly brand: "AgencySlug" };

const agencySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseAgencySlug(text: string): AgencySlug | undefined {
  return agencySlugPattern.test(text) ? (text as AgencySlug) : undefined;
}

/** An ORS section's id in OregonAI's form: `ors-468.130`, `ors-163a.040` (lower-case letter suffix). */
export type OrsSectionId = string & { readonly brand: "OrsSectionId" };

const orsSectionPattern = /^ors-(\d+[a-z]?)\.(\d+[a-z]?)$/;

export function parseOrsSectionId(text: string): OrsSectionId | undefined {
  return orsSectionPattern.test(text) ? (text as OrsSectionId) : undefined;
}

/**
 * An ORS chapter's id as SessionGateway mints it, `ors-chapter-657b`. OregonAI has no id for a chapter
 * (ADR-0004), so this one is not resolvable there.
 */
export type OrsChapterId = string & { readonly brand: "OrsChapterId" };

const orsChapterPattern = /^ors-chapter-(\d+[a-z]?)$/;

export function parseOrsChapterId(text: string): OrsChapterId | undefined {
  return orsChapterPattern.test(text) ? (text as OrsChapterId) : undefined;
}

/** The chapter an ORS section belongs to: `ors-468.130` is in `ors-chapter-468`. */
export function orsChapterOf(section: OrsSectionId): OrsChapterId {
  const match = orsSectionPattern.exec(section);
  const chapter = match?.[1];
  if (chapter === undefined) throw new Error(`Not an ORS section id: ${section}`);
  return `ors-chapter-${chapter}` as OrsChapterId;
}

/**
 * Which copy of OregonAI's data a snapshot is: the repository it was read from and the commit of that
 * repository, with the commit's date in Pacific time and its UTC offset (as every time here is).
 * Only the executive-regulatory-frameworks corpus is copied (ADR-0004).
 */
export type SnapshotVersion = {
  source: "executive-regulatory-frameworks";
  /** The full 40-character commit SHA. */
  commit: string;
  commitDate: Timestamp;
};
