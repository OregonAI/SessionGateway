// What an agent sees of a document's Statute Links in compare_amendment and get_measure (ticket #13, finding F6):
// by kind, each target once with the measure sections it is linked in, ORS sections and ORS chapters apart. The
// builders below write an expected value as a literal; `triplesOf` reads a result back as (kind, target, measure
// section) triples, for the cases that only need to know a link is there.
import { statuteLinkKinds, type StatuteLinkKind } from "#/packages/domain/statute-links.ts";

export type SectionTarget = { target_id: string; measure_sections: (string | null)[] };
export type ChapterTarget = {
  target_id: string;
  resolvable_on_oregonai: boolean;
  measure_sections: (string | null)[];
};
export type LinksOfKind = { sections: SectionTarget[]; chapters: ChapterTarget[] };
export type StatuteLinks = Record<StatuteLinkKind, LinksOfKind>;

/** An ORS section, linked in these measure sections. OregonAI has its page, so nothing more is said. */
export const sectionTarget = (id: string, ...measureSections: string[]): SectionTarget => ({
  target_id: id,
  measure_sections: measureSections,
});

/** An ORS chapter: OregonAI has no id for it, and the link says so (spec #1, story 27). */
export const chapterTarget = (id: string, ...measureSections: string[]): ChapterTarget => ({
  target_id: id,
  resolvable_on_oregonai: false,
  measure_sections: measureSections,
});

/** The Statute Links of a document that has these targets under these kinds, and none under the others. */
export function expectedLinks(by: Partial<Record<StatuteLinkKind, Partial<LinksOfKind>>>): StatuteLinks {
  const none = (kind: StatuteLinkKind): LinksOfKind => ({
    sections: by[kind]?.sections ?? [],
    chapters: by[kind]?.chapters ?? [],
  });
  return { amends: none("amends"), repeals: none("repeals"), "adds-to": none("adds-to"), cites: none("cites") };
}

/** A document with no Statute Links, or one that was not read. */
export const noLinks: StatuteLinks = expectedLinks({});

/** Every link as [kind, target id, measure section], one for each section a target is linked in. */
export function triplesOf(links: StatuteLinks): [kind: string, targetId: string, measureSection: string | null][] {
  return statuteLinkKinds.flatMap((kind) =>
    [...links[kind].sections, ...links[kind].chapters].flatMap((target) =>
      target.measure_sections.map((section): [string, string, string | null] => [kind, target.target_id, section]),
    ),
  );
}
