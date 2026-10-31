// `find_measures` (ticket #16, spec #1 acceptance question (a), stories 30 to 32): the Measures, Versions and Proposed
// Amendments that an Agency Link or a Statute Link ties to an Agency, optionally only the ones posted since a time.
import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { agencyEvidenceKinds, type LinkedNode, type StoredAgencyLink } from "#/packages/domain/agency-links.ts";
import { parseAmendmentNumber, type AmendmentId, type DocumentId } from "#/packages/domain/documents.ts";
import {
  citationOfMeasureId,
  parseMeasureReference,
  type MeasureId,
  type SessionKey,
} from "#/packages/domain/index.ts";
import { parseAgencyId } from "#/packages/domain/oregonai.ts";
import { atPacificLocalTime, type Timestamp } from "#/packages/time/pacific.ts";
import { compareLinks, evidenceOutput, evidenceShown, withoutRepeats } from "./agency-links.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";
import { noLongerListedFlag, noLongerListedOutput } from "./listing.ts";

/**
 * How many items one page lists, across the groups. An item is about 600 characters with its evidence, so a page is
 * about 30,000 characters, the size of one page of `testimony` (which lists 50 rows) and a part and a half of
 * `get_document`. The Agency with the most Agency Links in the 2025R1 fixture is the Department of Human Services, with
 * 30 or so; the Session is some 100 times the fixture, so an Agency with a thousand items is likely, and the answer must
 * not be one that overflows an agent's context.
 */
export const FIND_MEASURES_PAGE_SIZE = 50;
const PAGE_SIZE = FIND_MEASURES_PAGE_SIZE;

/**
 * How many pieces of evidence an item lists. A Measure can have dozens of Testimony from one Agency, and a long Version
 * reaches many chapters; the item says how many there are in `evidence_total`.
 */
export const FIND_MEASURES_MAX_EVIDENCE = 10;
const MAX_EVIDENCE = FIND_MEASURES_MAX_EVIDENCE;

export const findMeasuresInput = z.object({
  agency: z
    .string()
    .optional()
    .describe(
      'An Agency\'s slug in the OregonAI agency registry, such as "bureau-of-labor-and-industries". Give exactly one of agency, ors_section and ors_chapter.',
    ),
  ors_section: z
    .string()
    .optional()
    .describe(
      'An ORS section: "ORS 653.616" or OregonAI\'s id "ors-653.616". Give exactly one of agency, ors_section and ors_chapter.',
    ),
  ors_chapter: z
    .string()
    .optional()
    .describe(
      'An ORS chapter: "ORS chapter 657B" or the id "ors-chapter-657b". Matches Statute Links to the chapter and to any section in it. Give exactly one of agency, ors_section and ors_chapter.',
    ),
  since: z
    .string()
    .optional()
    .describe(
      'Only items posted at or after this time: a date ("2025-01-23", midnight Pacific) or a time ("2025-01-23T16:00:00"), read as Pacific time when it has no UTC offset, or with one ("2025-01-24T00:00:00Z").',
    ),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Which page of ${PAGE_SIZE} items to return, from 1. The first by default.`),
});

const groupKinds = [...agencyEvidenceKinds, "statute-link"] as const;
type GroupKind = (typeof groupKinds)[number];

const itemOutput = z.object({
  id: z
    .string()
    .describe(
      "The Measure's id (give it to get_measure), the Version's id (give it to get_document), or the Proposed Amendment's id (give it to compare_amendment or get_document).",
    ),
  type: z.enum(["measure", "version", "proposed_amendment"]).describe("What the item is."),
  title: z.string().describe('What to call it: "SB 69", "SB 69 A-Engrossed", "SB 69-2".'),
  measure_id: z.string().describe("The id of the Measure it is, or belongs to."),
  source_url: z
    .string()
    .describe(
      "Where the Legislature publishes it: the Measure's OLIS page, the Version's file, or the file get_document serves for the Proposed Amendment (its latest posting).",
    ),
  no_longer_listed: noLongerListedOutput,
  posted_at: z
    .string()
    .nullable()
    .describe(
      "When OLIS first posted what makes the item match, in Pacific time with its UTC offset: the row of the Version, the earliest posting of the Proposed Amendment, the row of the Fiscal Impact Statement or of the Testimony. Null when the feed gives no time.",
    ),
  last_posted_at: z
    .string()
    .nullable()
    .describe(
      "When OLIS last posted it. It is posted_at, except for a Proposed Amendment posted to more than one meeting: the latest posting. since is compared with this.",
    ),
  evidence_total: z
    .number()
    .int()
    .describe("How many pieces of evidence the item has, of which evidence lists the first ones."),
  evidence: z.array(evidenceOutput).describe(`The item's evidence, at most ${MAX_EVIDENCE}.`),
});

