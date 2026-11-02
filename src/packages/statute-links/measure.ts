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
import { statuteLinksByKind } from "./lib/links-by-kind.ts";
import { tableOfMeasure, tableOfVersion, type TableOfMeasure, type TableOfVersion } from "./lib/table-comparison.ts";

export type { PlacedAmendment, SupersededAmendment } from "./lib/amendments.ts";
export type { LinkedTarget, StatuteLinksByKind } from "./lib/links-by-kind.ts";
export type { EntriesApart, LoneETally, TableOfMeasure, TableOfVersion, WhyApart } from "./lib/table-comparison.ts";
export { statuteLinksByKind } from "./lib/links-by-kind.ts";
export { eEngrossedVersion, tallyLoneEEntries } from "./lib/table-comparison.ts";

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
  /**
   * The Version before this one in print order, when this Version's reading, the text read and the Statute Links by kind, is
   * exactly that Version's (ADR-0036). A Version whose text was not read has the same links as none. The Version's table
   * and its flag are its own either way.
   */
  sameLinksAs: StoredVersion | undefined;
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

/** What was read of a Version's text, as one string to compare with another Version's: the links by kind, sections and chapters apart. */
function readingKeyOf(version: StoredVersion): string {
  const byKind = statuteLinksByKind(version.parse.links);
  return JSON.stringify(
    Object.entries(byKind).map(([kind, targets]) => [
      kind,
      ["section", "chapter"].map((type) =>
        targets
          .filter((linked) => linked.target.type === type)
          .map((linked) => [linked.target.id, linked.measureSections]),
      ),
    ]),
  );
}

/** The Version before this one, when this one was read and its reading is that Version's. A Version that was not read has said nothing. */
function sameLinksAs(version: StoredVersion, before: StoredVersion | undefined): StoredVersion | undefined {
  if (before === undefined || !version.parse.textRead || !before.parse.textRead) return undefined;
  return readingKeyOf(version) === readingKeyOf(before) ? before : undefined;
}

export function statuteLinksOfMeasure(input: StatuteLinksOfMeasureInput): StatuteLinksOfMeasure {
  const { current, superseded } = splitByReplacement(input.amendments, input.measure, input.versions);
  const { table } = input;
  return {
    versions: input.versions.toSorted(compareVersions).map((version, index, inPrintOrder) => ({
      version,
      sameLinksAs: sameLinksAs(version, inPrintOrder[index - 1]),
      table: table === undefined ? undefined : tableOfVersion(version, table),
    })),
    currentAmendments: current,
    supersededAmendments: superseded,
    table: table === undefined ? undefined : tableOfMeasure(input.versions, table),
  };
}
