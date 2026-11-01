---
status: accepted; supersedes ADR-0034's "read again only when its bytes change" and the Consequence that a new snapshot reads the table again only after the copy is deleted or the file changes (the rest of ADR-0034 stands); extends ADR-0035 to the table
---

# The held Statutes Affected Table is read again when the snapshot changes, from the held copy when it cannot be fetched

A series in the table ("345.010 to 345.340") is expanded against the snapshot's ORS section list, as a range in a Version is (ADR-0033). ADR-0035 reads the Statute Links again when the snapshot's commit changes, so that the index never reports a snapshot (`session_overview`) its links were not read with, but ADR-0034 read the table again only when its bytes changed: after a new snapshot, the table's entries were expanded with the old list. The owner decided on 2026-11-01 (ticket #59) that the table follows the snapshot too.

- **The held table records the snapshot commit its entries were read with.** A full pull whose commit differs reads the table again, though its bytes are the same. Same bytes are read again from the copy's stored text, which is what extracting them again would give, so the copy's retrieval time stays that of the pull that first saw them; the build report says `loaded` with the new counts. A pull of the same snapshot and the same bytes reads nothing (`unchanged`).
- **A failed fetch on that pull reads the held copy again, without fetching.** When the commit differs and the table cannot be fetched (a 404 after it was loaded, a server that keeps failing), the stored text is parsed again with the new section list, as ADR-0035 reads Statute Links again from stored text. The copy's bytes, content hash, `source_url` and retrieval time stay as they were, and the build report's `statutes_affected_table` block says `read_again_from_held_copy`, `held: true`, the counts of a `loaded` table and why it was not fetched. Re-expanding the same bytes takes back nothing the Legislature published, so ADR-0034's "a copy that was loaded is kept" still holds. A later pull of the same snapshot reads the table no further, whether it fetches the same bytes (`unchanged`) or fails again.
- **A database made before the stamp** holds no commit for its table, so its next full pull reads the table once more.

## Considered Options

- **A bullet in ADR-0035, and a failed fetch that leaves the table as it was** (PR #58, reverted). The rule that changes is ADR-0034's, so a reader of ADR-0034 alone would be misled; and a table that keeps its older expansion until a pull can fetch it breaks ADR-0035's promise for as long as the server fails, though the text needed is already held.

## Consequences

- A snapshot change costs one parse of the table's stored text (no PDF extraction, no fetch beyond the pull's usual one), on top of ADR-0035's parse of every stored Version and posting.
- Unchanged by this ADR: with `STATUTES_AFFECTED_TABLE_URL` unset nothing happens and the report says nothing, even if a table is held; bytes refused as no table are remembered as before (`refused_unchanged`); and a parser fix still reads the table again only when the copy is deleted or the file changes (ADR-0034, ADR-0015).
