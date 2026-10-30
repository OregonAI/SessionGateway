// Statute Links (GLOSSARY.md; ADR-0001). The ORS ids they point at are OregonAI's own forms
// (ADR-0004): `ors-163a.040` for a section, with a subsection cut back to its section, and
// `ors-chapter-657b` for a chapter, which OregonAI has no page for. Those ids are minted and parsed in
// oregonai.ts, the one module for OregonAI's id forms (src/CLAUDE.md, "Shape").
import type { AmendmentHeader, AmendmentId, AmendmentPosting, DocumentId } from "./documents.ts";
import type { MeasureId } from "./index.ts";
import type { OrsChapterId, OrsSectionId } from "./oregonai.ts";

/**
 * What a Statute Link does to its target (GLOSSARY.md, "Statute Link"), in the order spec #1 (story 24) lists them:
 * the changes first, then the mentions. The one list: the database, the reader and the tools' output take the kinds from it.
 */
export const statuteLinkKinds = ["amends", "repeals", "adds-to", "cites"] as const;
export type StatuteLinkKind = (typeof statuteLinkKinds)[number];

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

/**
 * One edit a Proposed Amendment makes to the Measure's relating clause, the text that says what the Measure
 * does to the statutes ("Relating to ...; amending ORS 409.711."). It is what the amendment says, not the
 * clause after the edit: what the amendment deletes is not worked out (ADR-0001).
 */
export type RelatingClauseEdit = {
  /** The words the amendment quotes as deleted, or null when it quotes none. */
  deleted: string | null;
  /** The lines it deletes without quoting their words, as it names them: "line 3", "lines 3 and 4", "the rest of the line". */
  deletedLines: string[];
  /** The words it inserts, or null when it only deletes. */
  inserted: string | null;
  /** The ORS sections the inserted words name, ranges expanded, each once, in order. */
  insertedSections: OrsSectionId[];
};

/** The kinds of document whose Statute Links are read: a Version, and a posting of a Proposed Amendment (ADR-0015). */
export type StatuteLinkSource = "version" | "proposed_amendment";

/** What reading one file for Statute Links came to. */
export type StatuteParse = {
  /**
   * True when the file's text was read. False when it was not: the file has no text layer (a scan or a
   * photograph), or the ingest worker has not read it yet. `links` is then empty, and that does not
   * mean the document has no Statute Links.
   */
  textRead: boolean;
  /** For a posting: the Version and the Measure its header names, or null when the header could not be read. Always null for a Version. */
  amendedVersionHeader: AmendmentHeader | null;
  links: StatuteLink[];
  /** Edits to the relating clause. Always empty for a Version. */
  relatingClauseEdits: RelatingClauseEdit[];
};

/** What reading a file came to when it was not read: no header, no links and no edits. A fresh value each time. */
export function unreadStatuteParse(): StatuteParse {
  return { textRead: false, amendedVersionHeader: null, links: [], relatingClauseEdits: [] };
}

/** A Version the store holds, with what was read of its text. */
export type StoredVersion = {
  id: DocumentId;
  /** The feed's description of it: "Introduced", "A-Engrossed". */
  label: string;
  sourceUrl: string;
  parse: StatuteParse;
};

/** One file posted for a Proposed Amendment, with the postings it was posted as: postings of one amendment can share a file. */
export type AmendmentFile = {
  postingIds: DocumentId[];
  parse: StatuteParse;
};

/** A Proposed Amendment: the node, its Measure, every posting the feed lists for it (earliest meeting first) and the files the store holds of them. */
export type StoredAmendment = {
  id: AmendmentId;
  /** The amendment's number as its earliest posting writes it, trimmed: "-2", "-A3". */
  number: string;
  /**
   * Every distinct way the postings write the number, trimmed, earliest first. The feed writes one amendment's
   * number more than one way ("-1" and "1" for HB 2344's first), so the Version it names is read from all of them.
   */
  spellings: string[];
  measureId: MeasureId;
  postings: AmendmentPosting[];
  /** One for each distinct file the store holds among the postings, in the order of their first posting. */
  files: AmendmentFile[];
};
