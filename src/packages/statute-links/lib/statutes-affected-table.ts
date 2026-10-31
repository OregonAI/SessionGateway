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
// After the Measure number come up to three tokens of one to three capitals and perhaps a digit: an engrossing level ("A",
// "BCC", "AMR2"), an overturned veto ("OV", "OVP") and an "E" (readTail).
const entryRow = new RegExp(
  String.raw`^(?:${target}\s+(?<closesSeries>\)\s+)?)?(?<action>Add|A|R)\s+§(?<measureSection>\d+[a-z]?)\s+(?<prefix>[A-Z]{2,3})\s+(?<number>\d{1,5})(?<rest>(?:\s+[A-Z]{1,3}\d?){0,3})$`,
);
const pageHeader = /^(?:RS\d{2}-T-\d+\s+)?TABLES - \d{4} [A-Z ]+?(?:\s+RS\d{2}-T-\d+)?$/;
const columnHeader = /^(?:\(\d\)\s*)+$/;
const loneDate = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
// A table's title is in capitals and has no digit: "ORS SECTIONS AMENDED, REPEALED OR “ADDED TO”", "SECTIONS IN
// UNCODIFIED LAW AMENDED,". A row has a digit and a section sign.
const tableTitle = /^[A-Z][A-Z ,()“”".'-]{10,}$/;
const orsTableTitle = /^ORS SECTIONS /;
// The date at the foot of every page, as the table prints it: month and day of one or two digits ("8/19/2025", "11/3/2027").
const footerDate = /^(?:1[0-2]|0?[1-9])\/(?:3[01]|[12]\d|0?[1-9])\/\d{4}$/;

/** What the table's reading came to. */
export type StatutesAffectedTableParse = {
  /** The rows of this Session's Measures, in the table's order. */
  entries: StatutesAffectedEntry[];
  /**
   * The rows of a previous Session's Measures: a Measure repassed over the Governor's veto has its previous session's
   * number and “OVP” after it (the legend, below). They are kept apart, because that number is not this Session's Measure
   * of the same number, and nothing in this Session's index is that Measure.
   */
  previousSessionEntries: StatutesAffectedEntry[];
  /**
   * The lines of the ORS table's rows that were not read: a line that is not a row, a column head, a running header or
   * a title, once the column heads have begun. Empty for a table in the shape this reads. Nothing is guessed for them.
   */
  unreadLines: string[];
};

/**
 * The date that ends every page: the one that most pages end with. Undefined when none ends in a date.
 *
 * PDF.js writes the date straight after the last row, so "SB 69" and "11/3/2027" arrive as "SB 6911/3/2027", and a
 * date can be read with one digit more or fewer than the table printed it: that text ends in "11/3/2027" and in
 * "1/3/2027", and "SB 691" is as good a Measure as "SB 69". The date is the table's, the same on every page, so the one
 * that ends the most pages is it: with the table printed "1/19/2025", a page that ends "SB 11/19/2025" ends in
 * "11/19/2025" too, but the other pages do not. When the same pages end in both, they tie, and the longer wins: the
 * shorter is the same date with its first digit taken off, which is how a November or December date ("11/3/2027",
 * "12/1/2027") ends every page, while the shorter would be the table's only if the last Measure number of every page
 * ended in 1 and the table were dated in January or February. The text cannot tell those two apart, and the second
 * needs one chance in ten for each page.
 */
function pageFooterDate(pages: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const length of [8, 9, 10]) {
      const tail = page.slice(-length);
      if (tail.length === length && footerDate.test(tail)) counts.set(tail, (counts.get(tail) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort(([a, countA], [b, countB]) => countB - countA || b.length - a.length)[0]?.[0];
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

/** An overturned veto, as the table's legend words it. */
type Veto = "OV" | "OVP";

function isVeto(token: string): token is Veto {
  return token === "OV" || token === "OVP";
}

/** What the tokens after the Measure number say. */
type Tail = { level: string | null; emergency: boolean; loneE: boolean; veto: Veto | null };

/**
 * What follows the Measure number, which the legend (page 1 of the table) describes: "The section number and current
 * session measure number or previous session measure number if a measure was repassed over the Governor’s veto, followed
 * by “OV” for a current session overturned veto or “OVP” for a previous session overturned veto", then "The engrossing
 * level is printed next to the measure number if the measure has been engrossed (such as “C” to indicate the C-engrossed
 * version, “AMR” or “AMR2” ... “BCC” or “BCC2” ...)", and "(4) An “E” if an emergency clause applies to the amendment,
 * repeal or addition". So the tail holds an engrossing level, a veto mark and an "E", each at most once, any of them
 * missing. The legend does not say whether the level or the veto mark comes first, so the tokens are told apart by what
 * they say; the "E" of the last column is last, and follows a level.
 *
 * An "E" alone is the legend's emergency clause (column 4) or an E-Engrossed level (the legend's levels are examples), and
 * the text has no columns to tell them apart (pdftotext -layout has, PDF.js's does not): it is read as neither, and the
 * entry says so (`loneE`). Undefined for anything the legend has no form for.
 */
function readTail(rest: string): Tail | undefined {
  const tokens = rest.split(/\s+/).filter((token) => token !== "");
  const vetoes = tokens.filter(isVeto);
  if (tokens.length > 3 || vetoes.length > 1) return undefined;
  const veto = vetoes[0] ?? null;
  const [first = null, second] = tokens.filter((token) => !isVeto(token));
  switch (tokens.length - vetoes.length) {
    case 0:
      return { level: null, emergency: false, loneE: false, veto };
    case 1:
      return first === "E"
        ? { level: null, emergency: false, loneE: true, veto }
        : { level: first, emergency: false, loneE: false, veto };
    case 2:
      return second === "E" && first !== "E" && tokens.at(-1) === "E"
        ? { level: first, emergency: true, loneE: false, veto }
        : undefined;
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
  const previousSessionEntries: StatutesAffectedEntry[] = [];
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
    // A previous session's Measure repassed over the Governor's veto is not any Measure of this Session's index.
    const kept = tail.veto === "OVP" ? previousSessionEntries : entries;
    for (const entryTarget of targets) {
      kept.push({
        measure: { prefix: groups["prefix"] ?? "", number: Number(groups["number"]) },
        level: tail.level,
        action,
        target: entryTarget,
        measureSection: groups["measureSection"] ?? "",
        emergency: tail.emergency,
        loneE: tail.loneE,
      });
    }
  }
  abandonOpenSeries();
  return { entries, previousSessionEntries, unreadLines };
}
