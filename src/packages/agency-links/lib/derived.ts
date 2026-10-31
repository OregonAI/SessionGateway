import { orsChapterOf, type AgencyId, type OrsChapterId } from "#/packages/domain/oregonai.ts";
import { compareMeasureSections, type StatuteLink, type StatuteLinkKind } from "#/packages/domain/statute-links.ts";
import type { AgencyLink } from "./types.ts";

/**
 * The Statute Links that derive an Agency Link: the ones that change the law. A citation does not (ADR-0027): a
 * chapter such as 192 (public records) is implemented by 57 Agencies in the fixture's snapshot and 60 or so in the
 * whole one, and a Measure that merely cites a section of it is not about them.
 */
const changesTheLaw: ReadonlySet<StatuteLinkKind> = new Set<StatuteLinkKind>(["amends", "repeals", "adds-to"]);

/** The ORS chapter a Statute Link reaches: the chapter itself, or the one a section belongs to. */
function chapterReachedBy(link: StatuteLink): OrsChapterId {
  return link.target.type === "chapter" ? link.target.id : orsChapterOf(link.target.id);
}

/**
 * Derives Agency Links from a document's Statute Links and the snapshot's Chapter table (spec #1, module 5: "a
 * Statute Link reaches an ORS chapter in the snapshot's chapter-to-agency table"). One link for each chapter that a
 * Statute Link which amends, repeals or adds to reaches and each Agency the table gives the chapter, in the order the
 * chapters first come in the text. Its evidence names the chapter and the Statute Link in the lowest measure section
 * that reaches it, with how many do. A chapter the table has no row for derives nothing.
 */
export function deriveAgencyLinks(
  links: readonly StatuteLink[],
  chapterAgencies: ReadonlyMap<OrsChapterId, readonly AgencyId[]>,
): AgencyLink[] {
  const byChapter = new Map<OrsChapterId, StatuteLink[]>();
  for (const link of links.toSorted((a, b) => compareMeasureSections(a.measureSection, b.measureSection))) {
    if (!changesTheLaw.has(link.kind)) continue;
    const chapter = chapterReachedBy(link);
    byChapter.set(chapter, [...(byChapter.get(chapter) ?? []), link]);
  }
  return [...byChapter.entries()].flatMap(([chapter, reaching]) => {
    const [first] = reaching;
    if (first === undefined) return [];
    return (chapterAgencies.get(chapter) ?? []).map((agency): AgencyLink => ({
      agency,
      evidence: { kind: "derived", chapter, link: first, linksInChapter: reaching.length },
    }));
  });
}
