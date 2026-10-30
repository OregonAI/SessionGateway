import type { StatuteLink } from "#/packages/domain/statute-links.ts";
import type { OrsSectionId } from "#/packages/domain/statute-links.ts";
import { readStatuteLinks } from "./lib/read-links.ts";

/** Which kind of document the text is. A Proposed Amendment is read for what it says itself (ADR-0001). */
export type StatuteLinkDocumentKind = "version" | "proposed-amendment";

export type ParseStatuteLinksInput = {
  documentKind: StatuteLinkDocumentKind;
  /** The document's extracted text, as `pdftotext` prints it. */
  text: string;
  /** The ORS sections that exist, from the OregonAI snapshot. A range is expanded against it. */
  orsSections: readonly OrsSectionId[];
};

export type StatuteLinkParse = {
  links: StatuteLink[];
};

/** Reads Legislative Counsel's fixed wording into Statute Links. Pure: text in, links out. */
export function parseStatuteLinks(input: ParseStatuteLinksInput): StatuteLinkParse {
  return { links: readStatuteLinks(input.text) };
}
