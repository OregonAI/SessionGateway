import { flattenText } from "./flatten-text.ts";
import { slugsByTerm } from "./registry-index.ts";
import type { AgencyLink, RegistryAgency } from "./types.ts";

function escapeForRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds the registry names and aliases in text, and links each Agency once with the terms that named it. */
export function findNamedAgencies(text: string, registry: readonly RegistryAgency[]): AgencyLink[] {
  const slugs = slugsByTerm(registry);
  if (slugs.size === 0) return [];
  // Longest first, so a name is never cut short by a shorter name that starts it.
  const terms = [...slugs.keys()].sort((a, b) => b.length - a.length);
  // "United States Department of Agriculture" is the federal department, not Oregon's.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?<!United States )(?:${terms.map(escapeForRegExp).join("|")})(?![\\p{L}\\p{N}])`,
    "gu",
  );
  const termsBySlug = new Map<string, string[]>();
  for (const match of flattenText(text).matchAll(pattern)) {
    const term = match[0];
    const slug = slugs.get(term);
    if (slug === undefined) continue;
    const found = termsBySlug.get(slug) ?? [];
    if (!found.includes(term)) found.push(term);
    termsBySlug.set(slug, found);
  }
  return [...termsBySlug].map(([agency, found]) => ({
    agency,
    evidence: { kind: "named-in-text", terms: found },
  }));
}
