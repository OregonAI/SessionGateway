import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { listedPositions, positionOf, type DocumentId, type TestimonyEntry } from "#/packages/domain/documents.ts";
import { measureIdOf, parseMeasureReference, type MeasureId, type SessionKey } from "#/packages/domain/index.ts";
import type { Outcome } from "./outcome.ts";
import { unknownMeasureMessage } from "./get-measure.ts";
import { noLongerListedFlag, noLongerListedOutput } from "./listing.ts";

export const testimonyInput = z.object({
  measure: z.string().describe('A Measure\'s id, such as "measure-2025r1-hb3131", or its citation, such as "HB 3131".'),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Which page of the Measure's Testimony to return, from 1. The first by default."),
});

/**
 * How many Testimony rows one page lists. The 2025R1 feed has Measures with 14,223 rows (SB 210), 4,204 (HB 2025) and
 * 3,668 (HB 3075), and 17 with more than 1,000 (counted over the full local cache of 99,665 rows on 2026-10-30), so
 * a Measure's whole Testimony would overflow an agent's context.
 *
 * Measured the same day through the tool: HB 3131's whole answer, 42 items in 33 groups, is 23,124 characters of
 * JSON, and a page of 50 made-up items in 6 groups is 24,678, so an item is about 470 characters (HB 3131's
 * longest, 514) plus the header of its group, and a page of 50 is about 25,000 to 27,500 characters. That is 1.25 to
 * 1.4 `get_document` parts (PART_SIZE_CHARACTERS, 20,000, "a few percent of an agent's context"). 100 items would
 * have been 2.5 parts. 50 also keeps HB 3131's 42 rows, the Measure spec #1 uses as its example, on one page. Every tool here sends the JSON as text and as structured content, so a client
 * may hold it twice.
 *
 * A page is rows and not groups, because a group can be larger than a page (SB 210's Portland under oppose has 4,431
 * rows), so a group can run across a break and is on both pages with its whole count.
 */
export const TESTIMONY_PAGE_SIZE = 50;
const PAGE_SIZE = TESTIMONY_PAGE_SIZE;

/**
 * The most sets of identical letters a page lists. A page carries the summary whatever its items, and a Measure of
 * thousands of rows can have hundreds of sets (a form letter sent by many people, once for each wording), so the
 * summary names the largest 10 and says how many it leaves out. Each item of a set carries the set's id to read and
 * its count, so no set depends on the summary.
 */
export const TESTIMONY_MAX_LISTED_LETTER_SETS = 10;
const MAX_LISTED_SETS = TESTIMONY_MAX_LISTED_LETTER_SETS;

/** The listed positions first, in their order, then any other id by number. */
function comparePositions(a: number, b: number): number {
  const rank = (id: number): number => {
    const index = listedPositions.findIndex((position) => position.id === id);
    return index === -1 ? listedPositions.length : index;
  };
  return rank(a) - rank(b) || a - b;
}

const positionCountOutput = z.object({
  position_id: z.number().describe("The feed's PositionOnMeasureId: 3983, 3982, 3981, 4022, or another number."),
  position: z
    .string()
    .describe(
      'What the id means: "support" (3983), "oppose" (3982), "neutral" (3981), "unknown" (4022). Any other id is labelled "unlisted position" and shown under its number.',
    ),
  count: z.number().describe("How many of the Measure's Testimony rows take this position."),
});

