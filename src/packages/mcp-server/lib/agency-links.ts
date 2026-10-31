// How Agency Links are shown to an agent, by get_measure and by find_measures (ticket #16, spec #1 stories 31
// to 35): one shape for a link's evidence, one order, and the units that are not Agencies kept apart.
import { z } from "zod";
import {
  agencyEvidenceKinds,
  agencyLinkKey,
  listedLinkKeys,
  type AgencyEvidence,
  type LinkedNode,
  type StoredAgencyLink,
  type StoredUnresolvedUnit,
} from "#/packages/domain/agency-links.ts";
import type { AgencyId } from "#/packages/domain/oregonai.ts";
import { statuteLinkKinds } from "#/packages/domain/statute-links.ts";
import type { Timestamp } from "#/packages/time/pacific.ts";
import { noLongerListedFlag, noLongerListedOutput } from "./listing.ts";

const numbersInOrder = new Intl.Collator("en", { numeric: true });

/**
 * How many sub-units a derived link through them names. A Department can have many (the Department of Agriculture has 24
 * in the registry, 22 of them implementing chapter 192), and the answer is bounded (#16 F6).
 */
const THROUGH_SHOWN = 2;

/** The fields of an Agency Link's evidence that belong to its kind. Only the fields of its kind are present. */
export const evidenceFieldsOutput = {
  unit: z
    .string()
    .optional()
    .describe(
      'For "fiscal-impact-statement": the unit as the statement lists it after "Government Unit(s) Affected:".',
    ),
  terms: z
    .array(z.string())
    .optional()
    .describe(
      'For "named-in-text": the registry names and aliases found in the text, each once, in the order they come.',
    ),
  organization: z
    .string()
    .optional()
    .describe(
      "For \"testimony\": the Testimony's Organization as typed (free text), which is the Agency's name or alias.",
    ),
  chapter_id: z
    .string()
    .optional()
    .describe(
      'For "derived": the ORS chapter (ors-chapter-653) the Statute Link reaches, whose rules the Agency implements. OregonAI has no page for a chapter.',
    ),
  statute_link: z
    .object({
      kind: z.enum(statuteLinkKinds).describe("What the link does to its target: amends, repeals or adds-to."),
      target_id: z.string().describe("The ORS section (ors-653.616) or chapter (ors-chapter-657b) it points at."),
      measure_section: z
        .string()
        .nullable()
        .describe("The measure section the link is read in, as the text prints it; null when the text has none."),
    })
    .optional()
    .describe(
      'For "derived": the Statute Link that derived the Agency Link. When several reach the chapter, it is the one in the lowest measure section.',
    ),
  links_in_chapter: z
    .number()
    .int()
    .optional()
    .describe(
      'For "derived": how many of the document\'s Statute Links that amend, repeal or add to reach the chapter, the one above included.',
    ),
  through: z
    .array(z.string())
    .optional()
    .describe(
      `For "derived", when the Agency has sub-units: the slugs of the first ${THROUGH_SHOWN} sub-units whose rules implement the chapter, through which the Agency has this link (through_total says how many). Absent when the chapter's rules are the Agency's own, or the Agency is itself the sub-unit.`,
    ),
  through_total: z
    .number()
    .int()
    .optional()
    .describe(
      'For "derived", with through: how many sub-units implement the chapter, of which through lists the first few.',
    ),
};

/** The evidence fields of one Agency Link. */
export type EvidenceFields = z.infer<z.ZodObject<typeof evidenceFieldsOutput>>;

/** The fields of the evidence that are its kind's own. */
export function evidenceFieldsOf(evidence: AgencyEvidence): EvidenceFields {
  switch (evidence.kind) {
    case "fiscal-impact-statement":
      return { unit: evidence.unit };
    case "named-in-text":
      return { terms: evidence.terms };
    case "testimony":
      return { organization: evidence.organization };
    case "derived":
      return {
        chapter_id: evidence.chapter,
        statute_link: {
          kind: evidence.link.kind,
          target_id: evidence.link.target.id,
          measure_section: evidence.link.measureSection,
        },
        links_in_chapter: evidence.linksInChapter,
        ...(evidence.through === undefined
          ? {}
          : { through: evidence.through.slice(0, THROUGH_SHOWN), through_total: evidence.through.length }),
      };
    default:
      return evidence satisfies never;
  }
}

