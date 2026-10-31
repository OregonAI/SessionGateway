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
 *
 * The table lists the sub-unit whose rules implement a chapter, not its Department (ADR-0012), and a Fiscal Impact
 * Statement that names the Department resolves to the Department. So an Agency the table lists for a chapter also gives
 * its parent a link, unless the table lists the parent for that chapter too, with evidence that says it came through the
 * sub-units (ADR-0029): one link for each parent and chapter, naming every sub-unit of it that the table lists.
 */
export function deriveAgencyLinks(
  links: readonly StatuteLink[],
  chapterAgencies: ReadonlyMap<OrsChapterId, readonly AgencyId[]>,
  parentOf: ReadonlyMap<AgencyId, AgencyId>,
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
    const evidence = { kind: "derived", chapter, link: first, linksInChapter: reaching.length } as const;
    const listed = chapterAgencies.get(chapter) ?? [];
    const subUnitsOf = new Map<AgencyId, AgencyId[]>();
    for (const agency of listed) {
      const parent = parentOf.get(agency);
      if (parent === undefined || listed.includes(parent)) continue;
      subUnitsOf.set(parent, [...(subUnitsOf.get(parent) ?? []), agency]);
    }
    return [
      ...listed.map((agency): AgencyLink => ({ agency, evidence })),
      ...[...subUnitsOf].map(([parent, through]): AgencyLink => ({
        agency: parent,
        evidence: { ...evidence, through },
      })),
    ];
  });
}
