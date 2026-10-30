import { slugsByTerm } from "./registry-index.ts";
import type { AgencyLink, RegistryAgency } from "./types.ts";

/**
 * `Organization` is typed by whoever submitted (spec #1, "Further Notes"): a city, a district, a
 * short name, stray spaces. A value is an Agency only when the whole of it, trimmed, is a name or
 * alias the registry lists; a value that merely contains or starts like one is not.
 */
export function matchOrganization(organization: string, registry: readonly RegistryAgency[]): AgencyLink[] {
  const written = organization.trim();
  const agency = slugsByTerm(registry).get(written);
  if (agency === undefined) return [];
  return [{ agency, evidence: { kind: "testimony", organization: written } }];
}
