// Statute Links and the ORS ids they point at (GLOSSARY.md; ADR-0001, ADR-0004). The ids are
// OregonAI's own forms: `ors-163a.040` for a section, with a subsection cut back to its section,
// and `ors-chapter-657b` for a chapter, which OregonAI has no page for.

/** An ORS section's id in OregonAI's form: lower-case chapter, a dot, the section, as in `ors-163a.040`. */
export type OrsSectionId = string & { readonly brand: "OrsSectionId" };

/** An ORS chapter's id as SessionGateway mints it, as in `ors-chapter-657b`. OregonAI cannot resolve it. */
export type OrsChapterId = string & { readonly brand: "OrsChapterId" };

const sectionIdPattern = /^ors-(\d{1,3}[a-z]?)\.(\d{3,4})$/;
const chapterPattern = /^\d{1,3}[a-z]?$/;

/** Reads an id such as `ors-163a.040`, or undefined if the text is not one. */
export function parseOrsSectionId(text: string): OrsSectionId | undefined {
  return sectionIdPattern.test(text) ? (text as OrsSectionId) : undefined;
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

/** What a Statute Link does to its target (GLOSSARY.md, "Statute Link"). */
export type StatuteLinkKind = "amends" | "repeals" | "adds-to" | "cites";

/**
 * What a Statute Link points at. A section can be taken to OregonAI; a chapter cannot, so it is
 * marked and an agent does not fail looking it up (spec #1, story 27).
 */
export type StatuteTarget =
  | { type: "section"; id: OrsSectionId; resolvableOnOregonAi: true }
  | { type: "chapter"; id: OrsChapterId; resolvableOnOregonAi: false };

/**
 * One typed link from a Version or Proposed Amendment to an ORS section or chapter. The document it
 * came from is the caller's to record. `measureSection` is the number of the measure section the
 * link is read in as the text prints it ("8", or "21a" for a section inserted later), or null
 * when the text has no section headers.
 */
export type StatuteLink = {
  kind: StatuteLinkKind;
  target: StatuteTarget;
  measureSection: string | null;
};
