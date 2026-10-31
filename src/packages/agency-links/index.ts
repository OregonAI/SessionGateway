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
 * only Statute Links that amend, repeal or add to derive one, never a citation (ADR-0027).
 */
export function derivedAgencyLinks(
  links: readonly StatuteLink[],
  chapterAgencies: ReadonlyMap<OrsChapterId, readonly AgencyId[]>,
): AgencyLink[] {
  return deriveAgencyLinks(links, chapterAgencies);
}
