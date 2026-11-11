import { orsChapterIdOf, orsSectionIdOf, type OrsSectionId } from "#/packages/domain/oregonai.ts";
import {
  chapterTarget,
  sectionTarget,
  type StatuteLink,
  type StatuteLinkKind,
  type StatuteTarget,
} from "#/packages/domain/statute-links.ts";
import { normalizeExtractedText } from "./normalize.ts";
import { withoutOmittedMatter } from "./omitted-matter.ts";
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

/** Splits a Version into its measure sections. Text before the first header is the Measure's heading and relating clause, which are not read: its sections are. */
function splitIntoSections(body: string): MeasureSection[] {
  const headers = [...body.matchAll(sectionHeader)];
  if (headers.length === 0) return [{ number: null, text: body }];
  return headers.map((header, index) => {
    const next = headers[index + 1];
    return { number: header[1] ?? null, text: body.slice(header.index, next?.index ?? body.length) };
  });
}

const addedTo = /(?:is|are) added to and made a part of\s*$/;
// A repeal list can end with sections of an earlier session's law: "ORS 247.016 and 247.018 and section 9, chapter 492,
// Oregon Laws 2023, are repealed". The list's ORS sections are repealed whatever citation follows them (#55).
const sessionLawSectionNumbers = String.raw`\d+[a-z]?(?:,\s*\d+[a-z]?)*(?:,?\s*(?:and|or)\s+\d+[a-z]?)?`;
// Legislative Counsel's history of a section names only sections of session laws: "as amended by section 8, chapter 20,
// Oregon Laws 2024," or "as amended by section 5 of this 2025 Act," (#6 F2), after an ORS section (#169) or after a
// repeal list's session-law citation ("section 6, chapter 248, Oregon Laws 2023, as amended by section 7, chapter 292,
// Oregon Laws 2025, are repealed"; #111, SB 1583 Introduced, 2026R1). So a clause after the history ("applies to a
// member, and section 9, chapter 492, Oregon Laws 2023, is amended") ends it. 2026R1 shows three more forms of an item:
// a section named with its subsections, "section 18 (6)(e)" and "section 18 (6)(a) to (e)" (HB 4063 Introduced); an
// Enrolled bill with no chapter number yet, "section 22, chapter , Oregon Laws 2026 (Enrolled House Bill 4066)" (HB 4060
// A-Engrossed), or "chapter ___" (HB 3038-A9, 2025R1); and a history of 27 items, over 1,000 characters (HB 4040
// A-Engrossed SECTION 30), which is why the history is read to its end and not within a window.
const historySectionNumber = String.raw`\d+[a-z]?(?:\s*\([0-9a-zA-Z]{1,5}\))*(?:\s+to\s+\([0-9a-zA-Z]{1,5}\))?`;
const historySectionNumbers = String.raw`${historySectionNumber}(?:,\s*${historySectionNumber})*(?:,?\s*(?:and|or)\s+${historySectionNumber})?`;
const sessionLawHistoryItem = String.raw`sections?\s+${historySectionNumbers}(?:,\s*chapter(?:\s+(?:\d+[a-z]?|_+))?\s*,\s*Oregon Laws\s+\d{4}(?:\s*\([^()]{1,60}\))?|\s+of this\s+\d{4}\s+Act)`;
const sessionLawHistory = String.raw`(?:,?\s*as amended by ${sessionLawHistoryItem}(?:(?:,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)${sessionLawHistoryItem})*)?`;
// Sticky: it is tried at the end of a reference, over the rest of the section's text.
const amendedAfter = new RegExp(String.raw`${sessionLawHistory},?\s*(?:is|are) amended\b`, "y");
const sessionLawCitation = String.raw`,?\s*(?:and\s+|or\s+)?sections?\s+${sessionLawSectionNumbers},\s*chapter\s+\d+[a-z]?,\s*Oregon Laws\s+\d{4}${sessionLawHistory}`;
const repealedAfter = new RegExp(String.raw`^(?:${sessionLawCitation})*,?\s*(?:is|are) repealed\b`);

function kindOf(text: string, reference: OrsReference): StatuteLinkKind {
  if (addedTo.test(text.slice(Math.max(0, reference.start - 60), reference.start))) return "adds-to";
  amendedAfter.lastIndex = reference.end;
  if (amendedAfter.test(text)) return "amends";
  if (repealedAfter.test(text.slice(reference.end, reference.end + 700))) return "repeals";
  return "cites";
}

/** The targets an item names: one for a section or a chapter, one per listed section for a range. */
function targetsOf(item: OrsItem, expandRange: RangeExpander): StatuteTarget[] {
  switch (item.type) {
    case "chapter": {
      const id = orsChapterIdOf(item.chapter);
      return id === undefined ? [] : [chapterTarget(id)];
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
    const text = withoutOmittedMatter(section.text);
    for (const reference of findOrsReferences(text)) {
      const kind = kindOf(text, reference);
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
