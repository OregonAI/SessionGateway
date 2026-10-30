// The alias file: a small file kept by hand and committed, listing the Legislator Codes that have no
// Legislators row and saying who they are (spec #1, module 7). The entry scripts read it once and
// hand it to the worker.
export { readCommittedAliasFile as readLegislatorAliases } from "./lib/alias-file.ts";
export type { LegislatorAlias, AliasTarget } from "./lib/alias-file.ts";