/** The order links are listed in: by kind (derived first), then the node, then the document the evidence was read from. */
export function compareLinks(a: StoredAgencyLink, b: StoredAgencyLink): number {
  return (
    agencyEvidenceKinds.indexOf(a.evidence.kind) - agencyEvidenceKinds.indexOf(b.evidence.kind) ||
    numbersInOrder.compare(a.node.id, b.node.id) ||
    numbersInOrder.compare(a.document.id, b.document.id)
  );
}

function nodeOutput(node: LinkedNode): { node_id: string; node_type: LinkedNode["type"] } {
  return { node_id: node.id, node_type: node.type };
}

/** An Agency Link, with when OLIS created each posting whose own file gives the same link. */
export type GatheredLink = { link: StoredAgencyLink; createdAt: Timestamp[] };

/**
 * The links with a repeated one gathered into the first. A Proposed Amendment posted to several meetings has a posting for
 * each, and postings that say the same name an Agency in the same way once; the link kept is the one from the first
 * posting, in the order of the feed's numbers, so which posting an agent is given does not depend on the order of the
 * rows. `createdAt` is the creation time of every posting the link was read from, so that the link is dated by the
 * postings that hold it and by no other (#16 F2). Any other document is its own evidence: two Testimony from one Agency
 * on a Measure, or two statements that list it, are two links.
 */
export function gatherRepeats(links: readonly StoredAgencyLink[]): GatheredLink[] {
  const gathered = new Map<string, GatheredLink>();
  for (const link of links.toSorted((a, b) => numbersInOrder.compare(a.document.id, b.document.id))) {
    const key = JSON.stringify([
      link.agency,
      link.node.id,
      link.evidence,
      link.node.type === "proposed_amendment" ? null : link.document.id,
    ]);
    const own = gathered.get(key) ?? { link, createdAt: [] };
    if (link.document.createdAt !== null) own.createdAt.push(link.document.createdAt);
    gathered.set(key, own);
  }
  return [...gathered.values()];
}

/** The links with a repeated one left out (`gatherRepeats`, without the times). */
export function withoutRepeats(links: readonly StoredAgencyLink[]): StoredAgencyLink[] {
  return gatherRepeats(links).map(({ link }) => link);
}

/** Where a link sits, as an agent sees it. */
const nodeFields = {
  node_id: z.string().describe("The Measure, Version or Proposed Amendment the link sits on."),
  node_type: z.enum(["measure", "version", "proposed_amendment"]).describe("What the node is."),
};

/**
 * How many examples of one kind of evidence an Agency's entry gives. The rest are counted, and `find_measures` (with
 * `agency`) lists every one, a page at a time (#16 F5).
 */
export const AGENCY_LINK_EXAMPLES = 3;

const exampleOutput = z.object({
  document_id: z
    .string()
    .describe(
      "The document the evidence was read from: the Fiscal Impact Statement, the Version, the posting of the Proposed Amendment or the Testimony. Give it to get_document. Its source_url is in documents.",
    ),
  ...nodeFields,
  no_longer_listed: noLongerListedOutput.describe(
    "Present, and true, only when the Agency's link to this node has no evidence document the feed still lists: every document the evidence of the Agency's links to node_id was read from (this one among them) is one the feed has stopped listing (two complete full pulls in a row did not list it; see documents). The link is still shown. A link with any listed evidence document, on this node, has no flag even when this example's document is not listed. Absent otherwise.",
  ),
  ...evidenceFieldsOutput,
});

