// How the Statutes Affected Table is shown beside a Version's parsed Statute Links by get_measure (ticket #22, ADR-0033).
// The table is a second source: its entries are set beside the links parsed from the Version they name, never over them.
// A Version's block lists each parsed link that changes the law once, flagged with whether the table has an entry for it
// (same target, same kind, same measure section), and then only the disagreements: the entries the parsed links lack, and
// the parsed links the table lacks. Nothing is listed twice, and a list that can grow with a series is cut at a fixed
// number of targets with a count of what it left out.
import { z } from "zod";
import { compareMeasureSections, statuteChangeKinds, type StatuteLink } from "#/packages/domain/statute-links.ts";
import type { StatuteLinksOfMeasure, TableOfMeasure, TableOfVersion } from "#/packages/statute-links/measure.ts";
import {
  amendmentsShown,
  chapterTargetOutput,
  sectionTargetOutput,
  statuteLinksBySourceOutput,
  statuteLinksShown,
  targetsOutput,
  versionEntryOutput,
  versionEntryShown,
  versionsOutputOf,
} from "./statute-links.ts";

/**
 * How many ORS sections, and how many ORS chapters, a list of the table's block shows. A series the table prints once
 * ("319.510 to 319.880") is one entry for each section of it, so a list can grow with the ORS, not with the Measure.
 */
export const TARGETS_SHOWN_PER_LIST = 20;

const notShown = (what: string): z.ZodOptional<z.ZodNumber> =>
  z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `Present only when the list was cut after its first ${String(TARGETS_SHOWN_PER_LIST)} ${what}: how many ${what} it left out.`,
    );

/** Targets of one kind as the table's block shows them: the compact form of #13, cut at a fixed number with a count. */
const cappedTargetsOutput = targetsOutput.extend({
  sections_not_shown: notShown("sections"),
  chapters_not_shown: notShown("chapters"),
});

/**
 * Links by the kinds the table can say: what a Measure does to the law. There is no "cites", because the table does not
 * list citations, so a citation is never a disagreement.
 */
const changeLinksOutput = z.object(
  Object.fromEntries(statuteChangeKinds.map((kind) => [kind, cappedTargetsOutput])) as Record<
    (typeof statuteChangeKinds)[number],
    typeof cappedTargetsOutput
  >,
);

const confirmedByTableOutput = z
  .boolean()
  .describe(
    "True when the table has an entry for this target, of this kind, in these measure sections. A target the text links in a measure section the table has an entry for and in one it has none for is listed twice, once for each.",
  );

/** The parsed links of one kind that change the law, each flagged with whether the table confirms it. */
const flaggedTargetsOutput = z.object({
  sections: z
    .array(sectionTargetOutput.extend({ confirmed_by_table: confirmedByTableOutput }))
    .describe("The ORS sections, in the order of their first measure section."),
  chapters: z
    .array(chapterTargetOutput.extend({ confirmed_by_table: confirmedByTableOutput }))
    .describe("The ORS chapters, in the order of their first measure section."),
  sections_not_shown: notShown("sections"),
  chapters_not_shown: notShown("chapters"),
});

const parsedChangesOutput = z.object(
  Object.fromEntries(statuteChangeKinds.map((kind) => [kind, flaggedTargetsOutput])) as Record<
    (typeof statuteChangeKinds)[number],
    typeof flaggedTargetsOutput
  >,
);

export const tableOfVersionOutput = z.object({
  compared: z
    .boolean()
    .describe(
      "True when the table's entries were set beside this Version's parsed Statute Links. False when this index did not read the Version's text for Statute Links, so that there is nothing to compare with: parsed_changes, only_in_table and only_in_parsed_links are then null, that says nothing about the text, and the table's entries are in entries_not_compared.",
    ),
  not_compared_reason: z.string().nullable().describe("Why the entries were not compared. Null when compared is true."),
  parsed_changes: parsedChangesOutput
    .nullable()
    .describe(
      "The links parsed from this Version's text that change the law (amends, repeals, adds-to), by kind, each target once with its measure sections, as in statute_links, each flagged with confirmed_by_table: true when the table has an entry for it. Citations are not listed, because the table does not list them. Null when there are none to list, or when compared is false.",
    ),
  only_in_table: changeLinksOutput
    .nullable()
    .describe(
      "Disagreement: the table's entries for this Version that the parsed links lack, by what the table says they do, as the table has them. The parsed link for the same target, if there is one, differs in kind or in measure section and is in only_in_parsed_links. Null when there are none, or when compared is false.",
    ),
  only_in_parsed_links: changeLinksOutput
    .nullable()
    .describe(
      "Disagreement: the parsed links that change the law and that the table has no entry for (the targets of parsed_changes with confirmed_by_table false). Citations are not compared. Null when there are none, or when compared is false.",
    ),
  entries_not_compared: changeLinksOutput
    .nullable()
    .describe(
      "Only when compared is false: every entry the table has for this Version, as the table has them, because nothing was parsed to set them beside. Null when compared is true, where the table's entries are the targets of parsed_changes with confirmed_by_table true, and only_in_table, and none is listed twice.",
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
            'What the table prints after the Measure number: an engrossing level ("A", "B", "BCC"), or "E" when it prints an E alone. An E alone is the emergency clause of a row at the Introduced Version, unless the feed lists an E-Engrossed Version of the Measure: then it may be that Version\'s level too, and the table does not say which. Null when it prints nothing.',
          ),
        version: z
          .string()
          .nullable()
          .describe(
            'The Version that level names, such as "A-Engrossed". Null when the level names none, or when it is an E alone that may be the E-Engrossed level.',
          ),
        reason: z.string().describe("Why these entries are not set beside any Version's links."),
        entries: changeLinksOutput.describe("The entries at this level, as the table prints them."),
      }),
    )
    .describe(
      "Entries of the table for this Measure that name a Version this index does not hold, a level that names no Version, or an E alone for a Measure the feed lists an E-Engrossed Version of (the E may be that level). They are listed as the table has them (cut like the lists of a Version's block), and compared with nothing.",
    ),
  note: z.string().describe("What the table is and how its entries are set beside the parsed links."),
});

