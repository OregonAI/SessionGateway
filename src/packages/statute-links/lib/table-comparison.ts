import { versionDescriptionOfLetter } from "#/packages/domain/documents.ts";
import {
  statuteLinkKindOfTableAction,
  versionDescriptionOfTableLevel,
  type StatuteLink,
  type StatutesAffectedEntry,
  type StatutesAffectedTableOfMeasure,
  type StoredVersion,
} from "#/packages/domain/statute-links.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";

/**
 * How the Statutes Affected Table's entries for a Version compare with the links read from its text (ADR-0033). The
 * comparison covers the links that change the law (amends, repeals, adds-to); citations are never compared.
 */
export type TableOfVersion =
  | {
      kind: "compared";
      /** The Confirmed links: the Version's links that change the law which a Table entry also has (GLOSSARY.md). In the order the text has them, each once. */
      confirmed: StatuteLink[];
      /** The disagreement on the table's side: entries with no such link in the text, in the table's order. */
      onlyInTable: StatuteLink[];
      /** The disagreement on the text's side: links that change the law with no such entry, in the order the text has them. */
      onlyInParsedLinks: StatuteLink[];
    }
  | {
      kind: "not_compared";
      /** The Version's text was not read (a scan, or not yet), so there is nothing to compare: the table's entries for it, each once. */
      entries: StatuteLink[];
    };

/** Why entries are set beside no Version the Index holds. */
export type WhyApart =
  | { kind: "version_not_held"; version: string }
  | { kind: "level_names_no_version" }
  | { kind: "e_alone_may_be_a_level" };

/** Entries of the table that are set beside no Version's links, grouped by what the table printed after the Measure number. */
export type EntriesApart = {
  /** An engrossing level ("A", "BCC"), "E" for an E alone, or null when the table printed nothing. */
  printed: string | null;
  why: WhyApart;
  /** The entries as links, each once, in the table's order. */
  links: StatuteLink[];
};

/** The table as the Index holds it for a Measure, and what the Index could not set beside any Version. */
export type TableOfMeasure = {
  sourceUrl: string;
  retrievedAt: Timestamp;
  /** True when the table has at least one entry for the Measure. */
  listsMeasure: boolean;
  apart: EntriesApart[];
};

/** What must agree for a parsed link and a Table entry to be the same link: the kind, the ORS target and the measure section. */
function keyOf(link: StatuteLink): string {
  return JSON.stringify([link.kind, link.target.id, link.measureSection]);
}

/** A Table entry as a Statute Link. The table's "A" is amends, its "R" repeals, its "Add" adds-to. */
function linkOfEntry(entry: StatutesAffectedEntry): StatuteLink {
  return {
    kind: statuteLinkKindOfTableAction[entry.action],
    target: entry.target,
    measureSection: entry.measureSection,
  };
}

/** The links of a list, each once, in the order they first appear. */
function distinctLinks(links: readonly StatuteLink[]): StatuteLink[] {
  return [...new Map(links.map((link) => [keyOf(link), link])).values()];
}

/** The Table entries that name a Version, set beside what was read of its text. */
function compareWithText(version: StoredVersion, entries: readonly StatutesAffectedEntry[]): TableOfVersion {
  const inTable = distinctLinks(entries.map(linkOfEntry));
  if (!version.parse.textRead) return { kind: "not_compared", entries: inTable };
  const parsed = distinctLinks(version.parse.links.filter((link) => link.kind !== "cites"));
  const parsedKeys = new Set(parsed.map(keyOf));
  const tableKeys = new Set(inTable.map(keyOf));
  return {
    kind: "compared",
    confirmed: parsed.filter((link) => tableKeys.has(keyOf(link))),
    onlyInTable: inTable.filter((link) => !parsedKeys.has(keyOf(link))),
    onlyInParsedLinks: parsed.filter((link) => !tableKeys.has(keyOf(link))),
  };
}

/** The description of the E-Engrossed Version, the only Version whose level can be an E alone after the Measure number. */
export const eEngrossedVersion = versionDescriptionOfLetter("E");

/**
 * The description of the Version a Table entry names, given whether the feed lists an E-Engrossed Version of its Measure
 * (held or not). A row with a level, or none, names what `versionDescriptionOfTableLevel` says. A row that ends in an E alone
 * is column (4), the emergency clause, of a row with no level when the feed lists no E-Engrossed Version, so it names the
 * Introduced Version: an E can be a level only if that Version exists. When the feed lists one, the E may be its level or the
 * clause, the table's text does not say which, and nothing is guessed: undefined (ADR-0033, ADR-0013's rule).
 */
