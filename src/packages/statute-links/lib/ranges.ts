import type { OrsSectionId } from "#/packages/domain/statute-links.ts";
import { orsSectionIdOf } from "#/packages/domain/statute-links.ts";

/** Where an ORS section sorts: chapter number, then the chapter's letter ("163" before "163A"), then the section. */
type SectionKey = { chapter: number; letter: string; section: number };

const keyPattern = /^(?:ors-)?(\d{1,3})([a-z]?)\.(\d{3,4})$/i;

function keyOf(text: string): SectionKey | undefined {
  const match = keyPattern.exec(text);
  if (match?.[1] === undefined || match[3] === undefined) return undefined;
  return { chapter: Number(match[1]), letter: (match[2] ?? "").toLowerCase(), section: Number(match[3]) };
}

function compareKeys(a: SectionKey, b: SectionKey): number {
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  if (a.letter !== b.letter) return a.letter < b.letter ? -1 : 1;
  return a.section - b.section;
}

/** Expands "from to to" (sections as printed, "418.806") into the sections of the ORS section list. */
export type RangeExpander = (from: string, to: string) => OrsSectionId[];

/**
 * Builds the expander for one ORS section list. The list is read once, when the first range comes
 * up, and a document with no range costs nothing. The expansion holds the sections of the list that
 * lie from one end to the other, ends included, in ORS order. The two ends are always in it, listed
 * or not, because the text names them; nothing else is.
 */
export function createRangeExpander(orsSections: readonly OrsSectionId[]): RangeExpander {
  let keyed: { id: OrsSectionId; key: SectionKey }[] | undefined;
  const listed = (): { id: OrsSectionId; key: SectionKey }[] => {
    keyed ??= orsSections.flatMap((id) => {
      const key = keyOf(id);
      return key === undefined ? [] : [{ id, key }];
    });
    return keyed;
  };
  return (from, to) => {
    const fromKey = keyOf(from);
    const toKey = keyOf(to);
    const fromId = orsSectionIdOf(from);
    const toId = orsSectionIdOf(to);
    if (fromKey === undefined || toKey === undefined || fromId === undefined || toId === undefined) return [];
    const inside = listed().filter(
      (entry) => compareKeys(entry.key, fromKey) >= 0 && compareKeys(entry.key, toKey) <= 0,
    );
    const found = new Map<string, { id: OrsSectionId; key: SectionKey }>();
    for (const entry of [{ id: fromId, key: fromKey }, ...inside, { id: toId, key: toKey }]) {
      found.set(entry.id, entry);
    }
    return [...found.values()].sort((a, b) => compareKeys(a.key, b.key)).map((entry) => entry.id);
  };
}