const groupOutput = z.object({
  evidence_kind: z
    .enum(groupKinds)
    .describe(
      "What ties the items to the Agency. For an Agency: derived, fiscal-impact-statement, named-in-text, testimony. For an ORS section or chapter: statute-link.",
    ),
  description: z.string().describe("The group in words."),
  total: z.number().int().describe("How many items the group has, on every page."),
  items: z.array(itemOutput).describe("The group's items that are on this page, the most recently posted first."),
});

export const findMeasuresOutput = z.object({
  query: z
    .object({
      agency: z.string().nullable(),
      ors_section: z.string().nullable(),
      ors_chapter: z.string().nullable(),
      since: z.string().nullable().describe("The time asked for, in Pacific time with its UTC offset."),
    })
    .describe("What was asked, as the tool read it."),
  total: z.number().int().describe("How many items the groups have between them, on every page."),
  page: z.number().int().describe("Which page this is, from 1."),
  last_page: z.number().int().describe("The number of the last page."),
  page_size: z.number().int().describe("How many items a page lists at the most."),
  groups: z
    .array(groupOutput)
    .describe(
      "The items by what ties them to the Agency, in a fixed order. An item is in a group for each way it is tied, so one Version can be in more than one.",
    ),
  notes: z.array(z.string()).describe("What the answer has nothing for, in words. Empty when there is nothing to say."),
  as_of: z.string().describe("When the index was last refreshed, in Pacific time with its UTC offset."),
  notice: z.string().describe("A reminder that this is not the official record."),
});

export type FindMeasuresOutput = z.infer<typeof findMeasuresOutput>;
type Item = z.infer<typeof itemOutput>;

/** Why a call cannot be met, or the answer. Expected outcomes are values; the MCP edge decides they are tool errors. */
export type FindMeasuresResult =
  | { kind: "found"; found: FindMeasuresOutput }
  | { kind: "bad_request"; message: string }
  | { kind: "no_such_page"; page: number; lastPage: number };

const groupDescriptions: Record<GroupKind, string> = {
  derived:
    "Touch the Agency's statutes: a Statute Link of the item amends, repeals or adds to an ORS section or chapter whose rules the Agency implements. A citation does not count.",
  "fiscal-impact-statement":
    "Name the Agency in a Fiscal Impact Statement, under Government Unit(s) Affected: the Version the statement is of, or the Measure when the Legislature's label places it on no Version.",
  "named-in-text": "Name the Agency, or one of its aliases, in their text.",
  testimony: "Have Testimony whose Organization is the Agency's name or alias.",
  "statute-link": "Have a Statute Link to the ORS section or chapter.",
};

/** The instant a Timestamp is, in milliseconds. A Timestamp always has its offset. */
function msOf(at: string): number {
  return Temporal.Instant.from(at).epochMilliseconds;
}

/**
 * Reads `since`: a date (midnight Pacific), a time with no offset (Pacific), or a time with an offset or "Z". Undefined
 * when it is none of these.
 */
