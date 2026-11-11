# The 2025R1 fixture

A trimmed slice of the 2025R1 Session, committed so CI can replay it (ticket #3). It is public record, mirrored as published (ADR-0002). The repo's MIT license covers the code, not these documents.

- **Generated.** A fixture build script rebuilds the slice from the gitignored feed cache (`.cache/olis-2025R1/`) and a committed list of chosen Measures. Documents the cache lacks are downloaded from OLIS once, and each download is cached under `.cache/` with its retrieval time, so once the cache holds every document a rebuild produces no diff. To add a case, add its Measure to the list and rebuild. The build has a second rule: the Recording Log of each Meeting the slice holds is taken from the Meeting, not keyed on a Measure, because a Recording Log names none (its `MeasurePrefix` and `MeasureNumber` are null), so no row about a Measure leads to it. A Measure whose Meetings are new brings those Meetings' logs in with it, and a Meeting that has no log gets none (the README says which). A hand edit would pass the hash check while leaving the slice unreproducible.
- **Verbatim.** Feed rows keep the feed's own JSON: misspelled property names, and decimal keys as strings. Documents are the exact bytes OLIS served.
- **Manifested.** The manifest gives each document's `source_url`, retrieval time and sha256. The fixture verify script recomputes every hash and resolves every referenced key inside the fixture. It is a dependency-free `.ts` file run by Node 26, and `npm run check` runs it (`fixture:verify`).
- **Small.** Add a document only when a test needs it. GitHub warns at 50 MiB per file and wants the repo well under 1 GB.
- **Read through the fake OLIS.** Seam-1 tests reach the fixture only through the fake OLIS, so they see exactly what the ingest worker sees.

## The OregonAI snapshot fixture

`oregonai-snapshot/` is the OregonAI snapshot (ADR-0012) cut down to what the 2025R1 fixture touches, made by `scripts/snapshot/build.ts` from a local checkout of OregonAI's repository, and never edited by hand. Its README says what it kept, how the list was taken and how to rebuild it. `scripts/snapshot/verify.ts` checks it in `npm run check` without the checkout (`snapshot:verify`, a step of its own, so a failure of `fixture:verify` does not hide it), and fails when a Measure added above cites a chapter it lacks: rebuild it then.

## Made-up files

`made-up/` holds the few MADE UP files a test needs that no helper in `test/support/` can write and no real document has (a PDF that needs a password, ticket #178). They are not public records, so they are never in the 2025R1 manifest and `fixture:verify` does not read them; the folder's README says how each was made and gives its sha256, and the test that reads a file checks that hash first.
