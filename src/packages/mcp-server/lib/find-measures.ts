// `find_measures` (ticket #16, spec #1 acceptance question (a), stories 30 to 32): the Measures, Versions and Proposed
// Amendments that an Agency Link or a Statute Link ties to an Agency, optionally only the ones whose evidence OLIS created since a time.
import { z } from "zod";
import type { IndexReader } from "#/packages/database/reader.ts";
import { agencyEvidenceKinds, type LinkedNode, type StoredStatuteLinked } from "#/packages/domain/agency-links.ts";
import { parseAmendmentNumber, type Listing } from "#/packages/domain/documents.ts";
import { citationOfMeasureId, measureIdOf, type SessionKey } from "#/packages/domain/index.ts";
import {
  parseOrsChapterReference,
  parseOrsSectionReference,
  type AgencyId,
  type OrsChapterId,
  type OrsSectionId,
} from "#/packages/domain/oregonai.ts";
import { compareMeasureSections, statuteLinkKinds } from "#/packages/domain/statute-links.ts";
import { compareTimestamps, readTimestamp, type Timestamp } from "#/packages/time/pacific.ts";
import {
  compareLinks,
  evidenceFieldsOf,
  evidenceFieldsOutput,
  gatherRepeats,
  type EvidenceFields,
  type GatheredLink,
} from "./agency-links.ts";
import type { Outcome } from "./outcome.ts";
import { notAnAgencyIdMessage, parseAgencyArgument } from "./filters.ts";
import { documentListingFields, listingShown, noLongerListedFlag, noLongerListedOutput } from "./listing.ts";

/**
 * How many items one page lists, across the groups. A full page, with every item at its evidence cap, is to stay at or
 * under about 25,000 characters (#16 F6), which is what a page of `testimony` is and a little over one part of
 * `get_document` (20,000). The size of an item is its own fields (about 450 characters) and its evidence: at the cap of
 * MAX_EVIDENCE examples, the largest kinds of item that rows can be made up to give are measured in
 * test/tools/find-measures-pull.test.ts ("stays inside a page's size") and in ADR-0028. The Session is some 100 times the
 * fixture, so an Agency with thousands of items is likely and the answer has to be paged.
 */
export const FIND_MEASURES_PAGE_SIZE = 12;
const PAGE_SIZE = FIND_MEASURES_PAGE_SIZE;

/**
 * How many examples of evidence an item lists, the newest first. A Measure can have dozens of Testimony from one Agency,
 * and a long Version reaches many chapters; each kind says how many there are in `count` and how many the cut left out.
 */
export const FIND_MEASURES_MAX_EVIDENCE = 3;
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
      'Only items with evidence whose created_at (when OLIS created the row of its document, the feed\'s CreatedDate) is at or after this time. A date ("2025-01-23", midnight Pacific), or an ISO 8601 time with "T" or a space between the date and the time: with no UTC offset it is Pacific time ("2025-01-23T16:00:00"), with an offset or "Z" it is that instant ("2025-01-24 00:00:00+00:00", "2025-01-24T00:00:00Z"), and with a zone in brackets and no offset it is that zone\'s clock ("2025-01-23T19:00:00[America/New_York]").',
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

/** The kinds of evidence an item has: an Agency Link's, or for an ORS section or chapter what a Statute Link does to its target. */
const evidenceKinds = [...agencyEvidenceKinds, ...statuteLinkKinds] as const;
type EvidenceKind = (typeof evidenceKinds)[number];

/**
 * One piece of evidence, as an example: an Agency Link's (agency-links.ts), or for an ORS section or chapter a Statute Link
 * to it, with the target it points at and the measure sections it is read in. The document it was read from is named by its
 * id; its source_url is in `documents`.
 */
