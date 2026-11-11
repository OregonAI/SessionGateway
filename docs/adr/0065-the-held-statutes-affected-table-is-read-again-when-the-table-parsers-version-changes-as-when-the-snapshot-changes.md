---
status: accepted (owner decision of 2026-11-11, ticket #184: schema step 9 approved, and the table parser's own constant); amends the last Consequence of ADR-0064 and the held table's re-read rule of ADR-0044; supersedes the last bullet of ADR-0044's Consequences ("a parser fix still reads the table again only when the copy is deleted or the file changes"); extends ADR-0048 (the ninth numbered step)
---

# The held Statutes Affected Table is read again when the table parser's version changes, as when the snapshot changes

ADR-0044 reads the held Statutes Affected Table again when the OregonAI snapshot's commit changes, and ADR-0034 when its bytes change. ADR-0064 gave Statute Links a parser version so that a parser fix reaches a stored database, and its last Consequence records that the table's reading (`statutes_affected_read`, keyed by Session and `snapshot_commit`) "has the same flaw for `parseStatutesAffectedTable`" and was left to #184. A change to the table parser that leaves the bytes and the commit the same therefore never reaches a stored table. The stored 2026R1 table is not stale today (#111, #169 and #170 touched only `read-links.ts` and `normalize.ts`, which the table parser does not import), but a change to a shared file such as `ranges.ts` would hit it.

## Decision

- **The held table is read again when its bytes, its snapshot commit or its parser version differ from the current ones.** The worker records the version of the table parser that made the entries beside the snapshot commit, in the same transaction, and every branch of ADR-0044 that reads the held copy again (same bytes, a failed fetch, bytes refused as no table) treats a differing version as it treats a differing commit. The copy's bytes, hash, address and retrieval time stay as they were.
- **Schema step 9** (ADR-0048) adds `parser_version INTEGER NOT NULL DEFAULT 0` to `statutes_affected_read`. `versionOneSchema` is unchanged. The step changes `statutes_affected_read`, one of the tables ADR-0048's Decision lists as staying as they are because a missing row already means something there, as ADR-0064 does for `statute_read`: a missing row still means "unread", and the column adds that a row can be stale. A reading made before the step gets 0, so it counts as read by an older parser, and the stored table is read again once at the next Full pull when `STATUTES_AFFECTED_TABLE_URL` is set (an Increment fetches no table, so reads none).
- **The table parser has a constant of its own**, `STATUTES_AFFECTED_TABLE_PARSER_VERSION` in `src/packages/statute-links/index.ts`, beside `parseStatutesAffectedTable`, starting at 1. **It is bumped by hand** in any change that would change what the table reading stores for the same bytes: a change to `statute-links/lib/statutes-affected-table.ts`, to a file it imports and to what those call (`statute-links/lib/ranges.ts`; `domain/oregonai.ts`'s `compareOrsChapterIds`, `compareOrsSectionIds`, `orsChapterCitationSource`, `orsChapterIdOf`, `orsChapterOf`, `orsSectionCitationSource` and `orsSectionIdOf`; `domain/statute-links.ts`'s `chapterTarget`, `sectionTarget` and `tableActions`), and outside the package to `ingest/lib/statutes-affected-table.ts` (the text and section list it passes the parser, as ADR-0064 lists `statute-parse.ts`) and to how the writer stores the entries (`replaceTableEntries`). A comment beside the constant says so. Nothing detects a missing bump: the reviewer of a parser change checks it.
- **The two versions are independent.** A bump of `STATUTE_LINK_PARSER_VERSION` does not read the table again, and a bump of the table's does not read any document's Statute Links again.

## Considered Options

- **Share `STATUTE_LINK_PARSER_VERSION` with the table.** Rejected by the owner on 2026-11-11: a change to either parser would then read both results again, so a table fix would force a re-parse of every stored Version and posting and clear their Agency Links, and a Statute Link fix would re-read a table it does not touch.
- **Fold the version into the `snapshot_commit` text.** Rejected for the reason ADR-0064 gives: one column would hold two facts.
- **Delete the `statutes_affected_read` row by hand after a table parser fix.** It needs someone with the box's database, and nothing says the fix has reached it.

## Consequences

- The first pull after any bump reads the held table again from its stored text, without fetching it. This costs one parse of one table.
- Schema step 9 moves the image's version to 9. The box's schema gate (platform-deploy#45, ADR-0048) holds the merged image until a v9 database is swapped in; the server refuses a v8 file until the worker has opened it.
- The stored table is read again once at the next Full pull when `STATUTES_AFFECTED_TABLE_URL` is set (an Increment reads no table), because its reading from before step 9 counts as version 0. Its entries should come out the same, as no parser change since it was read has altered them.
- A table parser change that forgets to bump the constant does not reach a stored database, as before this ADR.
