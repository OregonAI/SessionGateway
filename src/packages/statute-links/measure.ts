import type { MeasureKey } from "#/packages/domain/index.ts";
import type {
  StatutesAffectedTableOfMeasure,
  StoredAmendment,
  StoredVersion,
} from "#/packages/domain/statute-links.ts";
import {
  compareVersions,
  splitByReplacement,
  type PlacedAmendment,
  type SupersededAmendment,
} from "./lib/amendments.ts";
import { tableOfMeasure, tableOfVersion, type TableOfMeasure, type TableOfVersion } from "./lib/table-comparison.ts";

export type { PlacedAmendment, SupersededAmendment } from "./lib/amendments.ts";
export type { EntriesApart, TableOfMeasure, TableOfVersion } from "./lib/table-comparison.ts";

export type StatuteLinksOfMeasureInput = {
  /** The Measure the Versions and Proposed Amendments are of. */
  measure: MeasureKey;
  /** The Versions the Index holds, with what was read of each. */
  versions: readonly StoredVersion[];
  /** The Measure's Proposed Amendments, with what was read of each posted file. */
  amendments: readonly StoredAmendment[];
  /** Legislative Counsel's Statutes Affected Table as the Index holds it for the Measure, or undefined while it holds none. */
  table: StatutesAffectedTableOfMeasure | undefined;
};

/** A Version the Index holds, with how the Statutes Affected Table's entries compare with the links read from its text. */
export type VersionLinks = {
  version: StoredVersion;
  /** Undefined when no entry names the Version, or the Index holds no table. */
  table: TableOfVersion | undefined;
};

export type StatuteLinksOfMeasure = {
  /** The Versions the Index holds, in the order they were printed in. */
  versions: VersionLinks[];
  /** The Proposed Amendments whose Statute Links apply now, in the order they were given. */
  currentAmendments: PlacedAmendment[];
  /** The Proposed Amendments a later Version replaces, in the order they were given. */
  supersededAmendments: SupersededAmendment[];
  /** Undefined while the Index holds no table. */
  table: TableOfMeasure | undefined;
};

export function statuteLinksOfMeasure(input: StatuteLinksOfMeasureInput): StatuteLinksOfMeasure {
  const { current, superseded } = splitByReplacement(input.amendments, input.measure, input.versions);
  const { table } = input;
  return {
    versions: input.versions
      .toSorted(compareVersions)
      .map((version) => ({ version, table: table === undefined ? undefined : tableOfVersion(version, table) })),
    currentAmendments: current,
    supersededAmendments: superseded,
    table: table === undefined ? undefined : tableOfMeasure(input.versions, table),
  };
}
