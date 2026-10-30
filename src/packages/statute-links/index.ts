import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import type { StatuteLink } from "#/packages/domain/statute-links.ts";
import type { StatuteLinkDocumentKind } from "./lib/read-links.ts";
import { readDocument } from "./lib/read-links.ts";
import type { RelatingClauseEdit } from "./lib/relating-clause.ts";

export { readAmendedVersionHeader } from "./lib/amended-version.ts";
export type { StatuteLinkDocumentKind } from "./lib/read-links.ts";
export type { RelatingClauseEdit } from "./lib/relating-clause.ts";

export type ParseStatuteLinksInput = {
  documentKind: StatuteLinkDocumentKind;
  /** The document's extracted text, as `pdftotext` prints it. */
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
