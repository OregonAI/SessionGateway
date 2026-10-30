import type { RegistryAgency } from "./types.ts";

/** The slug a name or alias belongs to. A term two rows share belongs to the first row. */
export function slugsByTerm(registry: readonly RegistryAgency[]): Map<string, string> {
  const slugs = new Map<string, string>();
  for (const agency of registry) {
    for (const term of [agency.name, ...agency.aliases]) {
      if (!slugs.has(term)) slugs.set(term, agency.slug);
    }
  }
  return slugs;
}
