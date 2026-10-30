import { slugsByStatementTerm } from "./registry-index.ts";
import type { AgencyLink, FiscalImpactResult, RegistryAgency } from "./types.ts";

const unitLabel = "Government Unit(s) Affected:";
/** The heading the Legislative Fiscal Office's template puts right after the list. */
const nextHeading = "Summary of Fiscal Impact";

/**
 * The list as one string. `pdftotext` wraps a long list onto further lines, even inside a name
 * ("Judicial" then "Department"), and the list ends at the next heading.
 */
function listedUnits(text: string): string | undefined {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.startsWith(unitLabel));
  if (first === -1) return undefined;
  const wrapped: string[] = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith(nextHeading)) break;
    wrapped.push(line.startsWith(unitLabel) ? line.slice(unitLabel.length) : line);
  }
  return wrapped.join(" ");
}

/** Reads the units a Fiscal Impact Statement lists after "Government Unit(s) Affected:". */
export function readFiscalImpactUnits(text: string, registry: readonly RegistryAgency[]): FiscalImpactResult {
  const listed = listedUnits(text);
  if (listed === undefined) return { kind: "no-unit-line" };
  const slugs = slugsByStatementTerm(registry);
  const links: AgencyLink[] = [];
  const unresolvedUnits: string[] = [];
  for (const piece of listed.split(",")) {
    const unit = piece.trim();
    const agency = slugs.get(unit);
    if (agency === undefined) unresolvedUnits.push(unit);
    else links.push({ agency, evidence: { kind: "fiscal-impact-statement", unit } });
  }
  return { kind: "units", links, unresolvedUnits };
}