function versionDescriptionOfEntry(
  entry: Pick<StatutesAffectedEntry, "level" | "loneE">,
  listsEEngrossed: boolean,
): string | undefined {
  if (!entry.loneE) return versionDescriptionOfTableLevel(entry.level);
  return listsEEngrossed ? undefined : versionDescriptionOfLetter(null);
}

/** What the Build report counts of a table's entries that end in an E alone (ADR-0034). */
export type LoneETally = {
  /** The entries that end in an E alone after the Measure number: the emergency clause, or the level of an E-Engrossed Version. */
  entries: number;
  /** Of those, the entries of a Measure the feed lists an E-Engrossed Version of: the rule leaves them naming no Version. */
  namingNoVersion: number;
};

/**
 * Counts the entries that end in an E alone, and of those the ones that name no Version (ADR-0033). `listsEEngrossed` says
 * whether the feed lists an E-Engrossed Version of a Measure, held or not: the rule is the one that sets each entry beside a
 * Version.
 */
export function tallyLoneEEntries(
  entries: readonly StatutesAffectedEntry[],
  listsEEngrossed: (measure: StatutesAffectedEntry["measure"]) => boolean,
): LoneETally {
  const loneE = entries.filter((entry) => entry.loneE);
  return {
    entries: loneE.length,
    namingNoVersion: loneE.filter(
      (entry) => versionDescriptionOfEntry(entry, listsEEngrossed(entry.measure)) === undefined,
    ).length,
  };
}

/** What the table says of a Version: undefined when no entry names it. */
export function tableOfVersion(
  version: StoredVersion,
  table: StatutesAffectedTableOfMeasure,
): TableOfVersion | undefined {
  const listsEEngrossed = table.listedVersions.includes(eEngrossedVersion);
  const entries = table.entries.filter((entry) => versionDescriptionOfEntry(entry, listsEEngrossed) === version.label);
  return entries.length === 0 ? undefined : compareWithText(version, entries);
}

/** What the table printed after the Measure number: the level, or "E" for an E alone. */
function printedLevelOf(entry: StatutesAffectedEntry): string | null {
  return entry.loneE ? "E" : entry.level;
}

/** Entries grouped by what they print after the Measure number, in the order the groups first appear. */
function byPrintedLevel(entries: readonly StatutesAffectedEntry[]): Map<string | null, StatutesAffectedEntry[]> {
  const groups = new Map<string | null, StatutesAffectedEntry[]>();
  for (const entry of entries) {
    const level = printedLevelOf(entry);
    groups.set(level, [...(groups.get(level) ?? []), entry]);
  }
  return groups;
}

/** Why a group of entries is set beside no Version's links, from its first entry and the Version that entry names. */
function whyApart(first: StatutesAffectedEntry, version: string | undefined): WhyApart {
  if (version !== undefined) return { kind: "version_not_held", version };
  return first.loneE ? { kind: "e_alone_may_be_a_level" } : { kind: "level_names_no_version" };
}

/**
 * The table as the Index holds it for a Measure, with the entries that name no Version the Index holds set apart: a level
 * that names no Version, or a Version whose file the Index does not hold (ADR-0033).
 */
export function tableOfMeasure(
  versions: readonly StoredVersion[],
  table: StatutesAffectedTableOfMeasure,
): TableOfMeasure {
  const heldLabels = new Set(versions.map((version) => version.label));
  const listsEEngrossed = table.listedVersions.includes(eEngrossedVersion);
  const apart: EntriesApart[] = [];
  for (const [printed, entries] of byPrintedLevel(table.entries)) {
    const [first] = entries;
    if (first === undefined) continue;
    const version = versionDescriptionOfEntry(first, listsEEngrossed);
    if (version !== undefined && heldLabels.has(version)) continue;
    apart.push({ printed, why: whyApart(first, version), links: distinctLinks(entries.map(linkOfEntry)) });
  }
  return {
    sourceUrl: table.sourceUrl,
    retrievedAt: table.retrievedAt,
    listsMeasure: table.entries.length > 0,
    apart,
  };
}
