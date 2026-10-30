// The Legislator resolver (spec #1, module 7): a Legislator is one person across every Legislator
// Code the feed uses for them. Codes are matched to the feed's Legislators rows; a code with no row
// is looked up in the alias file (aliases.ts).
export { createLegislatorResolver } from "./lib/resolve.ts";
export type { LegislatorResolver, Resolution, ResolverInput } from "./lib/resolve.ts";
