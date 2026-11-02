import { placeAmendment, versionRankOf } from "#/packages/domain/documents.ts";
import type { MeasureKey } from "#/packages/domain/index.ts";
import type { StoredAmendment, StoredVersion } from "#/packages/domain/statute-links.ts";

/**
 * A Proposed Amendment with the Version its evidence names, as far as the evidence goes (ADR-0015). `kind` says how far:
 * the Version is named and the Index holds it, it is named and the Index does not hold it (its file did not come), or the
 * evidence names none. `reason` says how the Version was read, or why it is not known.
 */
export type PlacedAmendment =
  | {
      kind: "version";
      amendment: StoredAmendment;
      /** The Version in the words the feed describes Versions in. */
      description: string;
      /** The Index's Version that `description` names. */
      version: StoredVersion;
      reason: string;
    }
  | { kind: "not_held"; amendment: StoredAmendment; description: string; reason: string }
  | { kind: "unknown"; amendment: StoredAmendment; reason: string };

/** A Proposed Amendment a later Version replaces (GLOSSARY.md, "Superseded amendment"). */
export type SupersededAmendment = {
  amendment: StoredAmendment;
  /** The Amended Version, in the words the feed describes Versions in. The Index may not hold its file. */
  amendedVersion: { description: string; held: StoredVersion | undefined };
  /** The next Version after the Amended Version that the Index holds. */
  laterVersion: StoredVersion;
};

/** A Version in the order they were printed in; one with no place in that order after the others, by name. */
export function compareVersions(a: StoredVersion, b: StoredVersion): number {
  const left = versionRankOf(a.label) ?? Number.POSITIVE_INFINITY;
  const right = versionRankOf(b.label) ?? Number.POSITIVE_INFINITY;
  return left === right ? a.label.localeCompare(b.label) : left < right ? -1 : 1;
}

/**
 * The Version an amendment's header and number name, as far as the evidence goes, and the Index's Version when it holds
 * it (ADR-0015). Nothing is guessed: evidence that does not agree names none.
 */
export function placeAmendedVersion(
  amendment: StoredAmendment,
  key: MeasureKey,
  versions: readonly StoredVersion[],
): PlacedAmendment {
  const placement = placeAmendment(
    key,
    amendment.spellings,
    amendment.files.map((file) => file.parse.amendedVersionHeader),
    (versionId) => versions.some((version) => version.id === versionId),
  );
  switch (placement.kind) {
    case "version": {
      const version = versions.find((held) => held.id === placement.versionId);
      if (version === undefined) throw new Error(`The Version ${placement.versionId} was placed but is not held`);
      return { kind: "version", amendment, description: placement.description, version, reason: placement.reason };
    }
    case "not_held":
      return { kind: "not_held", amendment, description: placement.description, reason: placement.reason };
    case "unknown":
      return { kind: "unknown", amendment, reason: placement.reason };
    default:
      return placement satisfies never;
  }
}

/**
 * The next Version after the one at `rank` that the Index holds, or undefined if it holds none. A Version with no place
 * in the order of printing is later than none.
 */
function nextVersionAfter(rank: number, versions: readonly StoredVersion[]): StoredVersion | undefined {
  return versions
    .filter((version) => (versionRankOf(version.label) ?? Number.NEGATIVE_INFINITY) > rank)
    .toSorted(compareVersions)[0];
}

/**
 * The Version an amendment's evidence names, held or not, and where it sits in the order of printing. Undefined when the
 * evidence names none, or a Version that sits nowhere in that order.
 */
function namedVersionOf(placed: PlacedAmendment): { description: string; rank: number } | undefined {
  switch (placed.kind) {
    case "version":
    case "not_held": {
      const rank = versionRankOf(placed.description);
      return rank === undefined ? undefined : { description: placed.description, rank };
    }
    case "unknown":
      return undefined;
    default:
      return placed satisfies never;
  }
}

/**
 * Splits a Measure's Proposed Amendments into the ones whose Statute Links apply and the Superseded amendments. An
 * amendment is superseded while the Index holds a Version later than the one it amends, whether or not it holds that
 * Version's file; the next Version's own links replace the amendment's (ADR-0001, ADR-0015). One whose Version cannot be
 * named stays among the current ones. Each list keeps the order the amendments were given in.
 */
export function splitByReplacement(
  amendments: readonly StoredAmendment[],
  key: MeasureKey,
  versions: readonly StoredVersion[],
): { current: PlacedAmendment[]; superseded: SupersededAmendment[] } {
  const current: PlacedAmendment[] = [];
  const superseded: SupersededAmendment[] = [];
  for (const amendment of amendments) {
    const placed = placeAmendedVersion(amendment, key, versions);
    const named = namedVersionOf(placed);
    const later = named === undefined ? undefined : nextVersionAfter(named.rank, versions);
    if (named === undefined || later === undefined) {
      current.push(placed);
    } else {
      superseded.push({
        amendment,
        amendedVersion: {
          description: named.description,
          held: placed.kind === "version" ? placed.version : undefined,
        },
        laterVersion: later,
      });
    }
  }
  return { current, superseded };
}