const kindEvidenceOutput = z.object({
  kind: z
    .enum(agencyEvidenceKinds)
    .describe(
      'Why the links exist: "derived" (a Statute Link that amends, repeals or adds to a section or chapter whose rules the Agency implements), "fiscal-impact-statement" (the Agency is a Government Unit Affected in a Fiscal Impact Statement), "named-in-text" (the Agency\'s name or an alias is in the text of a Version or Proposed Amendment) or "testimony" (the Organization of a Testimony is the Agency\'s name or an alias).',
    ),
  count: z
    .number()
    .int()
    .describe("How many links of this kind the Agency has from the Measure, its Versions and its Proposed Amendments."),
  examples: z
    .array(exampleOutput)
    .describe(
      `The first ${AGENCY_LINK_EXAMPLES} of them, by node and document. The rest are not listed here: find_measures with agency lists every one, a page at a time.`,
    ),
});

const unresolvedUnitOutput = z.object({
  unit: z.string().describe("The unit as the statement writes it: not an Agency, and not forced onto one."),
  statement_id: z
    .string()
    .describe("The Fiscal Impact Statement that lists it. Give it to get_document. Its source_url is in documents."),
  ...nodeFields,
});

export const agencyLinksOutput = z.object({
  agencies: z
    .array(
      z.object({
        agency_id: z
          .string()
          .describe(
            "The Agency's slug in the OregonAI agency registry. Give it to OregonAI for its budget, KPMs and audits, or to find_measures.",
          ),
        parent_id: z
          .string()
          .nullable()
          .describe(
            "The slug of the body the registry places the Agency under (a sub-unit's Department), or null. A link derived to a sub-unit also gives its parent a link, whose evidence says through which sub-units.",
          ),
        evidence: z
          .array(kindEvidenceOutput)
          .describe(
            "The Agency's links grouped by kind, in the order derived, fiscal-impact-statement, named-in-text, testimony; a kind it has no link of is not listed. Each kind has its count and a few examples.",
          ),
      }),
    )
    .describe("The Agencies the Measure, its Versions and its Proposed Amendments have an Agency Link to, by slug."),
  documents: z
    .array(
      z.object({
        id: z.string().describe("The document's id: a document_id of the examples or a statement_id of the units."),
        source_url: z.string().describe("Where the Legislature publishes the document."),
        no_longer_listed: noLongerListedOutput.describe(
          "Present, and true, only when the Legislature's feed has stopped listing this document: two complete full pulls in a row did not list it. It is still named, as it was last read. Absent when the feed lists it.",
        ),
        last_listed_at: z
          .string()
          .optional()
          .describe(
            "Present only with no_longer_listed: when the feed last listed the document, the as-of time of the latest complete full pull that did, in Pacific time with its UTC offset.",
          ),
      }),
    )
    .describe("Each document the examples and the units name, once, with where the Legislature publishes it."),
  unresolved_units: z
    .array(unresolvedUnitOutput)
    .describe(
      'The units the Measure\'s Fiscal Impact Statements list under "Government Unit(s) Affected" that are not Agencies in the OregonAI registry ("Cities", "Counties", "TriMet", the Legislative Assembly), each with its statement. They are kept as written and are never an Agency Link.',
    ),
  note: z
    .string()
    .describe("Says what a link's node is, what the evidence kinds mean, and what this answer leaves out."),
});

export type AgencyLinksOutput = z.infer<typeof agencyLinksOutput>;

/** What `note` says. */
export const AGENCY_LINKS_NOTE =
  "An Agency Link sits on the Measure, a Version or a Proposed Amendment (node_id): a Fiscal Impact Statement's links on the Version the Legislature's label places it on, or on the Measure when it places it on none; a Version's or a posting's on that Version or Proposed Amendment; Testimony's on the Measure. A link derived through a Statute Link counts only Statute Links that amend, repeal or add to: a citation of a section derives none. Each kind of evidence has its count and a few examples; find_measures with an agency lists every link of the Agency, a page at a time.";