// An item carries no letter text: `get_document` serves it in parts (ADR-0011). The Session's text is about 357 M
// characters (docs/research/olis-odata.md §7), and a form letter's words would come once for each row.
const itemOutput = z.object({
  id: z.string().describe("The Testimony's id, such as testimony-2025r1-117165. Give it to get_document."),
  source_url: z.string().describe("Where the Legislature publishes the file."),
  submitter: z
    .string()
    .describe("The submitter's first and last name as OLIS has them, joined by one space, stray spaces left in."),
  behalf_of: z
    .string()
    .nullable()
    .describe(
      "Who the submitter says they speak for (OLIS's BehalfOf), as written. It often names the real organization when Organization holds a city. Null when OLIS gives none.",
    ),
  organization: z
    .string()
    .nullable()
    .describe(
      "The Organization field as written. It is free text typed by the submitter and often a city, not an organization. Null when OLIS gives none.",
    ),
  document_description: z
    .string()
    .describe('What OLIS calls the file: "Testimony", "Letter", "Report", "Photo", "MapGraphic"...'),
  committee_id: z
    .string()
    .describe("The id of the committee the Testimony was submitted to, such as committee-2025r1-halnrw."),
  committee_code: z.string().describe("The committee's code as OLIS writes it, such as HALNRW."),
  meeting_date: z.string().describe("When the committee met, in Pacific time with its UTC offset."),
  fetched: z
    .boolean()
    .describe(
      "True when this index holds the file, so get_document serves the id. False when the file is not here. While the feed lists the Testimony (a failed or not yet reached fetch), get_document answers with an error that says the index does not hold the file and, when the worker's latest attempt found it so, that the file OLIS serves for it is empty or not a readable PDF; otherwise that OLIS may serve it empty or broken, a request for it may have failed, or a pull has not reached it yet. It does not say that a later pull will fetch it. Once the row is flagged no_longer_listed, no pull will fetch the file, since the feed does not list the row, and get_document answers with an error that says so. source_url is where to read it.",
    ),
  has_text_layer: z
    .boolean()
    .nullable()
    .describe(
      "False when the file has no text to read, as with a scan or a photograph, so get_document returns empty text. Null when fetched is false.",
    ),
  same_letter_as: z
    .string()
    .nullable()
    .describe(
      "When another row of the Measure has the same text as this one: the id to read, which is id_to_read of their set (and this row's own id for the lowest row of the set), whether or not the set is one identical_letters lists. Null when no other row has the same text.",
    ),
  same_letter_count: z
    .number()
    .nullable()
    .describe(
      "How many of the Measure's rows whose files this index holds have this row's text, this row included: the size of its set, whether or not identical_letters lists the set. Null when no other row has the same text.",
    ),
  agency_id: z
    .string()
    .nullable()
    .describe(
      "The OregonAI agency registry slug of the Agency that Organization names, from the build-time snapshot. Null when Organization is not an Agency's name or alias.",
    ),
  no_longer_listed: noLongerListedOutput,
});

const identicalLetterOutput = z.object({
  id_to_read: z
    .string()
    .describe(
      "The id of the set's Testimony with the lowest CommTestId. Give it to get_document to read the letter once.",
    ),
  count: z
    .number()
    .describe(
      "How many of the Measure's Testimony rows have this letter. It counts only rows whose files this index holds: a row listed with fetched false is not counted, because nothing is known of its text until the next pull fetches it.",
    ),
});

const organizationGroupOutput = z.object({
  organization: z
    .string()
    .nullable()
    .describe(
      "The group's Organization as written, in the spelling that comes first in CommTestId order. Null for the group of rows whose Organization is empty, blank or missing: no organization given.",
    ),
  spellings: z
    .array(z.string())
    .describe(
      "Every spelling of the Organization the group holds, as written, in the order of the first row to use each. Rows whose spellings differ only in capitals or in spaces are one group. Empty for the group of rows that give no organization.",
    ),
  count: z.number().describe("How many of the Measure's rows in this position are in the group, on every page."),
  items: z.array(itemOutput).describe("The group's rows that are on this page, in CommTestId order."),
});

const positionOutput = z.object({
  position_id: z.number().describe("The feed's PositionOnMeasureId."),
  position: z.string().describe('"support", "oppose", "neutral", "unknown" or "unlisted position".'),
  count: z.number().describe("How many of the Measure's rows take this position, on every page."),
  organizations: z
    .array(organizationGroupOutput)
    .describe("The position's organization groups that have rows on this page, in alphabetical order."),
});

