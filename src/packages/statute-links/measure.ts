import type { MeasureKey } from "#/packages/domain/index.ts";
import type { StoredAmendment, StoredVersion } from "#/packages/domain/statute-links.ts";
import { splitByReplacement, type PlacedAmendment, type SupersededAmendment } from "./lib/amendments.ts";

export type { PlacedAmendment, SupersededAmendment } from "./lib/amendments.ts";

export type StatuteLinksOfMeasureInput = {
  /** The Measure the Versions and Proposed Amendments are of. */
  measure: MeasureKey;
  /** The Versions the Index holds, with what was read of each. */
  versions: readonly StoredVersion[];
  /** The Measure's Proposed Amendments, with what was read of each posted file. */
  amendments: readonly StoredAmendment[];
};

export type StatuteLinksOfMeasure = {
  /** The Proposed Amendments whose Statute Links apply now, in the order they were given. */
  currentAmendments: PlacedAmendment[];
  /** The Proposed Amendments a later Version replaces, in the order they were given. */
  supersededAmendments: SupersededAmendment[];
};

export function statuteLinksOfMeasure(input: StatuteLinksOfMeasureInput): StatuteLinksOfMeasure {
  const { current, superseded } = splitByReplacement(input.amendments, input.measure, input.versions);
  return { currentAmendments: current, supersededAmendments: superseded };
}
