import type { OrsSectionId, StatuteLink, StatuteLinkKind, StatuteTarget } from "#/packages/domain/statute-links.ts";
import { orsChapterIdOf, orsSectionIdOf } from "#/packages/domain/statute-links.ts";
import { normalizeExtractedText } from "./normalize.ts";
import type { RangeExpander } from "./ranges.ts";
import { createRangeExpander } from "./ranges.ts";
import type { RelatingClauseEdit } from "./relating-clause.ts";
import { readRelatingClauseEdits } from "./relating-clause.ts";
import type { OrsItem, OrsReference } from "./references.ts";
import { findOrsReferences } from "./references.ts";

const sectionHeader = /\bSECTION (\d+[a-z]?)\. /g;
// Inserted text opens with a curly quote: “SECTION 3. ORS 657B.070 is amended to read:
const insertedSectionHeader = /“\s*(?=SECTION (\d+[a-z]?)\. )/g;

/**
 * Which kind of document the text is. A Version is read section by section. A Proposed Amendment is
 * read for what it says itself: the sections it inserts and its edits to the relating clause (ADR-0001).
 */
export type StatuteLinkDocumentKind = "version" | "proposed-amendment";

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

function sectionTarget(id: OrsSectionId): StatuteTarget {
  return { type: "section", id, resolvableOnOregonAi: true };
}

/** The targets an item names: one for a section or a chapter, one per listed section for a range. */
function targetsOf(item: OrsItem, expandRange: RangeExpander): StatuteTarget[] {
  switch (item.type) {
    case "chapter": {
      const id = orsChapterIdOf(item.chapter);
      return id === undefined ? [] : [{ type: "chapter", id, resolvableOnOregonAi: false }];
    }
    case "section": {
      const id = orsSectionIdOf(item.citation);
      return id === undefined ? [] : [sectionTarget(id)];
    }
    case "range":
      return expandRange(item.from, item.to).map(sectionTarget);
    default:
      return item satisfies never;
  }
}

/** Splits a Proposed Amendment into the sections it inserts. The amendment's instructions between them hold no links. */
function insertedSections(body: string): MeasureSection[] {
  const headers = [...body.matchAll(insertedSectionHeader)];
  return headers.map((header, index) => {
    const start = header.index + header[0].length;
    const closingQuote = body.indexOf("”", start);
    const next = headers[index + 1]?.index;
    const end = Math.min(next ?? body.length, closingQuote < 0 ? body.length : closingQuote);
    return { number: header[1] ?? null, text: body.slice(start, end) };
  });
}

/** Reads the links of the sections, each once per kind, target and measure section, in the order the text names them. */
function linksOf(sections: MeasureSection[], expandRange: RangeExpander): StatuteLink[] {
  const links = new Map<string, StatuteLink>();
  for (const section of sections) {
    for (const reference of findOrsReferences(section.text)) {
      const kind = kindOf(section.text, reference);
      for (const item of reference.items) {
        for (const target of targetsOf(item, expandRange)) {
          const key = `${kind}|${target.id}|${section.number ?? ""}`;
          if (!links.has(key)) links.set(key, { kind, target, measureSection: section.number });
        }
      }
    }
  }
  return [...links.values()];
}

/** What a document's text says: its Statute Links, and for a Proposed Amendment its relating clause edits. */
export function readDocument(
  documentKind: StatuteLinkDocumentKind,
  text: string,
  orsSections: readonly OrsSectionId[],
): { links: StatuteLink[]; relatingClauseEdits: RelatingClauseEdit[] } {
  const expandRange = createRangeExpander(orsSections);
  const body = normalizeExtractedText(text);
  if (documentKind === "version")
    return { links: linksOf(splitIntoSections(body), expandRange), relatingClauseEdits: [] };
  return {
    links: linksOf(insertedSections(body), expandRange),
    relatingClauseEdits: readRelatingClauseEdits(body, expandRange),
  };
}