const versionEntryWithTableOutput = versionEntryOutput.extend({
  statutes_affected_table: tableOfVersionOutput
    .optional()
    .describe(
      "Present when the Statutes Affected Table has entries that name this Version: which of the parsed links that change the law the table confirms, and where the table and the parsed links disagree. Absent when the table names no entry for this Version, or the index holds no table.",
    ),
});

/** get_measure's Statute Links by source, with the table's entries beside the parsed links of the Version each names. */
export const statuteLinksBySourceWithTableOutput = statuteLinksBySourceOutput.extend({
  versions: versionsOutputOf(versionEntryWithTableOutput),
  statutes_affected_table: tableOfMeasureOutput
    .optional()
    .describe(
      "Present when this index holds Legislative Counsel's Statutes Affected Table: where it came from and when, and the entries for Versions this index cannot compare. The comparison with each Version's parsed links is in that Version's own statutes_affected_table. Absent while the index holds no table (the deployment does not load it, or Legislative Counsel has not published it).",
    ),
});

export type StatuteLinksBySourceWithTable = z.infer<typeof statuteLinksBySourceWithTableOutput>;

export const STATUTES_AFFECTED_TABLE_NOTE =
  "Legislative Counsel's Statutes Affected Table is a second source for the Statute Links. Its entries are set beside the links parsed from the text of the Version each names, in that Version's statutes_affected_table, and never replace them. A Version no entry names has no such block, and citations are not compared, because the table does not list them.";

/** The first targets of a list and how many it leaves out (undefined when it leaves none out). */
function cut<Target>(targets: readonly Target[]): { shown: Target[]; notShown: number | undefined } {
  const left = targets.length - TARGETS_SHOWN_PER_LIST;
  return { shown: targets.slice(0, TARGETS_SHOWN_PER_LIST), notShown: left > 0 ? left : undefined };
}

/** The sections and chapters of a list, each cut at the same number, with the counts of what was cut. */
function cutLists<Section, Chapter>(
  sections: readonly Section[],
  chapters: readonly Chapter[],
): {
  sections: Section[];
  chapters: Chapter[];
  sections_not_shown?: number;
  chapters_not_shown?: number;
} {
  const cutSections = cut(sections);
  const cutChapters = cut(chapters);
  return {
    sections: cutSections.shown,
    chapters: cutChapters.shown,
    ...(cutSections.notShown === undefined ? {} : { sections_not_shown: cutSections.notShown }),
    ...(cutChapters.notShown === undefined ? {} : { chapters_not_shown: cutChapters.notShown }),
  };
}

function changeLinksShown(links: readonly StatuteLink[]): z.infer<typeof changeLinksOutput> {
  const shown = statuteLinksShown(links);
  return Object.fromEntries(
    statuteChangeKinds.map((kind) => [kind, cutLists(shown[kind].sections, shown[kind].chapters)]),
  ) as z.infer<typeof changeLinksOutput>;
}

/** The first measure section a target is linked in, which the lists are in the order of. */
function firstSectionOf(target: { measure_sections: (string | null)[] }): string | null {
  return target.measure_sections[0] ?? null;
}

/**
 * The parsed links that change the law, by kind and each target once, flagged with whether the table has an entry for the
 * link. A target the table confirms in some measure sections and not in others is one target for each.
 */
