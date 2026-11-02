// The Statutes Affected Table as a whole (ticket #99; ADR-0033, ADR-0034), where `measure.ts` answers for one Measure. What the
// Build report counts of the table's entries is the rule `measure.ts` applies to set each entry beside a Version, asked of every
// entry at once, so the count and `get_measure` cannot disagree. Pure, like `measure.ts`: the caller passes in what the feed
// lists. Its seam-4 tests are in tests/lone-e-entries.test.ts.
export type { LoneETally } from "./lib/table-comparison.ts";
export { tallyLoneEEntries } from "./lib/table-comparison.ts";