export const testimonyOutput = z.object({
  measure_id: z.string().describe("The Measure's id in OregonAI's form."),
  total: z
    .number()
    .describe(
      "How many Testimony rows this index holds for the Measure, from the feed it last read (see as_of), on every page. A row OLIS has stopped listing since is still counted.",
    ),
  position_counts: z
    .array(positionCountOutput)
    .describe(
      "The Measure's rows by position: the four listed positions in the order support, oppose, neutral, unknown, each with its count (0 when none), then any other position id found, in numeric order.",
    ),
  organization_groups: z
    .number()
    .describe(
      "How many organization groups the Measure's Testimony has, on every page, counting an organization once for each position it appears under.",
    ),
  identical_letters: z
    .array(identicalLetterOutput)
    .describe(
      `The largest sets of identical letters of the Measure, at most ${MAX_LISTED_SETS}, by count (the largest first) and then by the lowest CommTestId, on every page. A set is the id to read and its count. The rows stay one item each, so who testified is not lost and the counts add up to total; an item of a set says its set's id to read and count (same_letter_as, same_letter_count), so the rows of a set are found by reading the pages. Texts are compared as stored, exactly. A file with no text layer is never the same as another.`,
    ),
  identical_letters_left_out: z
    .number()
    .describe(
      "How many more sets of identical letters the Measure has than identical_letters lists: the smaller ones. Their items still say their id to read and count.",
    ),
  page: z.number().describe("Which page this is, from 1."),
  last_page: z
    .number()
    .describe(
      "The number of the last page of the Measure's Testimony: this is page N of last_page. It counts pages of this tool's results, not the pages of a PDF, which get_document counts as page_count.",
    ),
  page_size: z.number().describe("How many rows a page lists at the most."),
  positions: z
    .array(positionOutput)
    .describe(
      "This page's rows, by position in the order of position_counts, then by organization group in alphabetical order (no organization given last), then by CommTestId. A group that runs across a page break is on both pages, with the same count.",
    ),
});

export type TestimonyOutput = z.infer<typeof testimonyOutput>;

/** An unknown Measure is an expected outcome, so it is a value; the envelope tells the agent it is a tool error. */
export type TestimonyFault =
  | { kind: "unknown_measure"; reference: string; session: SessionKey }
  | { kind: "no_such_page"; measureId: MeasureId; page: number; lastPage: number };

export type TestimonyOutcome = Outcome<TestimonyOutput, TestimonyFault>;

/**
 * What makes two Organization values one group: trimmed, every run of white space one space, capitals
 * ignored. An empty result is the group of rows that give no organization.
 *
 * Organization is free text typed by the submitter and often a city (spec #1, "Further Notes"), and BehalfOf often
 * names the real organization (117167: BehalfOf "Oregon Association of Conservation Districts", Organization
 * "Portland"). Groups still go by Organization, as the ticket says, and nothing tries to tell a city from an
 * organization or to group by BehalfOf: BehalfOf is also a role or a slogan ("Self", "teachers ", "taxpayers", "Mr
 * Oregon Opposes HB 3131"), "Oregon City" is a city and "Oregon Seed Council" is not, and a list of cities would
 * still miss "Southern Oregon". A guess shown as a group is worse than a noisy field shown as it is, so BehalfOf is
 * on every item instead.
 *
 * Counted over the full 2025R1 cache on 2026-10-30 (the 16 rows that name no Measure left out), by Measure,
 * position and value: 39,651 groups by exact value, 37,252 after trimming, 34,634 after trimming and ignoring
 * capitals, and 34,625 with the white-space rule too ("Grants  Pass" is the same words as "grants pass"). The key is
 * made for each call from the values as stored, as published (ADR-0002), so changing the rule changes no stored data.
 */
