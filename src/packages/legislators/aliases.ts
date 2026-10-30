// The alias file: a small file kept by hand and committed, listing the Legislator Codes that have no
// Legislators row and saying who they are (spec #1, module 7). The entry scripts choose the file's
// path (the committed one's is `committedAliasFilePath`), read it once and hand the entries to the worker.
export { readAliasFile as readLegislatorAliases, committedAliasFilePath } from "./lib/alias-file.ts";
export type { LegislatorAlias, AliasTarget } from "./lib/alias-file.ts";
