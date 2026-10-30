// The Agency Link extractor (spec #1, module 5): text and rows in, Agency Links with evidence out.
// Every function is pure: the agency registry arrives as a parameter, nothing here reads a file,
// the network or the clock, and nothing calls OregonAI (ADR-0004).

import { readFiscalImpactUnits } from "./lib/fiscal-impact.ts";
import type { FiscalImpactUnits, RegistryAgency } from "./lib/types.ts";

export type { AgencyEvidence, AgencyLink, FiscalImpactUnits, RegistryAgency } from "./lib/types.ts";

/** Reads a Fiscal Impact Statement's "Government Unit(s) Affected:" list against the registry. */
export function fiscalImpactAgencyLinks(text: string, registry: readonly RegistryAgency[]): FiscalImpactUnits {
  return readFiscalImpactUnits(text, registry);
}