function parsedChangesShown(
  parsed: readonly { link: StatuteLink; confirmed: boolean }[],
): z.infer<typeof parsedChangesOutput> {
  const ofKind = (kind: (typeof statuteChangeKinds)[number]): z.infer<typeof flaggedTargetsOutput> => {
    const links = (confirmed: boolean): StatuteLink[] =>
      parsed.filter((item) => item.link.kind === kind && item.confirmed === confirmed).map((item) => item.link);
    const yes = statuteLinksShown(links(true))[kind];
    const no = statuteLinksShown(links(false))[kind];
    const byFirstSection = <Target extends { measure_sections: (string | null)[] }>(a: Target, b: Target): number =>
      compareMeasureSections(firstSectionOf(a), firstSectionOf(b));
    return cutLists(
      [
        ...yes.sections.map((target) => ({ ...target, confirmed_by_table: true })),
        ...no.sections.map((target) => ({ ...target, confirmed_by_table: false })),
      ].toSorted(byFirstSection),
      [
        ...yes.chapters.map((target) => ({ ...target, confirmed_by_table: true })),
        ...no.chapters.map((target) => ({ ...target, confirmed_by_table: false })),
      ].toSorted(byFirstSection),
    );
  };
  return Object.fromEntries(statuteChangeKinds.map((kind) => [kind, ofKind(kind)])) as z.infer<
    typeof parsedChangesOutput
  >;
}

/** The Version's block: which of its parsed links that change the law the table confirms, and where the two disagree. */
function tableOfVersionShown(table: TableOfVersion): z.infer<typeof tableOfVersionOutput> {
  const listed = (links: readonly StatuteLink[]): z.infer<typeof changeLinksOutput> | null =>
    links.length === 0 ? null : changeLinksShown(links);
  switch (table.kind) {
    case "not_compared":
      return {
        compared: false,
        not_compared_reason:
          "This index did not read the Version's text for Statute Links (it has no text layer, or the index has not read it yet), so there are no parsed links to set the entries beside.",
        parsed_changes: null,
        only_in_table: null,
        only_in_parsed_links: null,
        entries_not_compared: listed(table.entries),
      };
    case "compared": {
      const parsed = [
        ...table.confirmed.map((link) => ({ link, confirmed: true })),
        ...table.onlyInParsedLinks.map((link) => ({ link, confirmed: false })),
      ];
      return {
        compared: true,
        not_compared_reason: null,
        parsed_changes: parsed.length === 0 ? null : parsedChangesShown(parsed),
        only_in_table: listed(table.onlyInTable),
        only_in_parsed_links: listed(table.onlyInParsedLinks),
        entries_not_compared: null,
      };
    }
    default:
      return table satisfies never;
  }
}

/**
 * Why entries are set beside no Version's links: the table does not name a Version (a level of more than one letter, or an
 * E alone for a Measure the feed lists an E-Engrossed Version of), or the Version it names is not held.
 */
function reasonOf({ printed, why }: TableOfMeasure["apart"][number]): string {
  switch (why.kind) {
    case "version_not_held":
      return `This index does not hold the ${why.version} Version of the Measure, so there are no parsed links to set these entries beside.`;
    case "e_alone_may_be_a_level":
      return "The table printed an “E” alone after the Measure number. Its legend gives “E” as the mark that an emergency clause applies and gives engrossing levels as letters beside the number, and the feed lists an E-Engrossed Version of this Measure, so this E is either that Version's level or the emergency clause of a row at the Introduced Version, and the table's text does not say which. Nothing is guessed: these entries are set beside no Version's links.";
    case "level_names_no_version":
      return `The table's level "${printed ?? ""}" names no Version in the order Versions are printed in, so its entries are set beside no Version's links.`;
    default:
      return why satisfies never;
  }
}

/** Where the table came from, and the entries that name a Version this index does not hold or a level that names none. */
function tableOfMeasureShown(table: TableOfMeasure): z.infer<typeof tableOfMeasureOutput> {
  return {
    source_url: table.sourceUrl,
    retrieved_at: table.retrievedAt,
    lists_measure: table.listsMeasure,
    other_entries: table.apart.map((apart) => ({
      level: apart.printed,
      version: apart.why.kind === "version_not_held" ? apart.why.version : null,
      reason: reasonOf(apart),
      entries: changeLinksShown(apart.links),
    })),
    note: STATUTES_AFFECTED_TABLE_NOTE,
  };
}

/**
 * A Measure's Statute Links by source, with the Statutes Affected Table's entries beside the Version each names. With no
 * table the answer is the Statute Links alone, so a deployment that does not load the table, or a table that is not
 * published, changes nothing. The entry point has decided which links the table confirms, which amendments are superseded
 * and which Versions have the same links as the one before; this writes them down, each Version's block beside its entry
 * whether or not its links are repeated (ADR-0036).
 */
export function statuteLinksBySourceWithTable(links: StatuteLinksOfMeasure): StatuteLinksBySourceWithTable {
  return {
    versions: links.versions.map((entry) =>
      versionEntryShown(
        entry,
        entry.table === undefined ? {} : { statutes_affected_table: tableOfVersionShown(entry.table) },
      ),
    ),
    ...amendmentsShown(links),
    ...(links.table === undefined ? {} : { statutes_affected_table: tableOfMeasureShown(links.table) }),
  };
}
