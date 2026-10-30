// Statute Links and the ORS ids they point at (GLOSSARY.md; ADR-0001, ADR-0004). The ids are
// OregonAI's own forms: `ors-163a.040` for a section, with a subsection cut back to its section,
// and `ors-chapter-657b` for a chapter, which OregonAI has no page for.

/** An ORS section's id in OregonAI's form: lower-case chapter, a dot, the section, as in `ors-163a.040`. */
export type OrsSectionId = string & { readonly brand: "OrsSectionId" };

/** An ORS chapter's id as SessionGateway mints it, as in `ors-chapter-657b`. OregonAI cannot resolve it. */
export type OrsChapterId = string & { readonly brand: "OrsChapterId" };

// The one place the shape of an ORS chapter and section is spelled (#6 F9). A chapter is one to three
// digits and perhaps a letter ("163", "163A", "657B"); a section is that, a dot and three or four digits
// ("163A.040"). Text prints the letter in upper case and an id in lower case.
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

/** Reads an id such as `ors-163a.040`, or undefined if the text is not one. */
export function parseOrsSectionId(text: string): OrsSectionId | undefined {
  return sectionIdPattern.test(text) && text === text.toLowerCase() ? (text as OrsSectionId) : undefined;
}

/** Where an ORS section sorts: the chapter's number, then its letter ("163" before "163A"), then the section. */
export type OrsSectionParts = { chapter: number; letter: string; section: number };

/** Takes an id apart into the parts ORS order sorts by. */
export function orsSectionPartsOf(id: OrsSectionId): OrsSectionParts {
  const match = sectionPartsPattern.exec(id);
  // An OrsSectionId is minted by parseOrsSectionId, which accepts only this shape.
  if (match?.[1] === undefined || match[3] === undefined) throw new Error(`not an ORS section id: ${id}`);
  return { chapter: Number(match[1]), letter: match[2] ?? "", section: Number(match[3]) };
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
