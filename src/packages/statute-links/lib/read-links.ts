import type { StatuteLink, StatuteLinkKind, StatuteTarget } from "#/packages/domain/statute-links.ts";
import { orsChapterIdOf, orsSectionIdOf } from "#/packages/domain/statute-links.ts";
import { normalizeExtractedText } from "./normalize.ts";
import type { OrsItem, OrsReference } from "./references.ts";
import { findOrsReferences } from "./references.ts";

const sectionHeader = /\bSECTION (\d+[a-z]?)\. /g;

/** One measure section of the document: its number as printed, and its running text. */
type MeasureSection = { number: string | null; text: string };

/** Splits a Version into its measure sections. Text before the first header is the summary and title, which hold no links. */
function splitIntoSections(body: string): MeasureSection[] {
  const headers = [...body.matchAll(sectionHeader)];
  if (headers.length === 0) return [{ number: null, text: body }];
  return headers.map((header, index) => {
    const next = headers[index + 1];
    return { number: header[1] ?? null, text: body.slice(header.index, next?.index ?? body.length) };
  });
}

const addedTo = /(?:is|are) added to and made a part of\s*$/;
const asAmendedBy = String.raw`(?:,?\s*as amended by [^.;:]{1,400}?Oregon Laws[^.;:]{0,200}?)?`;
const amendedAfter = new RegExp(String.raw`^${asAmendedBy},?\s*(?:is|are) amended\b`);
const repealedAfter = /^\s*(?:is|are) repealed\b/;

function kindOf(text: string, reference: OrsReference): StatuteLinkKind {
  if (addedTo.test(text.slice(Math.max(0, reference.start - 60), reference.start))) return "adds-to";
  const after = text.slice(reference.end, reference.end + 700);
  if (amendedAfter.test(after)) return "amends";
  if (repealedAfter.test(after)) return "repeals";
  return "cites";
}

function targetOf(item: OrsItem): StatuteTarget | undefined {
  if (item.type === "chapter") {
    const id = orsChapterIdOf(item.chapter);
    return id === undefined ? undefined : { type: "chapter", id, resolvableOnOregonAi: false };
  }
  const id = orsSectionIdOf(item.citation);
  return id === undefined ? undefined : { type: "section", id, resolvableOnOregonAi: true };
}

export function readStatuteLinks(text: string): StatuteLink[] {
  const links: StatuteLink[] = [];
  for (const section of splitIntoSections(normalizeExtractedText(text))) {
    for (const reference of findOrsReferences(section.text)) {
      const kind = kindOf(section.text, reference);
      for (const item of reference.items) {
        const target = targetOf(item);
        if (target !== undefined) links.push({ kind, target, measureSection: section.number });
      }
    }
  }
  return links;
}
