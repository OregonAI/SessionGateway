import type { AgencyId } from "#/packages/domain/agencies.ts";
import type { RegistryAgency } from "./types.ts";

/**
 * Bodies the documents name that are not Agencies, as the documents write them. The OregonAI
 * registry has a row for the Legislative Assembly, but spec #1 (story 34) keeps it as an unresolved
 * unit rather than an Agency (GLOSSARY.md, "Unresolved unit"), and every printed Version names it in
 * its own boilerplate ("subject to consideration by the Legislative Assembly"), so a link to it
 * would say nothing about the Measure.
 *
 * The rule is keyed on the name a document prints, not on the row's slug: the registry arrives as a
 * parameter, and a row that the snapshot gives another slug is still the Legislative Assembly.
 */
const notAnAgency: ReadonlySet<string> = new Set(["Legislative Assembly"]);

const registryPrefix = "Oregon ";

/** A registry term as a statement writes it: without the "Oregon " the registry puts in front of some names. */
function writtenForm(term: string): string {
  return term.startsWith(registryPrefix) ? term.slice(registryPrefix.length) : term;
}

function termsOf(agency: RegistryAgency): string[] {
  return [agency.name, ...agency.aliases];
}

/** The slug a name or alias belongs to. A term two rows share belongs to the first row. */
export function slugsByTerm(registry: readonly RegistryAgency[]): Map<string, AgencyId> {
  const slugs = new Map<string, AgencyId>();
  for (const agency of registry) {
    for (const term of termsOf(agency)) {
      if (notAnAgency.has(writtenForm(term))) continue;
      if (!slugs.has(term)) slugs.set(term, agency.slug);
    }
  }
  return slugs;
}

/**
 * For a Fiscal Impact Statement: every term of `slugsByTerm`, then each of them again as the
 * statement writes it. The Legislative Fiscal Office writes "Department of Education" for the
 * registry's "Oregon Department of Education" (ADR-0004 gives that unit as the case the snapshot
 * exists for). A term the registry itself lists is never taken over by a shortened one.
 */
export function slugsByStatementTerm(registry: readonly RegistryAgency[]): Map<string, AgencyId> {
  const slugs = slugsByTerm(registry);
  for (const agency of registry) {
    for (const term of termsOf(agency)) {
      const written = writtenForm(term);
      if (notAnAgency.has(written) || slugs.has(written)) continue;
      slugs.set(written, agency.slug);
    }
  }
  return slugs;
}