/** What `note` adds when the answer leaves out links derived from Proposed Amendments that a later Version replaces. */
function leftOutNote(links: number, amendments: number): string {
  return `${links} derived links from ${amendments} Proposed Amendments are left out: their Statute Links are not listed in statute_links_by_source, because a later Version replaces them (superseded_amendments). find_measures with an agency lists them.`;
}

/** What an answer about a Measure needs to know besides its links. */
export type AgencyLinksContext = {
  /** The parent of each Agency that has one, from the snapshot the worker stored. */
  parents: ReadonlyMap<AgencyId, AgencyId>;
  /** The Proposed Amendments whose Statute Links `statute_links_by_source` does not list, because a later Version replaces them. */
  supersededAmendments: ReadonlySet<string>;
};

/**
 * A Measure's Agency Links: by Agency, each kind of evidence with its count and its first examples, the documents they
 * name once, and the units that are not Agencies. A link derived from a Proposed Amendment that the same answer's
 * `statute_links_by_source` does not list (ADR-0015) is left out and counted in the note.
 */
export function agencyLinksOf(
  links: readonly StoredAgencyLink[],
  units: readonly StoredUnresolvedUnit[],
  context: AgencyLinksContext,
): AgencyLinksOutput {
  const leftOut = new Set<string>();
  let leftOutLinks = 0;
  const byAgency = new Map<string, StoredAgencyLink[]>();
  for (const link of withoutRepeats(links)) {
    if (
      link.evidence.kind === "derived" &&
      link.node.type === "proposed_amendment" &&
      context.supersededAmendments.has(link.node.id)
    ) {
      leftOut.add(link.node.id);
      leftOutLinks += 1;
      continue;
    }
    byAgency.set(link.agency, [...(byAgency.get(link.agency) ?? []), link]);
  }
  const listedLinks = listedLinkKeys(links);
  const named = new Map<string, { sourceUrl: string; listing?: StoredAgencyLink["document"]["listing"] }>();
  const entries = [...byAgency.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([agency, own]) => ({
      agency_id: agency,
      parent_id: context.parents.get(agency as AgencyId) ?? null,
      evidence: agencyEvidenceKinds.flatMap((kind) => {
        const ofKind = own.filter((link) => link.evidence.kind === kind).toSorted(compareLinks);
        if (ofKind.length === 0) return [];
        const examples = ofKind.slice(0, AGENCY_LINK_EXAMPLES).map((link) => {
          named.set(link.document.id, { sourceUrl: link.document.sourceUrl, listing: link.document.listing });
          return {
            document_id: link.document.id,
            ...nodeOutput(link.node),
            ...noLongerListedFlag(listedLinks.has(agencyLinkKey(link.agency, link.node.id))),
            ...evidenceFieldsOf(link.evidence),
          };
        });
        return [{ kind, count: ofKind.length, examples }];
      }),
    }));
  const orderedUnits = units
    // By statement; the units of one statement stay in the order it lists them (the sort is stable).
    .toSorted((a, b) => numbersInOrder.compare(a.statement.id, b.statement.id));
  for (const unit of orderedUnits) {
    if (!named.has(unit.statement.id)) named.set(unit.statement.id, { sourceUrl: unit.statement.sourceUrl });
  }
  return {
    agencies: entries,
    documents: [...named.entries()]
      .toSorted(([a], [b]) => numbersInOrder.compare(a, b))
      .map(([id, { sourceUrl, listing }]) => ({
        id,
        source_url: sourceUrl,
        ...(listing === undefined || listing.listed
          ? {}
          : { ...noLongerListedFlag(false), last_listed_at: listing.lastListedAt }),
      })),
    unresolved_units: orderedUnits.map((unit) => ({
      unit: unit.unit,
      statement_id: unit.statement.id,
      ...nodeOutput(unit.node),
    })),
    note: leftOutLinks === 0 ? AGENCY_LINKS_NOTE : `${AGENCY_LINKS_NOTE} ${leftOutNote(leftOutLinks, leftOut.size)}`,
  };
}
