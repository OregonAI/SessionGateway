// Statute Links (GLOSSARY.md; ADR-0001). The ORS ids they point at are OregonAI's own forms
// (ADR-0004): `ors-163a.040` for a section, with a subsection cut back to its section, and
// `ors-chapter-657b` for a chapter, which OregonAI has no page for. Those ids are minted and parsed in
// oregonai.ts, the one module for OregonAI's id forms (src/CLAUDE.md, "Shape").
import {
  versionDescriptionOfLetter,
  type AmendmentHeader,
  type AmendmentId,
  type AmendmentPosting,
  type DocumentId,
} from "./documents.ts";
import type { MeasureId } from "./index.ts";
import type { OrsChapterId, OrsSectionId } from "./oregonai.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

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
 * The letters the Statutes Affected Table (GLOSSARY.md) puts beside an ORS target: "A" for an amendment, "R" for a
 * repeal, "Add" for a section "added to and made a part of" a chapter or series. The table has no letter for a citation.
 */
export const tableActions = ["A", "R", "Add"] as const;
export type TableAction = (typeof tableActions)[number];

/** The kind of Statute Link a table action says: the table's "A" is a link that amends, its "R" one that repeals, its "Add" one that adds to. */
export const statuteLinkKindOfTableAction: Record<TableAction, Exclude<StatuteLinkKind, "cites">> = {
  A: "amends",
  R: "repeals",
  Add: "adds-to",
};

/** The kinds the table can say, which are the kinds that change the law: every kind but "cites". */
export const statuteChangeKinds = statuteLinkKinds.filter(
  (kind): kind is Exclude<StatuteLinkKind, "cites"> => kind !== "cites",
);

/**
 * One row of the Statutes Affected Table (GLOSSARY.md, "Table entry"): an ORS section or chapter, what the Measure does
 * to it, the measure section that does it, and the Measure with the engrossing level the table made the row from. A
 * series the table prints once ("9.005 to 9.757") is one entry for each section of it that the snapshot lists.
 */
export type StatutesAffectedEntry = {
  /** The Measure the row is for. The table is of one Session, so it names no Session. */
  measure: { prefix: string; number: number };
  /**
   * The engrossing level printed beside the Measure: "A" for the A-Engrossed Version, "B", "C", or a longer one such as
   * "BCC" (a conference committee report). Null when none is printed, which is the Introduced Version.
   */
  level: string | null;
  action: TableAction;
  /** The ORS section or chapter. A chapter is marked as having no OregonAI id, as a parsed link's is. */
  target: StatuteTarget;
  /** The measure section as the table prints it after the section sign ("8", "93a"). */
  measureSection: string;
  /** True when the table's last column has an "E": an emergency clause applies. */
  emergency: boolean;
};

/**
 * The description of the Version a table entry's level names, in the words the feed describes Versions in:
 * no level is "Introduced", the letter "A" is "A-Engrossed". A level of more than one letter ("BCC", a conference
 * committee report) names no Version the store holds as such, so nothing is guessed: undefined.
 */
export function versionDescriptionOfTableLevel(level: string | null): string | undefined {
  if (level === null) return versionDescriptionOfLetter(null);
  return /^[A-Z]$/.test(level) ? versionDescriptionOfLetter(level) : undefined;
}

/**
 * Legislative Counsel's table as the Index holds it, for one Measure: where the Index got it, when, and the entries
 * the table has for the Measure, in the table's order. Empty when the table lists none.
 */
export type StatutesAffectedTableOfMeasure = {
  /** The address the worker fetched the table from, as the deployment names it. */
  sourceUrl: string;
  /** When the Index retrieved the bytes it holds, in Pacific time with its offset. Later pulls that find the same bytes leave it. */
  retrievedAt: Timestamp;
  entries: StatutesAffectedEntry[];
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
  /** False once two complete full pulls in a row have not listed the Version (ADR-0030). It is still served by id. */
  listed: boolean;
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
