import type { OrsSectionId } from "#/packages/domain/statute-links.ts";
import { orsSectionIdOf } from "#/packages/domain/statute-links.ts";
import type { RangeExpander } from "./ranges.ts";
import { findSectionItems } from "./references.ts";

/**
 * One edit a Proposed Amendment makes to the measure's relating clause, the title that says what
 * the measure amends ("Relating to ...; amending ORS 409.711."). It is what the amendment says,
 * not the clause after the edit: what the amendment deletes elsewhere is not worked out (ADR-0001).
 */
export type RelatingClauseEdit = {
  /** The words the amendment deletes from the clause, or null when it only inserts. */
  deleted: string | null;
  /** The words it inserts. */
  inserted: string;
  /** The ORS sections the inserted words name, ranges expanded, each once, in order. */
  insertedSections: OrsSectionId[];
};

// The title is on line 2 of the printed measure. Legislative Counsel writes the place in two forms:
// "In line 2 of the printed bill," and "On page 1 of the printed A-engrossed bill, line 2,".
const place = String.raw`(?:In line 2 of the printed(?: [\w-]+)? bill|On page 1 of the printed(?: [\w-]+)? bill, line 2),\s+`;
const quoted = String.raw`“([^”]{0,2000})”`;
const deleteAndInsert = String.raw`delete ${quoted} and insert ${quoted}`;
const insert = String.raw`(?:before the period|(?:after|before) “[^”]{0,200}”) insert ${quoted}`;
const relatingClauseEdit = new RegExp(String.raw`${place}(?:${deleteAndInsert}|${insert})\.`, "g");

/** Reads the relating clause edits of a Proposed Amendment's normalized text, in order. */
export function readRelatingClauseEdits(text: string, expandRange: RangeExpander): RelatingClauseEdit[] {
  return [...text.matchAll(relatingClauseEdit)].map((match) => {
    const deleted = match[1] ?? null;
    const inserted = match[2] ?? match[3] ?? "";
    const sections = new Set<OrsSectionId>();
    for (const item of findSectionItems(inserted)) {
      if (item.type === "chapter") continue;
      const named = item.type === "range" ? expandRange(item.from, item.to) : [orsSectionIdOf(item.citation)];
      for (const id of named) if (id !== undefined) sections.add(id);
    }
    return { deleted, inserted, insertedSections: [...sections] };
  });
}
