import {
  compareMeasureSections,
  statuteLinkKinds,
  type StatuteLink,
  type StatuteLinkKind,
  type StatuteTarget,
} from "#/packages/domain/statute-links.ts";

/** An ORS section or chapter and the measure sections it is linked in: a null entry stands for a text with no numbered sections. */
export type LinkedTarget = {
  target: StatuteTarget;
  measureSections: (string | null)[];
};

export type StatuteLinksByKind = Record<StatuteLinkKind, LinkedTarget[]>;

/**
 * A document's links by kind, each target once under its kind with every measure section it is linked in (ADR-0015).
 * Targets are in the order of their first measure section, and within a section in the order the text names them. Nothing
 * is left out: a target under two kinds (an amendment that amends a section and also cites it) is under both.
 */
export function statuteLinksByKind(links: readonly StatuteLink[]): StatuteLinksByKind {
  const inSectionOrder = links.toSorted((a, b) => compareMeasureSections(a.measureSection, b.measureSection));
  const ofKind = (kind: StatuteLinkKind): LinkedTarget[] => {
    const targets = new Map<string, LinkedTarget>();
    for (const link of inSectionOrder.filter((candidate) => candidate.kind === kind)) {
      const linked = targets.get(link.target.id) ?? { target: link.target, measureSections: [] };
      linked.measureSections.push(link.measureSection);
      targets.set(link.target.id, linked);
    }
    return [...targets.values()];
  };
  return Object.fromEntries(statuteLinkKinds.map((kind) => [kind, ofKind(kind)])) as StatuteLinksByKind;
}
