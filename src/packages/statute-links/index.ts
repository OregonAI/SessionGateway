import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import type { StatuteLink } from "#/packages/domain/statute-links.ts";
import type { StatuteLinkDocumentKind } from "./lib/read-links.ts";
import { readDocument } from "./lib/read-links.ts";
import type { RelatingClauseEdit } from "./lib/relating-clause.ts";
import { readStatutesAffectedTable, type StatutesAffectedTableParse } from "./lib/statutes-affected-table.ts";

export { readAmendedVersionHeader } from "./lib/amended-version.ts";
export type { StatuteLinkDocumentKind } from "./lib/read-links.ts";
export type { RelatingClauseEdit } from "./lib/relating-clause.ts";
export type { StatutesAffectedTableParse } from "./lib/statutes-affected-table.ts";

/**
 * The version of the Statute Link parser's reading (ADR-0064). The worker records it with each file it reads and reads a file
 * again when the recorded version is not this one. BUMP IT BY HAND in any change that would change what the worker's
 * `statuteParseOf` (`ingest/lib/statute-parse.ts`) stores for some stored text: a change to this package (a new pattern, a
 * fixed kind, a changed range rule) and also one outside it that the reading uses, such as `domain/oregonai.ts`
 * (`orsSectionIdOf`, `compareOrsSectionIds`), `domain/statute-links.ts` or `ingest/lib/statute-parse.ts` itself. Without the
 * bump a stored database keeps the old links. A change that leaves every stored result as it was needs none.
 * A reading made before schema step 8 counts as version 0, so this starts at 1.
 */
export const STATUTE_LINK_PARSER_VERSION = 1;

export type ParseStatuteLinksInput = {
  documentKind: StatuteLinkDocumentKind;
  /**
   * The document's extracted text: as the pdf-text package extracts it with PDF.js, which is the text the store holds,
   * or as `pdftotext` prints it. The two differ in the page furniture (line numbers, footers), and both are read.
   */
  text: string;
  /** The ORS sections that exist, from the OregonAI snapshot. A range is expanded against it, and holds only sections of this list. */
  orsSections: readonly OrsSectionId[];
};

export type StatuteLinkParse = {
  links: StatuteLink[];
  /** Edits to the relating clause. Always empty for a Version. */
  relatingClauseEdits: RelatingClauseEdit[];
};

/** Reads Legislative Counsel's fixed wording into Statute Links. Pure: text in, links out. */
export function parseStatuteLinks(input: ParseStatuteLinksInput): StatuteLinkParse {
  return readDocument(input.documentKind, input.text, input.orsSections);
}

/**
 * The version of the Statutes Affected Table parser's reading (ADR-0065), apart from `STATUTE_LINK_PARSER_VERSION` so that a
 * change to one parser does not read the other's results again. The worker records it with the held table and reads the held
 * table again when its bytes, its snapshot commit or this version differ. BUMP IT BY HAND in any change that would change what
 * the table reading stores for the same bytes: a change to `parseStatutesAffectedTable` (`statute-links/lib/statutes-affected-table.ts`),
 * to a file it imports and to what those call: `statute-links/lib/ranges.ts`; in `domain/oregonai.ts`,
 * `compareOrsChapterIds`, `compareOrsSectionIds`, `orsChapterCitationSource`, `orsChapterIdOf`, `orsChapterOf`,
 * `orsSectionCitationSource` and `orsSectionIdOf`; and in `domain/statute-links.ts`, `chapterTarget`, `sectionTarget` and
 * `tableActions`. Also one outside the package that says what the parser is given or how its entries are stored:
 * `ingest/lib/statutes-affected-table.ts` (the text and section list it passes) and `replaceTableEntries` in
 * `database/writer.ts`. Without the bump a stored database keeps the old entries. A change that leaves every stored result
 * as it was needs none. A reading made before schema step 9 counts as version 0, so this starts at 1.
 */
export const STATUTES_AFFECTED_TABLE_PARSER_VERSION = 1;

export type ParseStatutesAffectedTableInput = {
  /**
   * The table's extracted text: as the pdf-text package extracts it with PDF.js, which is the text the store holds, or as
   * `pdftotext` prints it (a row is read wherever white space separates its parts, however wide).
   */
  text: string;
  /** The ORS sections that exist, from the OregonAI snapshot. A series is expanded against it, as a range in a Version is. */
  orsSections: readonly OrsSectionId[];
};

/**
 * Reads Legislative Counsel's Statutes Affected Table into entries (ADR-0033). Pure: text in, entries out. Each entry
 * names the Measure and the engrossing level of its row, the ORS target, the table's action and the measure section.
 */
export function parseStatutesAffectedTable(input: ParseStatutesAffectedTableInput): StatutesAffectedTableParse {
  return readStatutesAffectedTable(input.text, input.orsSections);
}
