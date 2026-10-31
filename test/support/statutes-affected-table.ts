// What a test needs of the Statutes Affected Table (ticket #22): where the fake OLIS serves the fixture's copy, the
// shape an agent sees of the table's entries in get_measure, and a made-up table for the cases the real one has no
// example of. The builders write an expected value as a literal, as test/support/statute-links.ts does for links.
import { statuteChangeKinds, type StatuteLinkKind } from "#/packages/domain/statute-links.ts";
import { madeUpPdf } from "./made-up-pdf.ts";
import {
  chapterTarget,
  sectionTarget,
  type ChapterTarget,
  type LinksOfKind,
  type SectionTarget,
} from "./statute-links.ts";

/** Where Legislative Counsel publishes the 2025R1 table, and the path the fixture's manifest and the fake OLIS serve it at. */
export const publishedTableUrl = "https://www.oregonlegislature.gov/AutoPubs/artables2025R1.pdf";
export const tablePath = "/AutoPubs/artables2025R1.pdf";

/** The worker's STATUTES_AFFECTED_TABLE_URL for a fake OLIS at this origin: the fixture's table, on the fake. */
export function tableUrlOn(olisOrigin: string): string {
  return `${olisOrigin}${tablePath}`;
}

export { chapterTarget, sectionTarget };

/** The kinds the table can say. Citations are not among them: the table does not list citations. */
export type ChangeKind = Exclude<StatuteLinkKind, "cites">;

/**
 * Targets of one kind, as a list of the table block shows it: each target once with its measure sections, and a count of
 * the sections or chapters left out when the list was cut (present only when one was).
 */
export type CappedLinksOfKind = LinksOfKind & { sections_not_shown?: number; chapters_not_shown?: number };
export type ChangeLinks = Record<ChangeKind, CappedLinksOfKind>;

/** Targets under these kinds, and none under the others. */
export function expectedChanges(by: Partial<Record<ChangeKind, Partial<CappedLinksOfKind>>>): ChangeLinks {
  return Object.fromEntries(
    statuteChangeKinds.map((kind) => [kind, { sections: [], chapters: [], ...by[kind] }]),
  ) as ChangeLinks;
}

/** A parsed link that changes the law, with whether the table has an entry for it. */
export type Flagged<Target> = Target & { confirmed_by_table: boolean };
export type FlaggedLinksOfKind = {
  sections: Flagged<SectionTarget>[];
  chapters: Flagged<ChapterTarget>[];
  sections_not_shown?: number;
  chapters_not_shown?: number;
};
export type ParsedChanges = Record<ChangeKind, FlaggedLinksOfKind>;

/** A target the table confirms, and one it does not. */
export const confirmed = <Target extends SectionTarget | ChapterTarget>(target: Target): Flagged<Target> => ({
  ...target,
  confirmed_by_table: true,
});
export const unconfirmed = <Target extends SectionTarget | ChapterTarget>(target: Target): Flagged<Target> => ({
  ...target,
  confirmed_by_table: false,
});

/** The parsed links that change the law, with these flagged targets under these kinds, and none under the others. */
export function expectedParsedChanges(by: Partial<Record<ChangeKind, Partial<FlaggedLinksOfKind>>>): ParsedChanges {
  return Object.fromEntries(
    statuteChangeKinds.map((kind) => [kind, { sections: [], chapters: [], ...by[kind] }]),
  ) as ParsedChanges;
}

/** What get_measure shows of the table for one Version (statute_links_by_source.versions[].statutes_affected_table). */
export type TableOfVersion = {
  compared: boolean;
  not_compared_reason: string | null;
  /** Each of these four is null when it has nothing in it. */
  parsed_changes: ParsedChanges | null;
  only_in_table: ChangeLinks | null;
  only_in_parsed_links: ChangeLinks | null;
  entries_not_compared: ChangeLinks | null;
};

/** What get_measure shows of the table for the Measure (statute_links_by_source.statutes_affected_table). */
export type TableOfMeasure = {
  source_url: string;
  retrieved_at: string;
  lists_measure: boolean;
  other_entries: { level: string | null; version: string | null; reason: string; entries: ChangeLinks }[];
  note: string;
};

/**
 * A made-up Statutes Affected Table as a PDF: the page furniture of the real one (its running header, its title and its
 * column heads), then these rows, one to a line, in the order given. The rows are made up, whatever they quote.
 */
export function madeUpTable(rows: readonly string[]): Uint8Array {
  return madeUpPdf([
    [
      "TABLES - 2025 REGULAR SESSION RS25-T-1",
      "ORS SECTIONS AMENDED, REPEALED OR “ADDED TO”",
      "(1) (2) (3) (4) (1) (2) (3) (4)",
      ...rows,
      "8/19/2025",
    ],
  ]);
}
