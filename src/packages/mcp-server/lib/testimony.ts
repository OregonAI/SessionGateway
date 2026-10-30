import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import type { DocumentId, TestimonyEntry } from "#/packages/domain/documents.ts";
import { measureIdOf, parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";

export const testimonyInput = z.object({
  measure: z.string().describe('A Measure\'s id, such as "measure-2025r1-hb3131", or its citation, such as "HB 3131".'),
});

/**
 * The positions a Testimony row can take, by the feed's `PositionOnMeasureId` (docs/research/olis-odata.md
 * gotcha 3), in the order the tool lists them. An id not listed here is shown under its number.
 */
const listedPositions = [
  { id: 3983, label: "support" },
  { id: 3982, label: "oppose" },
  { id: 3981, label: "neutral" },
  { id: 4022, label: "unknown" },
] as const;

const UNLISTED_POSITION_LABEL = "unlisted position";

/**
 * The most ids one set of identical letters lists. A form letter can run to hundreds of rows on one Measure,
 * and the set is on every page.
 */
const MAX_LISTED_IDS = 100;

function positionLabelOf(id: number): string {
  return listedPositions.find((position) => position.id === id)?.label ?? UNLISTED_POSITION_LABEL;
}

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
      "True when this index holds the file, so get_document serves the id. False when OLIS lists the Testimony but the file is not here yet (a failed or not yet reached fetch): source_url is where to read it.",
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
      "The id to read (id_to_read of an entry of identical_letters) when this row's letter is the same text as another row's of the Measure, this row's own id included when it is the lowest. Null when no other row has the same text.",
    ),
  agency_id: z
    .string()
    .nullable()
    .describe(
      "The OregonAI agency registry slug of the Agency that Organization names, from the build-time snapshot. Null when Organization is not an Agency's name or alias.",
    ),
});

const identicalLetterOutput = z.object({
  id_to_read: z
    .string()
    .describe(
      "The id of the set's Testimony with the lowest CommTestId. Give it to get_document to read the letter once.",
    ),
  count: z.number().describe("How many of the Measure's Testimony rows have this letter."),
  ids: z
    .array(z.string())
    .describe(`The ids of the rows that have it, lowest CommTestId first, at most the first ${MAX_LISTED_IDS}.`),
  ids_left_out: z.number().describe("How many of the rows are not in ids: count minus the ids listed."),
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
      "Every spelling of the Organization the group holds, as written, in the order of the first row to use each. Rows whose spellings differ only in capitals or in spaces are one group.",
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
  total: z.number().describe("How many Testimony rows OLIS lists for the Measure, on every page."),
  position_counts: z
    .array(positionCountOutput)
    .describe(
      "The Measure's rows by position: the four listed positions in the order support, oppose, neutral, unknown, each with its count (0 when none), then any other position id found, in numeric order.",
    ),
  identical_letters: z
    .array(identicalLetterOutput)
    .describe(
      "Each text that two or more of the Measure's rows share, listed once, on every page. The rows stay one item each, so who testified is not lost and the counts add up to total. Texts are compared as stored, exactly. A file with no text layer is never the same as another.",
    ),
  positions: z
    .array(positionOutput)
    .describe("The rows on this page, by position in the order of position_counts, then by organization."),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type TestimonyOutput = z.infer<typeof testimonyOutput>;

/** An unknown Measure is an expected outcome, so it is a value; the MCP edge decides it is a tool error. */
export type TestimonyResult =
  { kind: "found"; testimony: TestimonyOutput } | { kind: "unknown_measure"; reference: string; session: SessionKey };

/**
 * What makes two Organization values one group: trimmed, every run of white space one space, capitals
 * ignored. An empty result is the group of rows that give no organization.
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

function itemOf(entry: TestimonyEntry, sameLetterAs: ReadonlyMap<DocumentId, DocumentId>): Item {
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
    same_letter_as: sameLetterAs.get(entry.id) ?? null,
    agency_id: entry.agencyId,
  };
}

type Group = TestimonyOutput["positions"][number]["organizations"][number];

/** The entries of one position (already in CommTestId order) as organization groups, in alphabetical order. */
function groupsOf(entries: readonly TestimonyEntry[], sameLetterAs: ReadonlyMap<DocumentId, DocumentId>): Group[] {
  const byKey = new Map<string, Group>();
  for (const entry of entries) {
    const key = organizationKey(entry.organization);
    let group = byKey.get(key);
    if (group === undefined) {
      group = { organization: key === "" ? null : entry.organization, spellings: [], count: 0, items: [] };
      byKey.set(key, group);
    }
    if (entry.organization !== null && key !== "" && !group.spellings.includes(entry.organization)) {
      group.spellings.push(entry.organization);
    }
    group.count += 1;
    group.items.push(itemOf(entry, sameLetterAs));
  }
  return [...byKey.entries()].sort(([a], [b]) => compareGroupKeys(a, b)).map(([, group]) => group);
}

type IdenticalLetter = TestimonyOutput["identical_letters"][number];

/**
 * The texts two or more of the rows share (entries are in CommTestId order, so the first of a set is the
 * lowest), and which set each row of one is in. A file with no text layer is never the same as another: its
 * empty text says nothing about what the file shows.
 */
function identicalLettersOf(entries: readonly TestimonyEntry[]): {
  letters: IdenticalLetter[];
  sameLetterAs: Map<DocumentId, DocumentId>;
} {
  const byText = new Map<string, DocumentId[]>();
  for (const entry of entries) {
    if (entry.hasTextLayer !== true || entry.textHash === null) continue;
    byText.set(entry.textHash, [...(byText.get(entry.textHash) ?? []), entry.id]);
  }
  const letters: IdenticalLetter[] = [];
  const sameLetterAs = new Map<DocumentId, DocumentId>();
  for (const ids of byText.values()) {
    const [idToRead] = ids;
    if (idToRead === undefined || ids.length < 2) continue;
    for (const id of ids) sameLetterAs.set(id, idToRead);
    const listed = ids.slice(0, MAX_LISTED_IDS);
    letters.push({ id_to_read: idToRead, count: ids.length, ids: listed, ids_left_out: ids.length - listed.length });
  }
  return { letters, sameLetterAs };
}

export function testimony(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof testimonyInput>,
): TestimonyResult {
  const key = parseMeasureReference(input.measure, session);
  if (key === undefined || reader.findMeasure(key) === undefined) {
    return { kind: "unknown_measure", reference: input.measure, session };
  }
  const asOf = reader.asOf(session);
  if (asOf === undefined) {
    throw new Error(`The index holds Testimony of ${session} but no completed full pull to date it by`);
  }
  const entries = reader.findTestimony(key);
  const identical = identicalLettersOf(entries);
  const countByPosition = new Map<number, number>();
  for (const entry of entries) countByPosition.set(entry.positionId, (countByPosition.get(entry.positionId) ?? 0) + 1);
  return {
    kind: "found",
    testimony: {
      measure_id: measureIdOf(key),
      total: entries.length,
      position_counts: [...new Set([...listedPositions.map((position) => position.id), ...countByPosition.keys()])]
        .sort(comparePositions)
        .map((id) => ({ position_id: id, position: positionLabelOf(id), count: countByPosition.get(id) ?? 0 })),
      identical_letters: identical.letters,
      positions: [...countByPosition.keys()].sort(comparePositions).map((id) => ({
        position_id: id,
        position: positionLabelOf(id),
        count: countByPosition.get(id) ?? 0,
        organizations: groupsOf(
          entries.filter((entry) => entry.positionId === id),
          identical.sameLetterAs,
        ),
      })),
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}
