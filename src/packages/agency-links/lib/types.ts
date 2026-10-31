import type { AgencyId } from "#/packages/domain/oregonai.ts";
import type { AgencyLink } from "#/packages/domain/agency-links.ts";

// The Agency Link and its evidence are the domain's words: the database and the server name them too
// (domain/agency-links.ts). The extractor re-exports them, so its callers import them from here.
export type { AgencyEvidence, AgencyLink } from "#/packages/domain/agency-links.ts";

/** One row of the OregonAI agency registry, as the build-time snapshot carries it (ADR-0004). */
export type RegistryAgency = {
  /** The registry slug, such as `department-of-human-services`: the Agency's id. */
  slug: AgencyId;
  /** The name the registry gives the Agency. */
  name: string;
  /** Other names the registry lists for it. */
  aliases: readonly string[];
};

/** What a Fiscal Impact Statement's "Government Unit(s) Affected" line gives. */
export type FiscalImpactUnits = {
  kind: "units";
  links: AgencyLink[];
  /** Units that are not an Agency (GLOSSARY.md, "Unresolved unit"): none the registry names, and not the Legislative Assembly, as written. */
  unresolvedUnits: string[];
};

/** The text has no "Government Unit(s) Affected:" line, as in a Revenue Impact Statement. */
export type NoUnitLine = { kind: "no-unit-line" };

/**
 * The text has a "Government Unit(s) Affected:" line, but nothing closes the list before a blank
 * line or the end of the text (the template has no "Summary of Fiscal Impact" heading there). The
 * list's end is unknown, so no unit is read from it.
 */
export type UnboundedUnitLine = { kind: "unbounded-unit-line" };

export type FiscalImpactResult = FiscalImpactUnits | NoUnitLine | UnboundedUnitLine;
