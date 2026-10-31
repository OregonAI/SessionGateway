// How the Statutes Affected Table is shown beside a Version's parsed Statute Links by get_measure (ticket #22, ADR-0033).
// The table is a second source: its entries are set beside the links parsed from the Version they name, never over them.
// An entry the parsed links also have, with the same target, the same kind and the same measure section, is confirmed.
// An entry the parsed links lack, and a parsed link that changes the law and has no entry, are each listed as they are,
// so that the two sides of a disagreement are both shown.
import { z } from "zod";
import {
  statuteChangeKinds,
  statuteLinkKindOfTableAction,
  versionDescriptionOfTableLevel,
  type StatuteLink,
  type StatutesAffectedEntry,
  type StatutesAffectedTableOfMeasure,
  type StoredVersion,
} from "#/packages/domain/statute-links.ts";
import {
  statuteLinksBySourceOutput,
  statuteLinksShown,
  targetsOutput,
  versionEntryOutput,
  versionsOutputOf,
  type StatuteLinksBySourceOutput,
} from "./statute-links.ts";

/**
 * Links by the kinds the table can say: what a Measure does to the law. There is no "cites", because the table does
 * not list citations, so a citation is never a disagreement.
 */
const changeLinksOutput = z.object(
  Object.fromEntries(statuteChangeKinds.map((kind) => [kind, targetsOutput])) as Record<
    (typeof statuteChangeKinds)[number],
    typeof targetsOutput
  >,
);

export const tableOfVersionOutput = z.object({
  compared: z
    .boolean()
    .describe(
      "True when the table's entries were set beside this Version's parsed Statute Links. False when this index did not read the Version's text for Statute Links, so that there is nothing to compare with: confirmed, only_in_table and only_in_parsed_links are then empty, and that says nothing.",
    ),
  not_compared_reason: z.string().nullable().describe("Why the entries were not compared. Null when compared is true."),
  entries: changeLinksOutput.describe(
    "Every entry the table has for this Version of the Measure, as the table prints it, by what it does (amends, repeals, adds-to): each ORS target once with the measure sections the table says. Never changed by the parsed links.",
  ),
  confirmed: changeLinksOutput.describe(
    "The links both sources have: the same ORS target, the same kind and the same measure section, parsed from the Version's text and listed in the table.",
  ),
  only_in_table: changeLinksOutput.describe(
    "Entries of the table that the parsed links lack: a disagreement. The parsed link, if there is one for the same target, differs in kind or in measure section and is in only_in_parsed_links.",
  ),
  only_in_parsed_links: changeLinksOutput.describe(
    "Parsed links that change the law (amends, repeals, adds-to) and that the table has no entry for: a disagreement. Citations are not compared.",
  ),
});

export const tableOfMeasureOutput = z.object({
  source_url: z.string().describe("Where this index fetched the table from: Legislative Counsel's address for it."),
  retrieved_at: z
    .string()
    .describe(
      "When this index retrieved the copy it holds, in Pacific time with its UTC offset. A later pull that finds the same file leaves it as it was.",
    ),
  lists_measure: z.boolean().describe("True when the table has at least one entry for this Measure."),
  other_entries: z
    .array(
      z.object({
        level: z
          .string()
          .nullable()
          .describe(
            'The engrossing level the table prints beside the Measure: "A", "B", "BCC". Null when it prints none.',
          ),
        version: z
          .string()
          .nullable()
          .describe('The Version that level names, such as "A-Engrossed". Null when the level names none.'),
        reason: z.string().describe("Why these entries are not set beside any Version's links."),
        entries: changeLinksOutput.describe("The entries at this level, as the table prints them."),
      }),
    )
    .describe(
      "Entries of the table for this Measure that name a Version this index does not hold, or a level that names no Version. They are listed as the table has them, and compared with nothing.",
    ),
  note: z.string().describe("What the table is and how its entries are set beside the parsed links."),
});

/** get_measure's Statute Links by source, with the table's entries beside the parsed links of the Version each names. */
export const statuteLinksBySourceWithTableOutput = statuteLinksBySourceOutput.extend({
  versions: versionsOutputOf(
    versionEntryOutput.extend({
      statutes_affected_table: tableOfVersionOutput
        .optional()
        .describe(
          "Present when the Statutes Affected Table has entries that name this Version: the entries, and how they compare with the parsed links in statute_links. Absent when the table names another Version, or the index holds no table.",
        ),
    }),
  ),
  statutes_affected_table: tableOfMeasureOutput
    .optional()
    .describe(
      "Present when this index holds Legislative Counsel's Statutes Affected Table: where it came from and when, and the entries for Versions this index cannot compare. The comparison with each Version's parsed links is in that Version's own statutes_affected_table. Absent while the index holds no table (the deployment does not load it, or Legislative Counsel has not published it).",
    ),
});

export type StatuteLinksBySourceWithTable = z.infer<typeof statuteLinksBySourceWithTableOutput>;

export const STATUTES_AFFECTED_TABLE_NOTE =
  "Legislative Counsel publishes the Statutes Affected Table after the Session. It lists, for each Measure, the ORS sections and chapters the Measure amends, repeals or adds to, with the measure section, at the engrossing level the Measure's row was made from (SB 69 A is the A-Engrossed Version; no letter is the Introduced Version). It is a second source: its entries are set beside the Statute Links parsed from the text of the Version each names, in that Version's statutes_affected_table, and never replace them. A link both sources have is confirmed. A disagreement is shown on both sides, unchanged. A Version that no entry names has no table, and the table does not list citations, so citations are never compared.";

