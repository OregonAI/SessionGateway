// The Agency Link extractor (spec #1, module 5): text and rows in, Agency Links with evidence out.
// Every function is pure: the agency registry arrives as a parameter, nothing here reads a file,
// the network or the clock, and nothing calls OregonAI (ADR-0004).

import type { AgencyId, OrsChapterId } from "#/packages/domain/oregonai.ts";
import type { StatuteLink } from "#/packages/domain/statute-links.ts";
import { deriveAgencyLinks } from "./lib/derived.ts";
import { readFiscalImpactUnits } from "./lib/fiscal-impact.ts";
import { matchOrganization } from "./lib/testimony-organization.ts";
import { findNamedAgencies } from "./lib/text-names.ts";
import type { AgencyLink, FiscalImpactResult, RegistryAgency } from "./lib/types.ts";

export type {
  AgencyEvidence,
  AgencyLink,
  FiscalImpactResult,
  FiscalImpactUnits,
  NoUnitLine,
  RegistryAgency,
  UnboundedUnitLine,
} from "./lib/types.ts";

/**
 * The version of the Agency Link reading (ADR-0066). The worker records it with each document it reads for Agency Links and
 * reads the document again when the recorded version is not this one, whether or not the snapshot has changed. BUMP IT BY HAND
 * in any change that would change what the worker's `agencyReadOf` (`ingest/lib/agency-links.ts`) stores for the same stored
 * text, Statute Links and snapshot: a change to this package, to what it calls in `domain/agency-links.ts`,
 * `domain/oregonai.ts` and `domain/statute-links.ts`, to `ingest/lib/agency-links.ts` (which kind of document is read how),
 * to `database/lib/agency-evidence.ts` (how evidence is stored), and to the registry, Chapter table and parents that
 * `oregonai-snapshot` hands the reading. A change to the Statute Link parser needs no bump here: its own bump reads the file
 * again and clears the Agency Links made from it (ADR-0064). Without the bump a stored database keeps the old links. A change
 * that leaves every stored result as it was needs none. A reading made before schema step 10 counts as version 0, so this
 * starts at 1.
 */
export const AGENCY_LINK_READER_VERSION = 1;

/** Reads a Fiscal Impact Statement's "Government Unit(s) Affected:" list against the registry. */
export function fiscalImpactAgencyLinks(text: string, registry: readonly RegistryAgency[]): FiscalImpactResult {
  return readFiscalImpactUnits(text, registry);
}

/** Finds the registry names and aliases that Version or Proposed Amendment text uses. */
export function textAgencyLinks(text: string, registry: readonly RegistryAgency[]): AgencyLink[] {
  return findNamedAgencies(text, registry);
}

/** Matches a Testimony row's free-text `Organization` to the registry. Most values are not an Agency. */
export function testimonyAgencyLinks(organization: string, registry: readonly RegistryAgency[]): AgencyLink[] {
  return matchOrganization(organization, registry);
}

/**
 * Derives Agency Links from a Version's or Proposed Amendment's Statute Links through the snapshot's Chapter table:
 * only Statute Links that amend, repeal or add to derive one, never a citation (ADR-0027). An Agency the table lists for a
 * chapter also gives its parent (`parentOf`, from the snapshot's registry) a link through it (ADR-0029).
 */
export function derivedAgencyLinks(
  links: readonly StatuteLink[],
  chapterAgencies: ReadonlyMap<OrsChapterId, readonly AgencyId[]>,
  parentOf: ReadonlyMap<AgencyId, AgencyId>,
): AgencyLink[] {
  return deriveAgencyLinks(links, chapterAgencies, parentOf);
}
