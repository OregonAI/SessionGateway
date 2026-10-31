import {
  compareOrsChapterIds,
  orsChapterCitationSource,
  orsChapterIdOf,
  orsChapterOf,
  orsSectionCitationSource,
  orsSectionIdOf,
  type OrsSectionId,
} from "#/packages/domain/oregonai.ts";
import {
  chapterTarget,
  sectionTarget,
  tableActions,
  type StatuteTarget,
  type StatutesAffectedEntry,
} from "#/packages/domain/statute-links.ts";
import { createRangeExpander } from "./ranges.ts";

// Legislative Counsel's Statutes Affected Table (artables{session}.pdf) lists, for the ORS, one row for each thing a
// Measure does to a section: the ORS section, series or chapter; "A", "R" or "Add"; the measure section ("§8"); the
// Measure with the engrossing level its row was made from; and an "E" if an emergency clause applies. It is printed in
// two columns, and a row that follows another row for the same ORS target omits the target ("continuation row").
// PDF.js, which wrote the text the store holds (ADR-0010), writes the left column of a page and then its right, one
// row to a line:
//
//   653.616 A §8 SB 69 A
//   A §1 SB 1108 A                     (a continuation row: 653.616 again)
//   Ch. 657B Add §1 SB 69 A            (a chapter row)
//   9.005 to)                          (a series is printed over two lines, with a brace between them)
//   9.757 ) Add §1 SB 880
//   Add §1 SB 791                      (a continuation row of the series)
//
// The rows are read in the order of the text, and a continuation row takes the target of the row before it,
// whichever column the two are in. The text also holds the running header of each page, the column heads, a date at
// the foot of each page (which PDF.js writes straight after the last row, with no line end), and further tables
// after the ORS one (court rules, uncodified law, the Constitution), whose rows look like an ORS table's.

const target = String.raw`(?:Ch\.\s+(?<chapter>${orsChapterCitationSource})|(?<section>${orsSectionCitationSource}))`;
const seriesStart = new RegExp(String.raw`^${target}\s+to\)$`);
// An engrossing level is one to three letters and perhaps a digit ("A", "BCC", "AMR2"); "E" last is the emergency clause.
const entryRow = new RegExp(
  String.raw`^(?:${target}\s+(?<closesSeries>\)\s+)?)?(?<action>Add|A|R)\s+§(?<measureSection>\d+[a-z]?)\s+(?<prefix>[A-Z]{2,3})\s+(?<number>\d{1,5})(?<rest>(?:\s+[A-Z]{1,3}\d?){0,2})$`,
);
const pageHeader = /^(?:RS\d{2}-T-\d+\s+)?TABLES - \d{4} [A-Z ]+?(?:\s+RS\d{2}-T-\d+)?$/;
const columnHeader = /^(?:\(\d\)\s*)+$/;
const loneDate = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
// A table's title is in capitals and has no digit: "ORS SECTIONS AMENDED, REPEALED OR “ADDED TO”", "SECTIONS IN
// UNCODIFIED LAW AMENDED,". A row has a digit and a section sign.
const tableTitle = /^[A-Z][A-Z ,()“”".'-]{10,}$/;
const orsTableTitle = /^ORS SECTIONS /;
const footerDate = /^(?:1[0-2]|[1-9])\/(?:3[01]|[12]\d|0?[1-9])\/\d{4}$/;

/** What the table's reading came to. */
export type StatutesAffectedTableParse = {
  entries: StatutesAffectedEntry[];
  /**
   * The lines of the ORS table's rows that were not read: a line that is not a row, a column head, a running header or
   * a title, once the column heads have begun. Empty for a table in the shape this reads. Nothing is guessed for them.
   */
  unreadLines: string[];
};

/** The date that ends every page: the one that most pages end with, the shortest if they tie. Undefined when none ends in a date. */
function pageFooterDate(pages: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const length of [8, 9, 10]) {
      const tail = page.slice(-length);
      if (tail.length === length && footerDate.test(tail)) counts.set(tail, (counts.get(tail) ?? 0) + 1);
    }
  }
  // PDF.js writes the date straight after the last row, so "HB 2464" and "8/19/2025" arrive as "HB 24648/19/2025",
  // and a Measure number ending in 1 can run into a month: every page ends in the same date, which tells them apart.
  return [...counts.entries()].sort(([a, countA], [b, countB]) => countB - countA || a.length - b.length)[0]?.[0];
}

