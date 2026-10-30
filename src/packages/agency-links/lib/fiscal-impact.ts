import { slugsByStatementTerm } from "./registry-index.ts";
import type { AgencyLink, FiscalImpactResult, RegistryAgency } from "./types.ts";

const unitLabel = "Government Unit(s) Affected:";
/** The heading the Legislative Fiscal Office's template puts right after the list. */
const nextHeading = "Summary of Fiscal Impact";

type UnitList = { kind: "none" } | { kind: "unbounded" } | { kind: "listed"; text: string };

/**
 * The list as one string. `pdftotext` wraps a long list onto further lines, even inside a name
 * ("Judicial" then "Department"), and the template closes the list with the next heading. A list
 * that no heading closes before a blank line or the end of the text is unbounded: where it ends is
 * unknown, and guessing would read the statement's body as units.
 */
function listedUnits(text: string): UnitList {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.startsWith(unitLabel));
  if (first === -1) return { kind: "none" };
  const wrapped: string[] = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith(nextHeading)) return { kind: "listed", text: wrapped.join(" ") };
    if (line.trim() === "") break;
    wrapped.push(line.startsWith(unitLabel) ? line.slice(unitLabel.length) : line);
  }
  return { kind: "unbounded" };
}

/** Reads the units a Fiscal Impact Statement lists after "Government Unit(s) Affected:". */
export function readFiscalImpactUnits(text: string, registry: readonly RegistryAgency[]): FiscalImpactResult {
  const listed = listedUnits(text);
  if (listed.kind === "none") return { kind: "no-unit-line" };
  if (listed.kind === "unbounded") return { kind: "unbounded-unit-line" };
  const slugs = slugsByStatementTerm(registry);
  const links: AgencyLink[] = [];
  const unresolvedUnits: string[] = [];
  for (const piece of listed.text.split(",")) {
    const unit = piece.trim();
    // An empty list or a comma left at the end of a line names no unit.
    if (unit === "") continue;
    const agency = slugs.get(unit);
    if (agency === undefined) unresolvedUnits.push(unit);
    else links.push({ agency, evidence: { kind: "fiscal-impact-statement", unit } });
  }
  return { kind: "units", links, unresolvedUnits };
}
