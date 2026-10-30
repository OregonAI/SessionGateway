import type { OrsSectionId } from "#/packages/domain/oregonai.ts";
import { compareOrsSectionIds, orsSectionIdOf } from "#/packages/domain/oregonai.ts";

/** Expands "from to to" (sections as printed, "418.808") into the sections of the ORS section list. */
export type RangeExpander = (from: string, to: string) => OrsSectionId[];

/**
 * Builds the expander for one ORS section list. The list is sorted and de-duplicated once, when the
 * first range comes up, and a document with no range costs nothing. The expansion holds the sections
 * of the list that lie from one end to the other, ends included, in ORS order, and nothing the list
 * lacks: the list is the snapshot of the sections OregonAI can resolve (ADR-0004), so an end it does
 * not hold (a section repealed or renumbered) is no link (#6 F5).
 */
export function createRangeExpander(orsSections: readonly OrsSectionId[]): RangeExpander {
  let inOrsOrder: OrsSectionId[] | undefined;
  const sorted = (): OrsSectionId[] => {
    inOrsOrder ??= [...new Set(orsSections)].sort(compareOrsSectionIds);
    return inOrsOrder;
  };
  return (from, to) => {
    const first = orsSectionIdOf(from);
    const last = orsSectionIdOf(to);
    if (first === undefined || last === undefined) return [];
    return sorted().filter((id) => compareOrsSectionIds(id, first) >= 0 && compareOrsSectionIds(id, last) <= 0);
  };
}