export function readSince(text: string): Timestamp | undefined {
  const trimmed = text.trim();
  try {
    // A time with an offset names an instant; it is written back in Pacific time.
    if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
      return Temporal.Instant.from(trimmed).toZonedDateTimeISO("America/Los_Angeles").toString({
        timeZoneName: "never",
      }) as Timestamp;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed))
      return atPacificLocalTime(Temporal.PlainDate.from(trimmed).toPlainDateTime());
    return atPacificLocalTime(Temporal.PlainDateTime.from(trimmed));
  } catch {
    return undefined;
  }
}

const numbersInOrder = new Intl.Collator("en", { numeric: true });

/** What to call a node: "SB 69", "SB 69 A-Engrossed", "SB 69-2". */
function titleOf(node: LinkedNode, measureId: MeasureId): string {
  const citation = citationOfMeasureId(measureId);
  if (node.label === null) return citation;
  if (node.type === "version") return `${citation} ${node.label}`;
  const number = parseAmendmentNumber(node.label);
  return number === undefined
    ? `${citation} ${node.label.trim()}`
    : `${citation}-${number.letter ?? ""}${number.digits}`;
}

/** The times, in milliseconds, at which what makes a link was posted: the node's rows, or the evidence's own document. */
function postedTimesOf(link: StoredAgencyLink): Timestamp[] {
  switch (link.evidence.kind) {
    case "derived":
    case "named-in-text":
      return link.node.createdAt;
    case "fiscal-impact-statement":
    case "testimony":
      return link.document.createdAt === null ? [] : [link.document.createdAt];
    default:
      return link.evidence satisfies never;
  }
}

type Collected = { node: LinkedNode; links: StoredAgencyLink[]; times: Timestamp[] };

/** The links of one kind, gathered by node: the items of a group, before they are limited by `since`. */
function collectItems(links: readonly StoredAgencyLink[]): Collected[] {
  const byNode = new Map<string, Collected>();
  for (const link of links.toSorted(compareLinks)) {
    const collected = byNode.get(link.node.id) ?? { node: link.node, links: [], times: [] };
    collected.links.push(link);
    collected.times.push(...postedTimesOf(link));
    byNode.set(link.node.id, collected);
  }
  return [...byNode.values()];
}

function itemOf(collected: Collected): Item {
  const ordered = collected.times.toSorted((a, b) => msOf(a) - msOf(b));
  const measureId = collected.node.id.startsWith("measure-")
    ? (collected.node.id as MeasureId)
    : (`measure-${collected.node.measure.session.toLowerCase()}-${collected.node.measure.prefix.toLowerCase()}${collected.node.measure.number}` as MeasureId);
  return {
    id: collected.node.id,
    type: collected.node.type,
    title: titleOf(collected.node, measureId),
    measure_id: measureId,
    source_url: collected.node.sourceUrl,
    posted_at: ordered[0] ?? null,
    last_posted_at: ordered.at(-1) ?? null,
    evidence_total: collected.links.length,
    evidence: collected.links.slice(0, MAX_EVIDENCE).map(evidenceShown),
  };
}

/** The most recently posted first (an item with no time last), then by id as the feed numbers it. */
function compareItems(a: Item, b: Item): number {
  if (a.last_posted_at === null || b.last_posted_at === null) {
    if (a.last_posted_at !== b.last_posted_at) return a.last_posted_at === null ? 1 : -1;
  } else if (a.last_posted_at !== b.last_posted_at) {
    return msOf(b.last_posted_at) - msOf(a.last_posted_at) || (a.last_posted_at < b.last_posted_at ? 1 : -1);
  }
  return numbersInOrder.compare(a.id, b.id);
}

type Group = { kind: GroupKind; items: Item[] };

/**
 * Whether the feed still lists an item's own row (ADR-0030): the Measure's, the Version's, or any posting of the Proposed
 * Amendment's. A row no complete pull has listed reads as listed. An item whose row is no longer listed stays in its
 * groups, flagged, as the tools that list rows keep such a row.
 */
