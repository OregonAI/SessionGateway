import type { RegistryAgency } from "./types.ts";

/**
 * Registry rows that are never linked. The OregonAI registry has a row for the Legislative
 * Assembly, but spec #1 (story 34) keeps it as an unresolved unit rather than an Agency, and every
 * printed Version names it in its own boilerplate ("subject to consideration by the Legislative
 * Assembly"), so a link to it would say nothing about the Measure.
 */
const neverLinked: ReadonlySet<string> = new Set(["legislative-assembly"]);

/** The slug a name or alias belongs to. A term two rows share belongs to the first row. */
export function slugsByTerm(registry: readonly RegistryAgency[]): Map<string, string> {
  const slugs = new Map<string, string>();
  for (const agency of registry) {
    if (neverLinked.has(agency.slug)) continue;
    for (const term of [agency.name, ...agency.aliases]) {
      if (!slugs.has(term)) slugs.set(term, agency.slug);
    }
  }
  return slugs;
}
