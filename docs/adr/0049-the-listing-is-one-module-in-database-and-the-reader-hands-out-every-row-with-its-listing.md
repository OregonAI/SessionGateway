---
status: accepted; refines ADR-0030 and ADR-0037 (their rules stand: where the state is read, and who derives it, changes)
---

# The Listing is one module in `database`, and the reader hands out every row with its Listing

ADR-0030 and ADR-0037 say when a row is No longer listed, and the first build wrote that rule five ways in two languages: the `feed_row_state` view, `previous - 2` and `number - 2` in the writer's search-generation bump, a SQL string (`COALESCE(fr.listed, 1)`) spliced into twelve reader queries that only worked over a join aliased `fr`, the unchecked case again in TypeScript, and a `NOT EXISTS` in search. "An amendment is listed while any Posting is" lived in one query, and ADR-0037 was applied by hand in the reader, in `agency_links` and in `find_measures`. A tool chose among `measureListing`, `findNoLongerListed` and `testimonyListing`, which returned three shapes. The architecture review of 2026-11-01 reopened it, and the owner decided it there (ticket #97).

## Decision

- **`database/lib/listing.ts` owns the Listing.** The two-pull arithmetic is one TypeScript function, `lastPullThatIsNoLongerListed`: the rows last listed by that pull or an earlier one are No longer listed. The reader applies it to a row it holds (`isListed`), and the writer's bump and search's queries bind the same number as a parameter (`last_listed_pull <= ?`) where the rule must run inside SQL over many rows. No SQL string is exported from the file.
- **The same module owns the other rules**: a row with no row in `feed_row` is listed with no last listing (ADR-0030); a Proposed Amendment is listed while any Posting is, and an Agency Link while any evidence Document is (ADR-0037), both through one `anyListed`; and a complete pull raises the search generation when it changes which Documents are No longer listed, which it learns by asking the rule before and after the pull.
- **Everything the reader hands out carries its `listing`**: every row, Document, Measure, Proposed Amendment, the node an Agency Link sits on and the link itself (listed while any of its evidence Documents is). The `Listing` type stays in `domain`. `listedLinkKeys` left `domain` with the by-hand rebuilds in the tools, and the three per-kind methods are gone. `findDocument` also answers for an id the index holds no file of (`held: false`, with whether the row is Testimony and its Listing), so `get_document` reads one answer.
- **The schema text is not touched.** ADR-0048 freezes today's `CREATE ... IF NOT EXISTS` text as version 1, and an edit to it would never reach a file already stamped. The view `feed_row_state` therefore stays in `connection.ts` and says the same rule in SQL, and nothing reads it. A numbered upgrade step may drop it.

## Considered Options

- **Keep the view as the one source and have the reader and search read it.** Rejected: the view's text cannot change once it is frozen, the rule would live in the schema and not in the module that explains it, and the unchecked case would still be a `COALESCE` in every query.
- **A view for the Documents search may return, or for every row's Listing including unchecked ones.** Rejected: it adds schema, which is the step ADR-0048 makes a numbered upgrade.
- **Leave unlisted Documents out of search in TypeScript.** Rejected: a keyword query is cut by `LIMIT`, and a set of the unlisted Documents costs a scan of every row of `feed_row` at each query unless it is cached per search generation. A `NOT EXISTS` on an indexed column is what ADR-0030 measured.

## Consequences

The reader asks for each row's Listing with a small indexed query where it used to join the state, so a list of N rows costs N extra lookups; they are by primary key or by `feed_row_document`. Search's `NOT EXISTS` still says "no row, so listed" in SQL, and the reader's `unchecked` says it in TypeScript: the seam-4 tests (`database/tests/`) hold both to the same cases. The tools' output does not change (`test/tools/no-longer-listed*.test.ts` and `pre-listing-database.test.ts` pass as they were).
