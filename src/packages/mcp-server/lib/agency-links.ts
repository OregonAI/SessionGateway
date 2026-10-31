// How Agency Links are shown to an agent, by get_measure and by find_measures (ticket #16, spec #1 stories 31
// to 35): one shape for a link's evidence, one order, and the units that are not Agencies kept apart.
import { z } from "zod";
import {
  agencyEvidenceKinds,
  type AgencyEvidence,
  type LinkedNode,
  type StoredAgencyLink,
  type StoredUnresolvedUnit,
} from "#/packages/domain/agency-links.ts";
import { statuteLinkKinds } from "#/packages/domain/statute-links.ts";

const numbersInOrder = new Intl.Collator("en", { numeric: true });

/** What one Agency Link's evidence says, whatever it sits on. Only the fields of its kind are present. */
export const evidenceOutput = z.object({
  kind: z
    .enum(agencyEvidenceKinds)
    .describe(
      'Why the link exists: "derived" (a Statute Link that amends, repeals or adds to a section or chapter whose rules the Agency implements), "fiscal-impact-statement" (the Agency is a Government Unit Affected in a Fiscal Impact Statement), "named-in-text" (the Agency\'s name or an alias is in the text of a Version or Proposed Amendment) or "testimony" (the Organization of a Testimony is the Agency\'s name or an alias).',
    ),
  document_id: z
    .string()
    .describe(
      "The document the evidence was read from: the Fiscal Impact Statement, the Version, the posting of the Proposed Amendment or the Testimony. Give it to get_document.",
    ),
  source_url: z.string().describe("Where the Legislature publishes that document."),
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
});

export type EvidenceOutput = z.infer<typeof evidenceOutput>;

/** The fields of the evidence that are its kind's own. */
function kindFields(evidence: AgencyEvidence): Partial<EvidenceOutput> {
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
      };
    default:
      return evidence satisfies never;
  }
}

/** One Agency Link's evidence as an agent sees it. */
export function evidenceShown(link: StoredAgencyLink): EvidenceOutput {
  return {
    kind: link.evidence.kind,
    document_id: link.document.id,
    source_url: link.document.sourceUrl,
    ...kindFields(link.evidence),
  };
}

/** Where a link sits, as an agent sees it. */
const nodeFields = {
  node_id: z.string().describe("The Measure, Version or Proposed Amendment the link sits on."),
  node_type: z.enum(["measure", "version", "proposed_amendment"]).describe("What the node is."),
};

const evidenceOfAgencyOutput = evidenceOutput.extend(nodeFields);

const unresolvedUnitOutput = z.object({
  unit: z.string().describe("The unit as the statement writes it: not an Agency, and not forced onto one."),
  statement_id: z.string().describe("The Fiscal Impact Statement that lists it. Give it to get_document."),
  source_url: z.string().describe("Where the Legislature publishes that statement."),
  ...nodeFields,
});

export const agencyLinksOutput = z.object({
  agencies: z
    .array(
      z.object({
        agency_id: z
          .string()
          .describe(
            "The Agency's slug in the OregonAI agency registry. Give it to OregonAI for its budget, KPMs and audits.",
          ),
        evidence: z
          .array(evidenceOfAgencyOutput)
          .describe(
            "Every Agency Link to this Agency from the Measure or a Version or Proposed Amendment of it, with the evidence of each, in the order derived, fiscal-impact-statement, named-in-text, testimony, then by node and document.",
          ),
      }),
    )
    .describe("The Agencies the Measure, its Versions and its Proposed Amendments have an Agency Link to, by slug."),
  unresolved_units: z
    .array(unresolvedUnitOutput)
    .describe(
      'The units the Measure\'s Fiscal Impact Statements list under "Government Unit(s) Affected" that are not Agencies in the OregonAI registry ("Cities", "Counties", "TriMet", the Legislative Assembly), each with its statement. They are kept as written and are never an Agency Link.',
    ),
  note: z.string().describe("Says what a link's node is and what the evidence kinds mean."),
});

export type AgencyLinksOutput = z.infer<typeof agencyLinksOutput>;

/** What `note` says. */
export const AGENCY_LINKS_NOTE =
  "An Agency Link sits on the Measure, a Version or a Proposed Amendment (node_id): a Fiscal Impact Statement's links on the Version the Legislature's label places it on, or on the Measure when it places it on none; a Version's or a posting's on that Version or Proposed Amendment; Testimony's on the Measure. A link derived through a Statute Link counts only Statute Links that amend, repeal or add to: a citation of a section derives none.";

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

/**
 * The links with a repeated one left out. A Proposed Amendment posted to several meetings has a posting for each, and
 * postings that say the same name an Agency in the same way once; the link kept is the one from the first posting, in
 * the order of the feed's numbers, so which posting an agent is given does not depend on the order of the rows. Any other
 * document is its own evidence: two Testimony from one Agency on a Measure, or two statements that list it, are two links.
 */
export function withoutRepeats(links: readonly StoredAgencyLink[]): StoredAgencyLink[] {
  const seen = new Set<string>();
  const kept: StoredAgencyLink[] = [];
  for (const link of links.toSorted((a, b) => numbersInOrder.compare(a.document.id, b.document.id))) {
    const key = JSON.stringify([
      link.agency,
      link.node.id,
      link.evidence,
      link.node.type === "proposed_amendment" ? null : link.document.id,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(link);
  }
  return kept;
}

/** A Measure's Agency Links: by Agency, with each link's evidence and node, and the units that are not Agencies. */
export function agencyLinksOf(
  links: readonly StoredAgencyLink[],
  units: readonly StoredUnresolvedUnit[],
): AgencyLinksOutput {
  const byAgency = new Map<string, StoredAgencyLink[]>();
  for (const link of withoutRepeats(links)) byAgency.set(link.agency, [...(byAgency.get(link.agency) ?? []), link]);
  return {
    agencies: [...byAgency.entries()]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([agency, own]) => ({
        agency_id: agency,
        evidence: own.toSorted(compareLinks).map((link) => ({ ...evidenceShown(link), ...nodeOutput(link.node) })),
      })),
    unresolved_units: units
      // By statement; the units of one statement stay in the order it lists them (the sort is stable).
      .toSorted((a, b) => numbersInOrder.compare(a.statement.id, b.statement.id))
      .map((unit) => ({
        unit: unit.unit,
        statement_id: unit.statement.id,
        source_url: unit.statement.sourceUrl,
        ...nodeOutput(unit.node),
      })),
    note: AGENCY_LINKS_NOTE,
  };
}
