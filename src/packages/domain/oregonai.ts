// The words of the OregonAI side of the pairing (ADR-0004) as types: the ids of Agencies and of ORS
// sections and chapters, and the version of the snapshot copied from OregonAI at build time. Like
// index.ts, this is where the ids are minted and parsed (src/CLAUDE.md, "Shape"): the snapshot, the
// Statute Link parser (statute-links.ts), the Agency Link extractor and the build scripts all take
// OregonAI's id forms from here.
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * An Agency's id (GLOSSARY.md, "Agency"): its slug in the OregonAI agency registry, such as
 * `department-of-environmental-quality`. The snapshot and the Agency Link extractor both use this one.
 */
export type AgencyId = string & { readonly brand: "AgencyId" };

const agencyIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reads a registry slug such as `department-of-human-services` as an Agency id, or undefined if it is not one. */
export function parseAgencyId(text: string): AgencyId | undefined {
  return agencyIdPattern.test(text) ? (text as AgencyId) : undefined;
}

/** An ORS section's id in OregonAI's form: lower-case chapter, a dot, the section, as in `ors-468.130` or `ors-163a.040`. */
export type OrsSectionId = string & { readonly brand: "OrsSectionId" };

/**
 * An ORS chapter's id as SessionGateway mints it, `ors-chapter-657b`. OregonAI has no id for a chapter
 * (ADR-0004), so this one is not resolvable there.
 */
export type OrsChapterId = string & { readonly brand: "OrsChapterId" };

// The one place the shape of an ORS chapter and section is spelled (#6 F9). A chapter is one to three
// digits and perhaps a letter ("163", "163A", "657B"); a section is that, a dot and three or four digits
// ("163A.040"). Text prints the letter in upper case and an id in lower case. Every one of the 37,534
// statute ids of the executive-regulatory-frameworks checkout the snapshot was built from has this shape.
const chapterDigits = String.raw`\d{1,3}`;
const chapterLetter = String.raw`[A-Z]?`;
const sectionDigits = String.raw`\d{3,4}`;
const chapterShape = `${chapterDigits}${chapterLetter}`;

/** Source of a regular expression for an ORS section as text prints it, such as "163A.040". For the parsers that find citations in text. */
export const orsSectionCitationSource = String.raw`${chapterShape}\.${sectionDigits}`;
/** Source of a regular expression for an ORS chapter as text prints it, such as "657B". */
export const orsChapterCitationSource = chapterShape;

const sectionIdPattern = new RegExp(String.raw`^ors-${chapterShape}\.${sectionDigits}$`, "i");
const sectionPartsPattern = new RegExp(String.raw`^ors-(${chapterDigits})(${chapterLetter})\.(${sectionDigits})$`, "i");
const chapterPattern = new RegExp(String.raw`^${chapterShape}$`, "i");
const chapterIdPattern = new RegExp(String.raw`^ors-chapter-${chapterShape}$`, "i");

/** Reads an id such as `ors-163a.040`, or undefined if the text is not one. */
export function parseOrsSectionId(text: string): OrsSectionId | undefined {
  return sectionIdPattern.test(text) && text === text.toLowerCase() ? (text as OrsSectionId) : undefined;
}

/** Reads an id such as `ors-chapter-657b`, or undefined if the text is not one. */
export function parseOrsChapterId(text: string): OrsChapterId | undefined {
  return chapterIdPattern.test(text) && text === text.toLowerCase() ? (text as OrsChapterId) : undefined;
}

/** Where an ORS section sorts: the chapter's number, then its letter ("163" before "163A"), then the section. */
export type OrsSectionParts = { chapter: number; letter: string; section: number };

/** The chapter, letter and section of an id, as the id writes them. */
function sectionMatchOf(id: OrsSectionId): { chapter: string; letter: string; section: string } {
  const match = sectionPartsPattern.exec(id);
  // An OrsSectionId is minted by parseOrsSectionId, which accepts only this shape.
  if (match?.[1] === undefined || match[3] === undefined) throw new Error(`Not an ORS section id: ${id}`);
  return { chapter: match[1], letter: match[2] ?? "", section: match[3] };
}

/**
 * The section as text prints it, the other way round from `orsSectionIdOf`: `ors-163a.040` is "163A.040" (the
 * chapter's letter in upper case). Whatever needs the words a section is written with in a document gets them here.
 */
export function orsSectionCitationOf(id: OrsSectionId): string {
  const parts = sectionMatchOf(id);
  return `${parts.chapter}${parts.letter.toUpperCase()}.${parts.section}`;
}

/** Takes an id apart into the parts ORS order sorts by. */
export function orsSectionPartsOf(id: OrsSectionId): OrsSectionParts {
  const parts = sectionMatchOf(id);
  return { chapter: Number(parts.chapter), letter: parts.letter, section: Number(parts.section) };
}

/** Orders ORS section ids as the ORS does: by chapter number, then chapter letter, then section. */
export function compareOrsSectionIds(a: OrsSectionId, b: OrsSectionId): number {
  const left = orsSectionPartsOf(a);
  const right = orsSectionPartsOf(b);
  if (left.chapter !== right.chapter) return left.chapter - right.chapter;
  if (left.letter !== right.letter) return left.letter < right.letter ? -1 : 1;
  return left.section - right.section;
}

/** Mints the id of the ORS section a citation such as "163A.040" names, or undefined if it is not one. */
export function orsSectionIdOf(citation: string): OrsSectionId | undefined {
  return parseOrsSectionId(`ors-${citation.toLowerCase()}`);
}

/** Mints the id of the ORS chapter a citation such as "657B" names, or undefined if it is not one. */
export function orsChapterIdOf(chapter: string): OrsChapterId | undefined {
  const lower = chapter.toLowerCase();
  return chapterPattern.test(lower) ? (`ors-chapter-${lower}` as OrsChapterId) : undefined;
}

/** The chapter an ORS section belongs to: `ors-468.130` is in `ors-chapter-468`. */
export function orsChapterOf(section: OrsSectionId): OrsChapterId {
  const parts = sectionMatchOf(section);
  return `ors-chapter-${parts.chapter}${parts.letter}` as OrsChapterId;
}

/** The ORS chapters that have a section among these. */
export function orsChaptersOf(sections: Iterable<OrsSectionId>): Set<OrsChapterId> {
  return new Set([...sections].map(orsChapterOf));
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