/** A link to compare: what a parsed link or a table entry says, by the three things that must agree. */
function keyOf(link: Pick<StatuteLink, "kind" | "measureSection"> & { target: { id: string } }): string {
  return JSON.stringify([link.kind, link.target.id, link.measureSection]);
}

/** A table entry as a Statute Link, so that it is shown as one is. The table's "A" is amends, its "R" repeals, its "Add" adds-to. */
function linkOfEntry(entry: StatutesAffectedEntry): StatuteLink {
  return {
    kind: statuteLinkKindOfTableAction[entry.action],
    target: entry.target,
    measureSection: entry.measureSection,
  };
}

/** The links the table says, each once, in the table's order. */
function distinctLinks(links: readonly StatuteLink[]): StatuteLink[] {
  return [...new Map(links.map((link) => [keyOf(link), link])).values()];
}

function changeLinksShown(links: readonly StatuteLink[]): z.infer<typeof changeLinksOutput> {
  const shown = statuteLinksShown(links);
  return Object.fromEntries(statuteChangeKinds.map((kind) => [kind, shown[kind]])) as z.infer<typeof changeLinksOutput>;
}

/** The table's entries for a Version, set beside what was parsed of its text. */
function tableOfVersion(
  version: StoredVersion,
  entries: readonly StatutesAffectedEntry[],
): z.infer<typeof tableOfVersionOutput> {
  const inTable = distinctLinks(entries.map(linkOfEntry));
  const nothing = changeLinksShown([]);
  if (!version.parse.textRead) {
    return {
      compared: false,
      not_compared_reason:
        "This index did not read the Version's text for Statute Links (it has no text layer, or the index has not read it yet), so there are no parsed links to set the entries beside.",
      entries: changeLinksShown(inTable),
      confirmed: nothing,
      only_in_table: nothing,
      only_in_parsed_links: nothing,
    };
  }
  const parsed = distinctLinks(version.parse.links.filter((link) => link.kind !== "cites"));
  const parsedKeys = new Set(parsed.map(keyOf));
  const tableKeys = new Set(inTable.map(keyOf));
  return {
    compared: true,
    not_compared_reason: null,
    entries: changeLinksShown(inTable),
    confirmed: changeLinksShown(inTable.filter((link) => parsedKeys.has(keyOf(link)))),
    only_in_table: changeLinksShown(inTable.filter((link) => !parsedKeys.has(keyOf(link)))),
    only_in_parsed_links: changeLinksShown(parsed.filter((link) => !tableKeys.has(keyOf(link)))),
  };
}

/** Entries grouped by the level they print, in the order the levels first appear. */
function byLevel(entries: readonly StatutesAffectedEntry[]): Map<string | null, StatutesAffectedEntry[]> {
  const groups = new Map<string | null, StatutesAffectedEntry[]>();
  for (const entry of entries) groups.set(entry.level, [...(groups.get(entry.level) ?? []), entry]);
  return groups;
}

/**
 * Adds the Statutes Affected Table to a Measure's Statute Links by source. With no table the links are returned as
 * they were, so a deployment that does not load the table, or a table that is not published, changes nothing. The
 * table's entries go beside the Version each names (an entry's level names it: none is Introduced, "A" is A-Engrossed),
 * and entries that name a Version the index does not hold, or a level that names none, are listed apart.
 */
export function statuteLinksBySourceWithTable(
  shown: StatuteLinksBySourceOutput,
  versions: readonly StoredVersion[],
  table: StatutesAffectedTableOfMeasure | undefined,
): StatuteLinksBySourceWithTable {
  if (table === undefined) return shown;
  const groups = byLevel(table.entries);
  const heldLabels = new Set(versions.map((version) => version.label));
  const named = (version: StoredVersion): StatutesAffectedEntry[] =>
    table.entries.filter((entry) => versionDescriptionOfTableLevel(entry.level) === version.label);
  const otherEntries: z.infer<typeof tableOfMeasureOutput>["other_entries"] = [];
  for (const [level, entries] of groups) {
    const version = versionDescriptionOfTableLevel(level);
    if (version !== undefined && heldLabels.has(version)) continue;
    otherEntries.push({
      level,
      version: version ?? null,
      reason:
        version === undefined
          ? `The table's level "${level ?? ""}" names no Version in the order Versions are printed in, so its entries are set beside no Version's links.`
          : `This index does not hold the ${version} Version of the Measure, so there are no parsed links to set these entries beside.`,
      entries: changeLinksShown(distinctLinks(entries.map(linkOfEntry))),
    });
  }
  return {
    ...shown,
    versions: shown.versions.map((entry) => {
      const stored = versions.find((version) => version.id === entry.id);
      const entries = stored === undefined ? [] : named(stored);
      return stored === undefined || entries.length === 0
        ? entry
        : { ...entry, statutes_affected_table: tableOfVersion(stored, entries) };
    }),
    statutes_affected_table: {
      source_url: table.sourceUrl,
      retrieved_at: table.retrievedAt,
      lists_measure: table.entries.length > 0,
      other_entries: otherEntries,
      note: STATUTES_AFFECTED_TABLE_NOTE,
    },
  };
}
