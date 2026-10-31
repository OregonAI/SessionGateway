// `find_measures` (ticket #16, spec #1 acceptance question (a), stories 30 to 32): the Measures, Versions and Proposed
// Amendments that an Agency Link or a Statute Link ties to an Agency, optionally only the ones posted since a time.
import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { agencyEvidenceKinds, type LinkedNode, type StoredStatuteLinked } from "#/packages/domain/agency-links.ts";
import { parseAmendmentNumber, type AmendmentId, type DocumentId } from "#/packages/domain/documents.ts";
import { citationOfMeasureId, measureIdOf, parseMeasureReference, type SessionKey } from "#/packages/domain/index.ts";
import {
  parseAgencyId,
  parseOrsChapterReference,
  parseOrsSectionReference,
  type AgencyId,
  type OrsChapterId,
  type OrsSectionId,
} from "#/packages/domain/oregonai.ts";
import { compareMeasureSections, statuteLinkKinds } from "#/packages/domain/statute-links.ts";
import { compareTimestamps, readTimestamp, type Timestamp } from "#/packages/time/pacific.ts";
import { compareLinks, evidenceOutput, evidenceShown, gatherRepeats, type GatheredLink } from "./agency-links.ts";
import { NON_OFFICIAL_NOTICE } from "./get-measure.ts";
import { noLongerListedFlag, noLongerListedOutput } from "./listing.ts";

/**
 * How many items one page lists, across the groups (the ticket asks for pages of 50, as `testimony` has). Measured
 * 2026-10-30 through the tool over the whole fixture: an item is 650 to 900 characters of JSON with its evidence (the
 * Bureau of Labor and Industries' 12 items are 10,648 characters, the Department of Human Services' 20 are 13,366), so a
 * full page is about 33,000 to 45,000 characters, between one and a half and two parts of `get_document`
 * (20,000 each) and more than a page of `testimony` (about 25,000). The Session is some 100 times the fixture, so an
 * Agency with thousands of items is likely and the answer has to be paged.
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

/**
 * An item's evidence: an Agency Link's (agency-links.ts), or for an ORS section or chapter a Statute Link to it, with the
 * kind of the link, the target it points at and the measure sections it is read in.
 */
const findEvidenceOutput = evidenceOutput.extend({
  kind: z
    .enum(groupKinds)
    .describe(
      'Why the item is here. For an Agency: "derived", "fiscal-impact-statement", "named-in-text" or "testimony" (see the groups). For an ORS section or chapter: "statute-link".',
    ),
  link_kind: z
    .enum(statuteLinkKinds)
    .optional()
    .describe('For "statute-link": what the link does to its target: amends, repeals, adds-to or cites.'),
  target_id: z
    .string()
    .optional()
    .describe(
      'For "statute-link": the ORS section (ors-653.616) or chapter (ors-chapter-657b) the link points at. OregonAI has no page for a chapter.',
    ),
  measure_sections: z
    .array(z.string().nullable())
    .optional()
    .describe(
      'For "statute-link": the measure sections the link is read in, as the text prints them, in order; null when the text has no numbered sections.',
    ),
});

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
  evidence: z.array(findEvidenceOutput).describe(`The item's evidence, at most ${MAX_EVIDENCE}.`),
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
/** An item as the tool builds it: the times are Timestamps, which the answer carries as text. */
type Item = Omit<z.infer<typeof itemOutput>, "posted_at" | "last_posted_at"> & {
  posted_at: Timestamp | null;
  last_posted_at: Timestamp | null;
};

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

const numbersInOrder = new Intl.Collator("en", { numeric: true });

type Evidence = z.infer<typeof findEvidenceOutput>;

/** What to call a node: "SB 69", "SB 69 A-Engrossed", "SB 69-2". */
function titleOf(node: LinkedNode): string {
  const citation = citationOfMeasureId(measureIdOf(node.measure));
  if (node.label === null) return citation;
  if (node.type === "version") return `${citation} ${node.label}`;
  const number = parseAmendmentNumber(node.label);
  return number === undefined
    ? `${citation} ${node.label.trim()}`
    : `${citation}-${number.letter ?? ""}${number.digits}`;
}

/** What makes one node an item: the evidence, in its order, and the times at which the documents that hold it were created. */
type Candidate = { node: LinkedNode; evidence: Evidence[]; times: Timestamp[] };