const exampleOutput = z.object({
  document_id: z
    .string()
    .describe(
      "The document the evidence was read from: the Fiscal Impact Statement, the Version, the posting of the Proposed Amendment or the Testimony. Give it to get_document. Its source_url is in documents.",
    ),
  ...documentListingFields,
  ...evidenceFieldsOutput,
  target_id: z
    .string()
    .optional()
    .describe(
      "For a Statute Link to an ORS section or chapter: the ORS section (ors-653.616) or chapter (ors-chapter-657b) the link points at. OregonAI has no page for a chapter.",
    ),
  measure_sections: z
    .array(z.string().nullable())
    .optional()
    .describe(
      "For a Statute Link to an ORS section or chapter: the measure sections the link is read in, as the text prints them, in order; null when the text has no numbered sections.",
    ),
  created_at: z
    .string()
    .optional()
    .describe(
      "When OLIS created the row of the document the evidence was read from, in Pacific time with its UTC offset; for a Proposed Amendment posted to more than one meeting, of the latest posting whose file holds it. Absent when the feed gives no time.",
    ),
});

/** An item's evidence of one kind: how many pieces there are, and the newest of them as examples. */
const evidenceGroupOutput = z.object({
  kind: z
    .enum(evidenceKinds)
    .describe(
      'What the evidence is. For an Agency: "derived", "fiscal-impact-statement", "named-in-text" or "testimony" (see the groups). For an ORS section or chapter: what the Statute Link does to its target, "amends", "repeals", "adds-to" or "cites".',
    ),
  count: z
    .number()
    .int()
    .describe("How many pieces of evidence of this kind the item has (with since, only those created at or after it)."),
  left_out: z.number().int().describe("How many of them the cut left out: count less the length of examples."),
  examples: z
    .array(exampleOutput)
    .describe(
      `The newest pieces of the item's evidence, ${MAX_EVIDENCE} at the most across all its kinds. Where each piece is published is in documents.`,
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
  no_longer_listed: noLongerListedOutput.describe(
    "Present, and true, only when the feed has stopped listing the item's own row (two complete full pulls in a row did not list it), or, for a call with agency, when it has stopped listing every document the Agency's evidence on this node was read from: the Agency's link is then still listed, flagged, and search's Agency filter does not count it. An Agency with any listed evidence document on the node has no flag. Absent otherwise.",
  ),
  created_at: z
    .string()
    .nullable()
    .describe(
      "When OLIS first created what makes the item match, in Pacific time with its UTC offset: the row of the Version, the earliest posting of the Proposed Amendment that holds it, the row of the Fiscal Impact Statement or of the Testimony. Null when the feed gives no time.",
    ),
  last_created_at: z
    .string()
    .nullable()
    .describe(
      "When OLIS last created what makes the item match. It is created_at, except for a Proposed Amendment posted to more than one meeting, or an item with evidence from more than one document: the latest. since is compared with the created_at of each piece of evidence, so an item is here when this is at or after since.",
    ),
  evidence: z
    .array(evidenceGroupOutput)
    .describe(
      "The item's evidence by kind, each kind with its count and its newest examples. With since, only evidence created at or after it.",
    ),
});

const groupOutput = z.object({
  evidence_kind: z
    .enum(groupKinds)
    .describe(
      "What ties the items to the Agency. For an Agency: derived, fiscal-impact-statement, named-in-text, testimony. For an ORS section or chapter: statute-link.",
    ),
  description: z.string().describe("The group in words."),
  total: z.number().int().describe("How many items the group has, on every page."),
  items: z.array(itemOutput).describe("The group's items that are on this page, the most recently created first."),
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
  documents: z
    .array(
      z.object({
        id: z.string().describe("The document's id: a document_id of the examples."),
        source_url: z.string().describe("Where the Legislature publishes the document."),
      }),
    )
    .describe("Each document the examples of this page name, once, with where the Legislature publishes it."),
  notes: z.array(z.string()).describe("What the answer has nothing for, in words. Empty when there is nothing to say."),
});

export type FindMeasuresOutput = z.infer<typeof findMeasuresOutput>;
type ItemOutput = z.infer<typeof itemOutput>;
type ExampleOutput = z.infer<typeof exampleOutput>;
/** An item as the tool builds it: the times are Timestamps, and it knows the documents its examples name. */
type Item = Omit<ItemOutput, "created_at" | "last_created_at"> & {
  created_at: Timestamp | null;
  last_created_at: Timestamp | null;
  documents: { id: string; sourceUrl: string }[];
  /** Whether the feed lists the item: its own row, and for an Agency its link to the node (the item's flag, ADR-0030, ADR-0037). */
  listing: Listing;
};

/** Why a call cannot be met. Expected outcomes are values; the envelope tells the agent they are tool errors. */
export type FindMeasuresFault =
  { kind: "bad_request"; message: string } | { kind: "no_such_page"; page: number; lastPage: number };

export type FindMeasuresOutcome = Outcome<FindMeasuresOutput, FindMeasuresFault>;

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

/** One piece of an item's evidence, with when OLIS created each document that holds it (none when the feed gave no time). */
type Piece = {
  kind: EvidenceKind;
  document: { id: string; sourceUrl: string };
  fields: EvidenceFields & Pick<ExampleOutput, "target_id" | "measure_sections">;
  createdAt: Timestamp[];
  /** Whether the feed lists the document, for an Agency Link's evidence (ADR-0037). */
  listing?: Listing;
};

/** What makes one node an item: the pieces of evidence, in their order, and for an Agency the Listing of its link to the node. */
type Candidate = { node: LinkedNode; pieces: Piece[]; linkListing?: Listing };

/** The latest of a piece's times, or undefined when it has none. */
function latestOf(createdAt: readonly Timestamp[]): Timestamp | undefined {
  return createdAt.toSorted(compareTimestamps).at(-1);
}

/**
 * The Agency Links of one kind, gathered by the node they sit on. A link is dated by the postings whose own file gives
 * it (`gatherRepeats`): the Version's or statement's or Testimony's own row, or each posting of a Proposed Amendment
 * that reads the same. A posting of a different file never dates it.
 */
function candidatesOfLinks(links: readonly GatheredLink[]): Candidate[] {
  const byNode = new Map<string, Candidate>();
  for (const { link, createdAt } of links.toSorted((a, b) => compareLinks(a.link, b.link))) {
    const own = byNode.get(link.node.id) ?? { node: link.node, pieces: [], linkListing: link.listing };
    own.pieces.push({
      kind: link.evidence.kind,
      document: { id: link.document.id, sourceUrl: link.document.sourceUrl },
      fields: evidenceFieldsOf(link.evidence),
      createdAt,
      listing: link.document.listing,
    });
    byNode.set(link.node.id, own);
  }
  return [...byNode.values()];
}

/**
 * The Statute Links to a section or chapter, gathered by the Version or Proposed Amendment they were read from. Each
 * target is one piece of evidence under its kind, with every measure section it is linked in (a Proposed Amendment posted
 * to several meetings is one item, and postings that say the same add nothing). The document named is the first, in the
 * order of the feed's numbers. A piece is dated by the documents whose file holds a link to the target: a posting of
 * another file does not date it (#16 F2).
 */
function candidatesOfStatuteLinks(stored: readonly StoredStatuteLinked[]): Candidate[] {
  type Entry = Piece & { sections: (string | null)[]; createdAtById: Map<string, Timestamp> };
  const byNode = new Map<string, { node: LinkedNode; entries: Map<string, Entry> }>();
  for (const found of stored.toSorted((a, b) => numbersInOrder.compare(a.document.id, b.document.id))) {
    const gathered = byNode.get(found.node.id) ?? { node: found.node, entries: new Map<string, Entry>() };
    const key = `${found.link.kind} ${found.link.target.id}`;
    const entry = gathered.entries.get(key) ?? {
      kind: found.link.kind,
      document: { id: found.document.id, sourceUrl: found.document.sourceUrl },
      fields: { target_id: found.link.target.id },
      createdAt: [],
      sections: [],
      createdAtById: new Map<string, Timestamp>(),
    };
    if (!entry.sections.includes(found.link.measureSection)) entry.sections.push(found.link.measureSection);
    if (found.document.createdAt !== null) entry.createdAtById.set(found.document.id, found.document.createdAt);
    gathered.entries.set(key, entry);
    byNode.set(found.node.id, gathered);
  }
  return [...byNode.values()].map(({ node, entries }) => ({
    node,
    pieces: [...entries.values()]
      .toSorted(
        (a, b) =>
          evidenceKinds.indexOf(a.kind) - evidenceKinds.indexOf(b.kind) ||
          numbersInOrder.compare(a.fields.target_id ?? "", b.fields.target_id ?? ""),
      )
      .map((entry): Piece => ({
        kind: entry.kind,
        document: entry.document,
        fields: { ...entry.fields, measure_sections: entry.sections.toSorted(compareMeasureSections) },
        createdAt: [...entry.createdAtById.values()],
      })),
  }));
}

/** A piece as an example: its document, its fields of its kind, and the latest time a document holding it was created. */
function exampleOf(piece: Piece): ExampleOutput {
  const latest = latestOf(piece.createdAt);
  return {
    document_id: piece.document.id,
    ...(piece.listing === undefined ? {} : listingShown(piece.listing)),
    ...piece.fields,
    ...(latest === undefined ? {} : { created_at: latest }),
  };
}

/**
 * The item a node makes: the evidence created at or after `since` (all of it with no `since`), grouped by kind, each kind
 * with its count; the newest MAX_EVIDENCE pieces are shown as examples across the kinds, and each kind says how many it
 * left out. The item is dated by the documents that hold that evidence: `created_at` the earliest and `last_created_at` the
 * latest of their times. Undefined when no evidence is left, so the node is no item.
 */
function itemOf(candidate: Candidate, since: Timestamp | undefined): Item | undefined {
  const pieces = candidate.pieces.filter((piece) => {
    if (since === undefined) return true;
    const latest = latestOf(piece.createdAt);
    return latest !== undefined && compareTimestamps(latest, since) >= 0;
  });
  if (pieces.length === 0) return undefined;
  // Newest first. The sort is stable, so pieces from one time keep the order they were gathered in.
  const newestFirst = pieces.toSorted((a, b) => {
    const left = latestOf(a.createdAt);
    const right = latestOf(b.createdAt);
    if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1;
    return compareTimestamps(right, left);
  });
  const ordered = pieces.flatMap((piece) => piece.createdAt).toSorted(compareTimestamps);
  const shown = newestFirst.slice(0, MAX_EVIDENCE);
  return {
    id: candidate.node.id,
    type: candidate.node.type,
    title: titleOf(candidate.node),
    measure_id: measureIdOf(candidate.node.measure),
    source_url: candidate.node.sourceUrl,
    created_at: ordered[0] ?? null,
    last_created_at: ordered.at(-1) ?? null,
    evidence: evidenceKinds.flatMap((kind) => {
      const ofKind = pieces.filter((piece) => piece.kind === kind);
      if (ofKind.length === 0) return [];
      const examples = shown.filter((piece) => piece.kind === kind).map(exampleOf);
      return [{ kind, count: ofKind.length, left_out: ofKind.length - examples.length, examples }];
    }),
    documents: shown.map((piece) => piece.document),
    // The item is flagged when its own row is No longer listed, and for an Agency also when its link to the node is.
    listing:
      candidate.linkListing !== undefined && !candidate.linkListing.listed
        ? candidate.linkListing
        : candidate.node.listing,
  };
}

/** The most recently created first (an item with no time last), then by id as the feed numbers it. */
function compareItems(a: Item, b: Item): number {
  if (a.last_created_at === null || b.last_created_at === null) {
    if (a.last_created_at !== b.last_created_at) return a.last_created_at === null ? 1 : -1;
    return numbersInOrder.compare(a.id, b.id);
  }
  return compareTimestamps(b.last_created_at, a.last_created_at) || numbersInOrder.compare(a.id, b.id);
}

type Group = { kind: GroupKind; items: Item[] };

/** The items of a group that have evidence created at or after `since`, newest first. With no `since`, all of them. */
function groupOfCandidates(kind: GroupKind, candidates: readonly Candidate[], since: Timestamp | undefined): Group {
  return {
    kind,
    items: candidates
      .map((candidate) => itemOf(candidate, since))
      .filter((item) => item !== undefined)
      .toSorted(compareItems),
  };
}

/**
 * Cuts the groups to one page of items counted across them in order, keeping each group's total, with the documents the
 * page's examples name once each. An item of the page whose own row the feed no longer lists is flagged.
 */
function pageOf(
  groups: readonly Group[],
  page: number,
): { groups: FindMeasuresOutput["groups"]; documents: FindMeasuresOutput["documents"]; total: number } {
  const first = (page - 1) * PAGE_SIZE;
  let before = 0;
  const documents = new Map<string, string>();
  const paged = groups.map((group) => {
    const start = Math.max(0, first - before);
    const end = Math.max(0, first + PAGE_SIZE - before);
    before += group.items.length;
    return {
      evidence_kind: group.kind,
      description: groupDescriptions[group.kind],
      total: group.items.length,
      items: group.items.slice(start, end).map(({ documents: named, listing, ...item }): ItemOutput => {
        for (const document of named) documents.set(document.id, document.sourceUrl);
        return { ...item, ...noLongerListedFlag(listing) };
      }),
    };
  });
  return {
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
    groups: paged,
    documents: [...documents]
      .toSorted(([a], [b]) => numbersInOrder.compare(a, b))
      .map(([id, sourceUrl]) => ({ id, source_url: sourceUrl })),
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
    const id = parseAgencyArgument(input.agency);
    return typeof id === "object"
      ? { kind: "bad_request", message: notAnAgencyIdMessage(id.reference) }
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
): FindMeasuresOutcome {
  const target = targetOf(input);
  if (target.kind === "bad_request") return { kind: "fault", fault: target };
  const since = input.since === undefined ? undefined : readTimestamp(input.since);
  if (input.since !== undefined && since === undefined) {
    return {
      kind: "fault",
      fault: {
        kind: "bad_request",
        message: `"${input.since}" is not a time. Give a date such as 2025-01-23 or a time such as 2025-01-23T16:00:00 (Pacific) or 2025-01-24T00:00:00Z.`,
      },
    };
  }
  let groups: Group[];
  const notes: string[] = [];
  switch (target.kind) {
    case "agency": {
      const links = reader.findAgencyLinks(session, { agency: target.id });
      const stored = gatherRepeats(links);
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
      const stored = reader.findStatuteLinked(
        session,
        target.kind === "section" ? { section: target.id } : { chapter: target.id },
      );
      groups = [groupOfCandidates("statute-link", candidatesOfStatuteLinks(stored), since)];
      if (stored.length === 0) notes.push(`The index holds no Statute Link to ${target.id}.`);
      break;
    }
    default:
      return target satisfies never;
  }
  const page = input.page ?? 1;
  const paged = pageOf(groups, page);
  const lastPage = Math.max(1, Math.ceil(paged.total / PAGE_SIZE));
  if (page > lastPage) return { kind: "fault", fault: { kind: "no_such_page", page, lastPage } };
  return {
    kind: "answer",
    answer: {
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
      documents: paged.documents,
      notes,
    },
  };
}

/** What an agent is told when a call to find_measures is a fault. */
export function findMeasuresFaultMessage(fault: FindMeasuresFault): string {
  switch (fault.kind) {
    case "bad_request":
      return fault.message;
    case "no_such_page":
      return noSuchPageMessage(fault.page, fault.lastPage);
    default:
      return fault satisfies never;
  }
}

/** What an agent is told when it asks for a page past the last one. */
function noSuchPageMessage(page: number, lastPage: number): string {
  const pages = lastPage === 1 ? "1 page" : `${lastPage} pages`;
  return `The answer has ${pages}, so there is no page ${page}. Ask for a page from 1 to ${lastPage}.`;
}