function itemListed(reader: IndexReader, session: SessionKey, item: Pick<Item, "id" | "type">): boolean {
  switch (item.type) {
    case "measure": {
      const key = parseMeasureReference(item.id, session);
      if (key === undefined) throw new Error(`The item ${item.id} is no Measure of ${session}`);
      return reader.measureListing(key).listed;
    }
    case "version":
      return reader.findNoLongerListed(item.id as DocumentId) === undefined;
    case "proposed_amendment":
      return reader.findNoLongerListed(item.id as AmendmentId) === undefined;
    default:
      return item.type satisfies never;
  }
}

/**
 * Cuts the groups to one page of items counted across them in order, keeping each group's total. An item of the page
 * whose own row the feed no longer lists is flagged (`listed`).
 */
function pageOf(
  groups: readonly Group[],
  page: number,
  listed: (item: Item) => boolean,
): { groups: FindMeasuresOutput["groups"]; total: number } {
  const first = (page - 1) * PAGE_SIZE;
  let before = 0;
  return {
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
    groups: groups.map((group) => {
      const start = Math.max(0, first - before);
      const end = Math.max(0, first + PAGE_SIZE - before);
      before += group.items.length;
      return {
        evidence_kind: group.kind,
        description: groupDescriptions[group.kind],
        total: group.items.length,
        items: group.items.slice(start, end).map((item) => ({ ...item, ...noLongerListedFlag(listed(item)) })),
      };
    }),
  };
}

export function findMeasures(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof findMeasuresInput>,
): FindMeasuresResult {
  const asOf = reader.asOf(session);
  if (asOf === undefined) throw new Error(`The index holds no completed full pull of ${session} to date it by`);
  const given = [input.agency, input.ors_section, input.ors_chapter].filter((value) => value !== undefined);
  if (given.length !== 1 || input.agency === undefined) {
    return { kind: "bad_request", message: "Give exactly one of agency, ors_section and ors_chapter." };
  }
  const agency = parseAgencyId(input.agency.trim());
  if (agency === undefined) {
    return {
      kind: "bad_request",
      message: `"${input.agency}" is not an Agency id. Give an OregonAI agency registry slug such as bureau-of-labor-and-industries.`,
    };
  }
  const since = input.since === undefined ? undefined : readSince(input.since);
  if (input.since !== undefined && since === undefined) {
    return {
      kind: "bad_request",
      message: `"${input.since}" is not a time. Give a date such as 2025-01-23 or a time such as 2025-01-23T16:00:00 (Pacific) or 2025-01-24T00:00:00Z.`,
    };
  }
  const stored = withoutRepeats(reader.findAgencyLinks(session, { agency }));
  const groups: Group[] = agencyEvidenceKinds.map((kind) => ({
    kind,
    items: collectItems(stored.filter((link) => link.evidence.kind === kind))
      .map(itemOf)
      .filter(
        (item) => since === undefined || (item.last_posted_at !== null && msOf(item.last_posted_at) >= msOf(since)),
      )
      .toSorted(compareItems),
  }));
  const paged = pageOf(groups, input.page ?? 1, (item) => itemListed(reader, session, item));
  const lastPage = Math.max(1, Math.ceil(paged.total / PAGE_SIZE));
  const page = input.page ?? 1;
  if (page > lastPage) return { kind: "no_such_page", page, lastPage };
  const notes =
    stored.length === 0
      ? [`The index holds no Agency Link to ${agency}. Check the slug against the OregonAI agency registry.`]
      : [];
  return {
    kind: "found",
    found: {
      query: { agency: input.agency.trim(), ors_section: null, ors_chapter: null, since: since ?? null },
      total: paged.total,
      page,
      last_page: lastPage,
      page_size: PAGE_SIZE,
      groups: paged.groups,
      notes,
      as_of: asOf,
      notice: NON_OFFICIAL_NOTICE,
    },
  };
}

/** What an agent is told when it asks for a page past the last one. */
export function noSuchPageMessage(page: number, lastPage: number): string {
  const pages = lastPage === 1 ? "1 page" : `${lastPage} pages`;
  return `The answer has ${pages}, so there is no page ${page}. Ask for a page from 1 to ${lastPage}.`;
}
