import type { AgencyId } from "#/packages/domain/agencies.ts";

/** One row of the OregonAI agency registry, as the build-time snapshot carries it (ADR-0004). */
export type RegistryAgency = {
  /** The registry slug, such as `department-of-human-services`: the Agency's id. */
  slug: AgencyId;
  /** The name the registry gives the Agency. */
  name: string;
  /** Other names the registry lists for it. */
  aliases: readonly string[];
};

/** Why an Agency Link exists (GLOSSARY.md, "Agency Link"). The fourth kind, derived through a Statute Link, comes with the chapter-to-agency table. */
export type AgencyEvidence =
  | {
      kind: "fiscal-impact-statement";
      /** The unit as the statement lists it. */
      unit: string;
    }
  | {
      kind: "named-in-text";
      /** The registry names and aliases found in the text, each once, in the order they first appear. */
      terms: string[];
    }
  | {
      kind: "testimony";
      /** The Testimony row's `Organization`, as it is written there. */
      organization: string;
    };

/** A connection to one Agency, with the evidence that makes it. */
export type AgencyLink = {
  /** The Agency's registry slug. */
  agency: AgencyId;
  evidence: AgencyEvidence;
};

/** What a Fiscal Impact Statement's "Government Unit(s) Affected" line gives. */
export type FiscalImpactUnits = {
  kind: "units";
  links: AgencyLink[];
  /** Units the registry does not name, as written. */
  unresolvedUnits: string[];
};

/** The text has no "Government Unit(s) Affected:" line, as in a Revenue Impact Statement. */
export type NoUnitLine = { kind: "no-unit-line" };

export type FiscalImpactResult = FiscalImpactUnits | NoUnitLine;