/** The lines of the text, with the date the pages end in taken off. */
function linesOf(text: string): string[] {
  const pages = text.split("\f").map((page) => page.trimEnd());
  const date = pageFooterDate(pages);
  return pages.flatMap((page) =>
    (date !== undefined && page.endsWith(date) ? page.slice(0, -date.length) : page)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
}

/** What an ORS target in a row names, as the table prints it: a section ("659A.159") or a chapter ("657B"). */
type Printed = { type: "section"; citation: string } | { type: "chapter"; citation: string };

function printedOf(groups: Record<string, string | undefined>): Printed | undefined {
  if (groups["chapter"] !== undefined) return { type: "chapter", citation: groups["chapter"] };
  if (groups["section"] !== undefined) return { type: "section", citation: groups["section"] };
  return undefined;
}

/**
 * What follows the Measure number: nothing, an engrossing level, an "E", or a level and an "E". A lone "E" is the
 * emergency clause (a level of "E", the E-Engrossed Version, would need two). Undefined for anything else.
 */
function readTail(rest: string): { level: string | null; emergency: boolean } | undefined {
  const tokens = rest.split(/\s+/).filter((token) => token !== "");
  const [first = null, second] = tokens;
  switch (tokens.length) {
    case 0:
      return { level: null, emergency: false };
    case 1:
      return first === "E" ? { level: null, emergency: true } : { level: first, emergency: false };
    case 2:
      return second === "E" ? { level: first, emergency: true } : undefined;
    default:
      return undefined;
  }
}

/**
 * Reads the Statutes Affected Table's ORS rows into entries. Pure: text in, entries out. The text is the table's, as
 * the pdf-text package extracts it with PDF.js or as `pdftotext` prints a column (a row is read wherever white space
 * separates its parts, however wide). A series ("9.005 to 9.757") is one entry for each of the sections the ORS
 * section list holds from one end to the other, ends included, as a range in a Version is; a series of chapters is its
 * two chapters and the chapters of the list between them. The tables after the ORS one are not read.
 */
export function readStatutesAffectedTable(
  text: string,
  orsSections: readonly OrsSectionId[],
): StatutesAffectedTableParse {
  const expandRange = createRangeExpander(orsSections);
  const chaptersListed = [...new Set(orsSections.map(orsChapterOf))];
  const entries: StatutesAffectedEntry[] = [];
  const unreadLines: string[] = [];
  let inOrsTable = true;
  let columnHeadsBegun = false;
  // The row a series began on, waiting for the line that closes it.
  let openSeries: { printed: Printed; line: string } | undefined;
  // The targets of the last row with an ORS target that was read: what a continuation row is for. Undefined while they
  // are not known: before the first row, and after a line that was left unread, because the ORS number that line printed
  // is the one its continuation rows belong to, and a continuation row is never filed under the row before it.
  let current: StatuteTarget[] | undefined;

  const leaveUnread = (line: string): void => {
    unreadLines.push(line);
    current = undefined;
  };

  const abandonOpenSeries = (): void => {
    if (openSeries !== undefined) leaveUnread(openSeries.line);
    openSeries = undefined;
  };

  const targetsOfSeries = (from: Printed, to: Printed): StatuteTarget[] | undefined => {
    if (from.type === "section" && to.type === "section")
      return expandRange(from.citation, to.citation).map(sectionTarget);
    if (from.type === "chapter" && to.type === "chapter") {
      const first = orsChapterIdOf(from.citation);
      const last = orsChapterIdOf(to.citation);
      if (first === undefined || last === undefined) return undefined;
      const ends = [first, last];
      const between = chaptersListed.filter(
        (id) => compareOrsChapterIds(id, first) >= 0 && compareOrsChapterIds(id, last) <= 0,
      );
      return [...new Set([...ends, ...between])].sort(compareOrsChapterIds).map(chapterTarget);
    }
    return undefined;
  };

  const targetsOfOne = (printed: Printed): StatuteTarget[] | undefined => {
    if (printed.type === "chapter") {
      const id = orsChapterIdOf(printed.citation);
      return id === undefined ? undefined : [chapterTarget(id)];
    }
    const id = orsSectionIdOf(printed.citation);
    return id === undefined ? undefined : [sectionTarget(id)];
  };

  for (const line of linesOf(text)) {
    if (pageHeader.test(line) || loneDate.test(line)) continue;
    if (tableTitle.test(line)) {
      abandonOpenSeries();
      inOrsTable = orsTableTitle.test(line);
      columnHeadsBegun = false;
      current = undefined;
      continue;
    }
    if (columnHeader.test(line)) {
      columnHeadsBegun = true;
      continue;
    }
    if (!inOrsTable) continue;
    const start = seriesStart.exec(line);
    if (start?.groups !== undefined) {
      abandonOpenSeries();
      const printed = printedOf(start.groups);
      if (printed !== undefined) openSeries = { printed, line };
      continue;
    }
    const row = entryRow.exec(line);
    const groups = row?.groups;
    if (groups === undefined) {
      abandonOpenSeries();
      if (columnHeadsBegun) leaveUnread(line);
      continue;
    }
    const printed = printedOf(groups);
    let targets: StatuteTarget[] | undefined;
    if (printed === undefined) {
      abandonOpenSeries();
      targets = current;
    } else if (groups["closesSeries"] !== undefined) {
      targets = openSeries === undefined ? undefined : targetsOfSeries(openSeries.printed, printed);
      openSeries = undefined;
    } else {
      abandonOpenSeries();
      targets = targetsOfOne(printed);
    }
    const action = tableActions.find((candidate) => candidate === groups["action"]);
    const tail = readTail(groups["rest"] ?? "");
    if (targets === undefined || action === undefined || tail === undefined) {
      leaveUnread(line);
      continue;
    }
    current = targets;
    for (const entryTarget of targets) {
      entries.push({
        measure: { prefix: groups["prefix"] ?? "", number: Number(groups["number"]) },
        level: tail.level,
        action,
        target: entryTarget,
        measureSection: groups["measureSection"] ?? "",
        emergency: tail.emergency,
      });
    }
  }
  abandonOpenSeries();
  return { entries, unreadLines };
}