function organizationKey(organization: string | null): string {
  return (organization ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Sorts the empty key, no organization given, after every organization, and the rest by code unit. */
function compareGroupKeys(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  return a < b ? -1 : 1;
}

type Item = TestimonyOutput["positions"][number]["organizations"][number]["items"][number];

function itemOf(entry: TestimonyEntry, sameLetterAs: ReadonlyMap<DocumentId, LetterSet>): Item {
  return {
    id: entry.id,
    source_url: entry.sourceUrl,
    submitter: entry.submitter,
    behalf_of: entry.behalfOf,
    organization: entry.organization,
    document_description: entry.documentDescription,
    committee_id: entry.committeeId,
    committee_code: entry.committeeCode,
    meeting_date: entry.meetingAt,
    fetched: entry.fetched,
    has_text_layer: entry.hasTextLayer,
    same_letter_as: sameLetterAs.get(entry.id)?.idToRead ?? null,
    same_letter_count: sameLetterAs.get(entry.id)?.count ?? null,
    agency_id: entry.agencyId,
    ...noLongerListedFlag(entry.listing),
  };
}

type Group = TestimonyOutput["positions"][number]["organizations"][number];
type Position = TestimonyOutput["positions"][number];

/** What a group is, whatever page its rows are on. */
type GroupFacts = { organization: string | null; spellings: string[]; count: number };

/** One row in the order the tool lists them, with the group it is in and the key the group is ordered by. */
type Placed = { entry: TestimonyEntry; groupKey: string; organizationKey: string };

/**
 * The Measure's rows in the order the pages list them: by position (the listed ones first), then by organization
 * group in alphabetical order, then by CommTestId; and the facts of each (position, group), taken over all the rows
 * so a group split across a page break says the same on both pages.
 */
function placeEntries(entries: readonly TestimonyEntry[]): { ordered: Placed[]; groups: Map<string, GroupFacts> } {
  const groups = new Map<string, GroupFacts>();
  const placed = entries.map((entry): Placed => {
    const key = organizationKey(entry.organization);
    const groupKey = `${entry.position.id} ${key}`;
    let facts = groups.get(groupKey);
    if (facts === undefined) {
      facts = { organization: key === "" ? null : entry.organization, spellings: [], count: 0 };
      groups.set(groupKey, facts);
    }
    if (entry.organization !== null && key !== "" && !facts.spellings.includes(entry.organization)) {
      facts.spellings.push(entry.organization);
    }
    facts.count += 1;
    return { entry, groupKey, organizationKey: key };
  });
  const ordered = placed.toSorted(
    (a, b) =>
      comparePositions(a.entry.position.id, b.entry.position.id) ||
      compareGroupKeys(a.organizationKey, b.organizationKey) ||
      a.entry.commTestId - b.entry.commTestId,
  );
  return { ordered, groups };
}

/** The rows of one page as positions of organization groups, each group with its facts and the rows on this page. */
function positionsOf(
  page: readonly Placed[],
  groups: ReadonlyMap<string, GroupFacts>,
  countByPosition: ReadonlyMap<number, number>,
  sameLetterAs: ReadonlyMap<DocumentId, LetterSet>,
): Position[] {
  const positions: Position[] = [];
  const groupsOnPage = new Map<string, Group>();
  for (const { entry, groupKey } of page) {
    let position = positions.at(-1);
    if (position?.position_id !== entry.position.id) {
      position = {
        position_id: entry.position.id,
        position: entry.position.label,
        count: countByPosition.get(entry.position.id) ?? 0,
        organizations: [],
      };
      positions.push(position);
    }
    let group = groupsOnPage.get(groupKey);
    if (group === undefined) {
      const facts = groups.get(groupKey);
      if (facts === undefined) throw new Error(`The group ${groupKey} of ${entry.id} has no facts`);
      group = { ...facts, spellings: [...facts.spellings], items: [] };
      groupsOnPage.set(groupKey, group);
      position.organizations.push(group);
    }
    group.items.push(itemOf(entry, sameLetterAs));
  }
  return positions;
}

type IdenticalLetter = TestimonyOutput["identical_letters"][number];

/** One text that two or more rows share: the id to read (the row with the lowest CommTestId) and how many rows. */
type LetterSet = { idToRead: DocumentId; lowestCommTestId: number; count: number };

/**
 * The sets of rows that share a text (entries are in CommTestId order, so the first of a set is the lowest), the
 * largest MAX_LISTED_SETS of them for the summary, how many the summary leaves out, and the set each row of
 * one is in. A file with no text layer is never the same as another: its empty text says nothing about what the
 * file shows.
 */
function identicalLettersOf(entries: readonly TestimonyEntry[]): {
  letters: IdenticalLetter[];
  lettersLeftOut: number;
  setOf: Map<DocumentId, LetterSet>;
} {
  const byText = new Map<string, TestimonyEntry[]>();
  for (const entry of entries) {
    if (entry.hasTextLayer !== true || entry.textHash === null) continue;
    const sharing = byText.get(entry.textHash);
    if (sharing === undefined) byText.set(entry.textHash, [entry]);
    else sharing.push(entry);
  }
  const sets: LetterSet[] = [];
  const setOf = new Map<DocumentId, LetterSet>();
  for (const sharing of byText.values()) {
    const [lowest] = sharing;
    if (lowest === undefined || sharing.length < 2) continue;
    const set: LetterSet = {
      idToRead: lowest.id,
      lowestCommTestId: lowest.commTestId,
      count: sharing.length,
    };
    sets.push(set);
    for (const entry of sharing) setOf.set(entry.id, set);
  }
  sets.sort((a, b) => b.count - a.count || a.lowestCommTestId - b.lowestCommTestId);
  const listed = sets.slice(0, MAX_LISTED_SETS);
  return {
    letters: listed.map((set) => ({ id_to_read: set.idToRead, count: set.count })),
    lettersLeftOut: sets.length - listed.length,
    setOf,
  };
}

export function testimony(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof testimonyInput>,
): TestimonyOutcome {
  const key = parseMeasureReference(input.measure, session);
  if (key === undefined || reader.findMeasure(key) === undefined) {
    return { kind: "fault", fault: { kind: "unknown_measure", reference: input.measure, session } };
  }
  const entries = reader.findTestimony(key);
  const lastPage = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const page = input.page ?? 1;
  const measureId = measureIdOf(key);
  if (page > lastPage) return { kind: "fault", fault: { kind: "no_such_page", measureId, page, lastPage } };
  const identical = identicalLettersOf(entries);
  const { ordered, groups } = placeEntries(entries);
  const countByPosition = new Map<number, number>();
  for (const entry of entries)
    countByPosition.set(entry.position.id, (countByPosition.get(entry.position.id) ?? 0) + 1);
  return {
    kind: "answer",
    answer: {
      measure_id: measureId,
      total: entries.length,
      position_counts: [...new Set([...listedPositions.map((position) => position.id), ...countByPosition.keys()])]
        .sort(comparePositions)
        .map((id) => ({ position_id: id, position: positionOf(id).label, count: countByPosition.get(id) ?? 0 })),
      organization_groups: groups.size,
      identical_letters: identical.letters,
      identical_letters_left_out: identical.lettersLeftOut,
      page,
      last_page: lastPage,
      page_size: PAGE_SIZE,
      positions: positionsOf(
        ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        groups,
        countByPosition,
        identical.setOf,
      ),
    },
  };
}

/** What an agent is told when a call to testimony is a fault. */
export function testimonyFaultMessage(fault: TestimonyFault): string {
  switch (fault.kind) {
    case "unknown_measure":
      return unknownMeasureMessage(fault.reference, fault.session);
    case "no_such_page":
      return noSuchPageMessage(fault.measureId, fault.page, fault.lastPage);
    default:
      return fault satisfies never;
  }
}

/** What an agent is told when it asks for a page past the last one. */
function noSuchPageMessage(measureId: MeasureId, page: number, lastPage: number): string {
  const pages = lastPage === 1 ? "1 page" : `${lastPage} pages`;
  return `The Testimony on ${measureId} has ${pages}, so there is no page ${page}. Ask for a page from 1 to ${lastPage}.`;
}
