import { slugsByTerm } from "./registry-index.ts";
import type { AgencyLink, FiscalImpactUnits, RegistryAgency } from "./types.ts";

const unitLabel = "Government Unit(s) Affected:";

/** Reads the units a Fiscal Impact Statement lists after "Government Unit(s) Affected:". */
export function readFiscalImpactUnits(text: string, registry: readonly RegistryAgency[]): FiscalImpactUnits {
  const slugs = slugsByTerm(registry);
  const links: AgencyLink[] = [];
  const unresolvedUnits: string[] = [];
  const line = text.split("\n").find((candidate) => candidate.startsWith(unitLabel)) ?? "";
  for (const piece of line.slice(unitLabel.length).split(",")) {
    const unit = piece.trim();
    const agency = slugs.get(unit);
    if (agency === undefined) unresolvedUnits.push(unit);
    else links.push({ agency, evidence: { kind: "fiscal-impact-statement", unit } });
  }
  return { kind: "units", links, unresolvedUnits };
}
