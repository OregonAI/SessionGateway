---
status: accepted (owner decision of 2026-11-11, ticket #183: schema step 8 approved); amends the last Consequence of ADR-0035; extends ADR-0048 (the eighth numbered step)
---

# Statute Links are read again when the parser's version changes, as when the snapshot changes

ADR-0035 reads a stored file's Statute Links again when the OregonAI snapshot's commit changes, and its last Consequence says that a parser fix "still rebuilds the database, or deletes a file's reading, as ADR-0015 says". That left a fix with no way to reach a database that holds the file. The 2026-11-10 v7 pull ran main `83365c1`, which carries the parser fixes of #111, #169 and #170, and `statute_link` stayed at 96,196 rows before and after: the 24 2026R1 documents and 333 links that #181 measured did not land, nor did #111's one link (SB 1583 section 15, ORS 430.388, now a repeal). A deployment cannot be rebuilt for each parser fix (the box's index also holds what the feed no longer lists), so a fix has to be able to say "read again".

## Decision

- **A file is unread for Statute Links when its reading's snapshot commit or its parser version differs from the current ones.** `unreadStatuteFiles` takes the current parser version beside the snapshot, and `storeStatuteParse` records the version of the parser that made the reading.
- **Schema step 8** (ADR-0048) adds `parser_version INTEGER NOT NULL DEFAULT 0` to `statute_read`. `versionOneSchema` is unchanged. The step changes `statute_read`, one of the tables ADR-0048's Decision lists as staying as they are because a missing row already means something there: a missing row still means "unread", and the column adds that a row can be stale. A reading made before the step gets 0, so it counts as read by an older parser, and every stored file of the Session is read again once at the next Full pull or Increment, which is what lands #111, #169 and #170.
- **The current version is a constant of the Statute Link parser package**, `STATUTE_LINK_PARSER_VERSION` (`src/packages/statute-links/index.ts`), starting at 1. **It is bumped by hand** in any change that would change what `statuteParseOf` (`ingest/lib/statute-parse.ts`) stores for some stored text: a change to the package, and also one outside it that the reading uses (`domain/oregonai.ts`'s `orsSectionIdOf` and `compareOrsSectionIds`, `domain/statute-links.ts`, `ingest/lib/statute-parse.ts` itself); a comment beside the constant says so. A change that leaves every stored result as it was needs no bump. Nothing detects a missing bump: the reviewer of a parser change checks it.
- Reading a file again deletes the Agency Links' reading of every document that shares it, and the same pull makes those links again after (ADR-0027, ADR-0035: the Agency Links are made from the Statute Links), as a changed snapshot does. The order of the Snapshot read is unchanged.

## Considered Options

- **Fold the version into the `snapshot_commit` text** (for example `<commit>+p2`), with no schema step. Rejected by the owner on 2026-11-11: it makes one column hold two facts, so a reader that wants the commit must take it apart.
- **Delete `statute_read` rows by hand after a parser fix**, as ADR-0035 left it. It needs someone with the box's database, and nothing says a fix has reached it.
- **Hash the parser's source.** It reads every file again for a change that alters no output, such as a comment; a number kept by hand says when the output changes.

## Consequences

- The first pull after any bump reads every stored Version and posting again from its stored text, without fetching, and so clears their Agency Links' reading, which the same pull makes again. This costs one parse of every stored file, as a snapshot change does (ADR-0035).
- Schema step 8 moves the image's version to 8. The box's schema gate (platform-deploy#45, ADR-0048) holds the merged image until a v8 database is swapped in; the server refuses a v7 file until the worker has opened it.
- A parser change that forgets to bump the constant does not reach a stored database, as before this ADR.
- The Statutes Affected Table's reading (`statutes_affected_read`, ADR-0044) is keyed by the snapshot's commit alone and has the same flaw for `parseStatutesAffectedTable`. It is not changed here (ticketed as #184).
