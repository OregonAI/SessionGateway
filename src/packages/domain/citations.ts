// Finds the citations in a piece of text: a Measure ("HB 3131"), a Proposed Amendment ("SB 69-2") or an ORS
// section ("ORS 468.130"), as the ids they stand for. The ids are minted by the functions that mint them
// everywhere else (index.ts, documents.ts, oregonai.ts); this is the one place that reads them out of
// free text (src/CLAUDE.md, "Shape").
import { amendmentIdOf, type AmendmentId } from "./documents.ts";
import { measureIdOf, type MeasureId, type MeasureKey, type SessionKey } from "./index.ts";
import { orsSectionCitationSource, orsSectionIdOf, type OrsSectionId } from "./oregonai.ts";

/**
 * A citation found in a text, with the words it was written with there and where its first mention starts, in
 * UTF-16 code units from the start of the text searched.
 */
export type Citation = { text: string; index: number } & CitationOf;

type CitationOf =
  | { kind: "measure"; measure: MeasureKey; id: MeasureId }
  | {
      kind: "amendment";
      measure: MeasureKey;
      /** The amendment's number without its hyphen: "2", "A3". */ number: string;
      id: AmendmentId;
    }
  | { kind: "ors"; id: OrsSectionId };

/** The prefixes of the Measures OLIS lists (2025R1: HB, SB, HCR, SCR, SJR, HJR, HJM, SJM, HR, SR). */
const prefixes = "HB|SB|HJR|SJR|HCR|SCR|HJM|SJM|HR|SR";

// An amendment is its Measure's citation and its number joined by a hyphen: "SB 69-2", "HB 3795-A3".
const amendmentPattern = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${prefixes})\s*(\d{1,4})\s*-\s*([A-Z]?\d{1,2})(?![\p{L}\p{N}])`,
  "giu",
);
const measurePattern = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${prefixes})\s*(\d{1,4})(?![\p{L}\p{N}])(?!\s*-\s*[A-Z]?\d)`,
  "giu",
);
const orsPattern = new RegExp(String.raw`(?<![\p{L}\p{N}])ORS\s+(${orsSectionCitationSource})(?![\p{L}\p{N}])`, "giu");

/**
 * The citations in a text, once each, in the order they first come. A Measure's citation is "HB 3131" in
 * any case, with or without the space; the Session is the deployment's. White space between the parts of a
 * citation may be any run of it, a line break included ("ORS" at the end of one line and the section at the
 * start of the next is one citation), so a whole document's text can be read at once. A citation that names a Measure
 * or section that does not exist is still a citation: whether the index holds it is for the caller.
 */
export function findCitations(text: string, session: SessionKey): Citation[] {
  const found: { index: number; citation: Citation }[] = [];
  for (const match of text.matchAll(amendmentPattern)) {
    const [, prefix, number, amendment] = match;
    if (prefix === undefined || number === undefined || amendment === undefined) continue;
    const measure = { session, prefix: prefix.toUpperCase(), number: Number(number) };
    found.push({
      index: match.index,
      citation: {
        text: match[0],
        index: match.index,
        kind: "amendment",
        measure,
        number: amendment.toUpperCase(),
        id: amendmentIdOf(measure, `-${amendment.toUpperCase()}`),
      },
    });
  }
  for (const match of text.matchAll(measurePattern)) {
    const [, prefix, number] = match;
    if (prefix === undefined || number === undefined) continue;
    const measure = { session, prefix: prefix.toUpperCase(), number: Number(number) };
    found.push({
      index: match.index,
      citation: { text: match[0], index: match.index, kind: "measure", measure, id: measureIdOf(measure) },
    });
  }
  for (const match of text.matchAll(orsPattern)) {
    const id = match[1] === undefined ? undefined : orsSectionIdOf(match[1]);
    if (id !== undefined)
      found.push({ index: match.index, citation: { text: match[0], index: match.index, kind: "ors", id } });
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const { citation } of found) {
    if (seen.has(citation.id)) continue;
    seen.add(citation.id);
    citations.push(citation);
  }
  return citations;
}