/**
 * The Agency Links of one kind, gathered by the node they sit on. A link is dated by the postings whose own file gives
 * it (`gatherRepeats`): the Version's or statement's or Testimony's own row, or each posting of a Proposed Amendment
 * that reads the same. A posting of a different file never dates it.
 */
function candidatesOfLinks(links: readonly GatheredLink[]): Candidate[] {
  const byNode = new Map<string, { node: LinkedNode; links: GatheredLink[] }>();
  for (const gathered of links.toSorted((a, b) => compareLinks(a.link, b.link))) {
    const own = byNode.get(gathered.link.node.id) ?? { node: gathered.link.node, links: [] };
    own.links.push(gathered);
    byNode.set(gathered.link.node.id, own);
  }
  return [...byNode.values()].map(({ node, links: own }) => ({
    node,
    evidence: own.map(({ link }) => evidenceShown(link)),
    times: own.flatMap(({ createdAt }) => createdAt),
  }));
}

/**
 * The Statute Links to a section or chapter, gathered by the Version or Proposed Amendment they were read from. Each
 * target is one piece of evidence under its kind, with every measure section it is linked in (a Proposed Amendment posted
 * to several meetings is one item, and postings that say the same add nothing). The document named is the first, in the
 * order of the feed's numbers. The item is dated by the documents whose file holds a link to the target: a posting of
 * another file does not date it (#16 F2).
 */
function candidatesOfStatuteLinks(stored: readonly StoredStatuteLinked[]): Candidate[] {
  type Entry = { evidence: Evidence; sections: (string | null)[] };
  const byNode = new Map<string, { node: LinkedNode; entries: Map<string, Entry>; times: Map<string, Timestamp> }>();
  for (const found of stored.toSorted((a, b) => numbersInOrder.compare(a.document.id, b.document.id))) {
    const gathered = byNode.get(found.node.id) ?? {
      node: found.node,
      entries: new Map<string, Entry>(),
      times: new Map<string, Timestamp>(),
    };
    if (found.document.createdAt !== null) gathered.times.set(found.document.id, found.document.createdAt);
    const key = `${found.link.kind} ${found.link.target.id}`;
    const entry = gathered.entries.get(key) ?? {
      evidence: {
        kind: "statute-link",
        document_id: found.document.id,
        source_url: found.document.sourceUrl,
        link_kind: found.link.kind,
        target_id: found.link.target.id,
        measure_sections: [],
      },
      sections: [],
    };
    if (!entry.sections.includes(found.link.measureSection)) entry.sections.push(found.link.measureSection);
    gathered.entries.set(key, entry);
    byNode.set(found.node.id, gathered);
  }
  return [...byNode.values()].map(({ node, entries, times }) => ({
    node,
    evidence: [...entries.values()]
      .toSorted(
        (a, b) =>
          statuteLinkKinds.indexOf(a.evidence.link_kind ?? "cites") -
            statuteLinkKinds.indexOf(b.evidence.link_kind ?? "cites") ||
          numbersInOrder.compare(a.evidence.target_id ?? "", b.evidence.target_id ?? ""),
      )
      .map(({ evidence, sections }) => ({
        ...evidence,
        measure_sections: sections.toSorted(compareMeasureSections),
      })),
    times: [...times.values()],
  }));
}

function itemOf(candidate: Candidate): Item {
  const ordered = candidate.times.toSorted(compareTimestamps);
  return {
    id: candidate.node.id,
    type: candidate.node.type,
    title: titleOf(candidate.node),
    measure_id: measureIdOf(candidate.node.measure),
    source_url: candidate.node.sourceUrl,
    posted_at: ordered[0] ?? null,
    last_posted_at: ordered.at(-1) ?? null,
    evidence_total: candidate.evidence.length,
    evidence: candidate.evidence.slice(0, MAX_EVIDENCE),
  };
}

/** The most recently posted first (an item with no time last), then by id as the feed numbers it. */
function compareItems(a: Item, b: Item): number {
  if (a.last_posted_at === null || b.last_posted_at === null) {
    if (a.last_posted_at !== b.last_posted_at) return a.last_posted_at === null ? 1 : -1;
    return numbersInOrder.compare(a.id, b.id);
  }
  return compareTimestamps(b.last_posted_at, a.last_posted_at) || numbersInOrder.compare(a.id, b.id);
}

type Group = { kind: GroupKind; items: Item[] };

