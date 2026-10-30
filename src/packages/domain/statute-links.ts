// Statute Links (GLOSSARY.md; ADR-0001). The ORS ids they point at are OregonAI's own forms
// (ADR-0004): `ors-163a.040` for a section, with a subsection cut back to its section, and
// `ors-chapter-657b` for a chapter, which OregonAI has no page for. Those ids are minted and parsed in
// oregonai.ts, the one module for OregonAI's id forms (src/CLAUDE.md, "Shape").
import type { OrsChapterId, OrsSectionId } from "./oregonai.ts";

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