/** The items of a group that were posted at or after `since`, newest first. With no `since`, all of them. */
function groupOfCandidates(kind: GroupKind, candidates: readonly Candidate[], since: Timestamp | undefined): Group {
  return {
    kind,
    items: candidates
      .map(itemOf)
      .filter(
        (item) =>
          since === undefined || (item.last_posted_at !== null && compareTimestamps(item.last_posted_at, since) >= 0),
      )
      .toSorted(compareItems),
  };
}

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

/** What a call asks about: exactly one of an Agency, an ORS section and an ORS chapter, or why the call cannot be met. */
type Target =
  | { kind: "agency"; id: AgencyId }
  | { kind: "section"; id: OrsSectionId }
  | { kind: "chapter"; id: OrsChapterId }
  | { kind: "bad_request"; message: string };

function targetOf(input: z.infer<typeof findMeasuresInput>): Target {
  const given = [input.agency, input.ors_section, input.ors_chapter].filter((value) => value !== undefined);
  if (given.length !== 1) {
    return { kind: "bad_request", message: "Give exactly one of agency, ors_section and ors_chapter." };
  }
  if (input.agency !== undefined) {
    const id = parseAgencyId(input.agency.trim());
    return id === undefined
      ? {
          kind: "bad_request",
          message: `"${input.agency}" is not an Agency id. Give an OregonAI agency registry slug such as bureau-of-labor-and-industries.`,
        }
      : { kind: "agency", id };
  }
  if (input.ors_section !== undefined) {
    const id = parseOrsSectionReference(input.ors_section);
    return id === undefined
      ? {
          kind: "bad_request",
          message: `"${input.ors_section}" is not an ORS section. Give a citation such as ORS 653.616 or an id such as ors-653.616.`,
        }
      : { kind: "section", id };
  }
  const id = input.ors_chapter === undefined ? undefined : parseOrsChapterReference(input.ors_chapter);
  return id === undefined
    ? {
        kind: "bad_request",
        message: `"${input.ors_chapter ?? ""}" is not an ORS chapter. Give a citation such as ORS chapter 657B or an id such as ors-chapter-657b.`,
      }
    : { kind: "chapter", id };
}

export function findMeasures(
  reader: IndexReader,
  session: SessionKey,
  input: z.infer<typeof findMeasuresInput>,
): FindMeasuresResult {
  const asOf = reader.asOf(session);
  if (asOf === undefined) throw new Error(`The index holds no completed full pull of ${session} to date it by`);
  const target = targetOf(input);
  if (target.kind === "bad_request") return target;
  const since = input.since === undefined ? undefined : readTimestamp(input.since);
  if (input.since !== undefined && since === undefined) {
    return {
      kind: "bad_request",
      message: `"${input.since}" is not a time. Give a date such as 2025-01-23 or a time such as 2025-01-23T16:00:00 (Pacific) or 2025-01-24T00:00:00Z.`,
    };
  }
  let groups: Group[];
  const notes: string[] = [];
  switch (target.kind) {
    case "agency": {
      const stored = gatherRepeats(reader.findAgencyLinks(session, { agency: target.id }));
      groups = agencyEvidenceKinds.map((kind) =>
        groupOfCandidates(kind, candidatesOfLinks(stored.filter(({ link }) => link.evidence.kind === kind)), since),
      );
      if (stored.length === 0) {
        notes.push(
          `The index holds no Agency Link to ${target.id}. Check the slug against the OregonAI agency registry.`,
        );
      }
      break;
    }
    case "section":
    case "chapter": {
      const stored = reader.findStatuteLinked(session, target.id);
      groups = [groupOfCandidates("statute-link", candidatesOfStatuteLinks(stored), since)];
      if (stored.length === 0) notes.push(`The index holds no Statute Link to ${target.id}.`);
      break;
    }
    default:
      return target satisfies never;
  }
  const page = input.page ?? 1;
  const paged = pageOf(groups, page, (item) => itemListed(reader, session, item));
  const lastPage = Math.max(1, Math.ceil(paged.total / PAGE_SIZE));
  if (page > lastPage) return { kind: "no_such_page", page, lastPage };
  return {
    kind: "found",
    found: {
      query: {
        agency: target.kind === "agency" ? target.id : null,
        ors_section: target.kind === "section" ? target.id : null,
        ors_chapter: target.kind === "chapter" ? target.id : null,
        since: since ?? null,
      },
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
