---
status: accepted; refines ADR-0005, ADR-0039, ADR-0042 and ADR-0045 (what a Full pull and an Increment read stands; where it is decided changes), and ADR-0009 (the entry points the "Extended by ticket #100" section lists)
---

# The Pull register is one table in `ingest`, and the OLIS client reads a set in the mode it is given

The list of the feed's entity sets was written four times (`FeedRead` in `ingest`, `FullPullRecord` in the writer, `ListedSources` in the Listing, `pulledEntitySets` in `domain`), and which sets an Increment reads, and how, was decided in four more places: the client's `changedSince` option, a check of two set names in `olis-client/lib/feed.ts`, `kind === "full_pull"` in `readFeed` (which skipped ConveneTimes and LegislativeSessions), and `floorLettersAbove` from the writer. FloorLetters (ticket #64) touched 11 files and ConveneTimes with LegislativeSessions (ticket #67) 12. The "latest run" an Increment reads from was worked out in `runIncrement` and again in the reader's `asOf`, and `createOlisClient` was set up three times. The architecture review of 2026-11-01 reopened it, and the owner decided it there (ticket #100).

## Decision

- **`ingest/lib/pull-register.ts` is the Pull register.** For each entity set it says how a Full pull reads it and how an Increment does: whole, changed since the last run, above the highest id the Index holds, or not read. These are the worker's decisions (ADR-0005, ADR-0039, ADR-0042, ADR-0045), so they are in `ingest`: Legislators and Committees whole in an Increment, ConveneTimes and LegislativeSessions not read, FloorLetters above the highest `FloorLetterId` held (the whole set while none is), every other set changed since. `readFeed` asks the register for each set (`readOf`) and holds no rule about one.
- **The OLIS client keeps one reader for each set and takes the mode on each call.** `PullRead` is `whole`, `changed_since` (with the time) or `above_id` (with the id). The client's `changedSince` option and its exception for Legislators and Committees are gone. A reader refuses a mode its set cannot be read by (FloorLetters by time, any other set above an id), which is a bug in the caller. The feed's shapes stay in the client (`src/CLAUDE.md`).
- **A set added to `pulledEntitySets` does not compile until every place handles it.** The register is a `Record<PulledEntitySet, ...>`, what `readFeed` returns is checked against the same list (`satisfies`), the writer's `FullPullRecord` has a field for each name (`PulledRows`), and the Listing's keys are a table over the same names (`listedRowsOf`). One shared object holding every rule of a set is not possible, because `database` and `domain` sit below `ingest` and must not import it; the lists are the same names, checked by the compiler.
- **The five sets that link documents have one entry's reading.** The client reads MeasureDocuments, MeasureAnalysisDocuments, CommitteeMeetingDocuments, CommitteeProposedAmendments and CommitteePublicTestimonies in one call, because an analysis document is placed on the Versions read with it (ADR-0013). They share one register entry, and the call returns each set's links apart (`DocumentSets`), so the writer's record can hold them under their own names.
- **A meeting's agenda is a column of its row.** It travels with the CommitteeMeetings row (`Meeting.agenda`) and is listed under `CommitteeMeetings.AgendaUrl` (ADR-0030), so the record has no separate list of agendas; `documentLinksOf(record)` joins the documents in the order the worker fetches them.
- **The Index's As of is written once.** `database/lib/run-state.ts` holds it (`readAsOf`): none until a Full pull has completed, else the later of the last Full pull and the last Increment, compared as moments. The reader's `asOf` and the writer's, which `runIncrement` reads, are the same function. Before, they disagreed on a database with an Increment and no Full pull.
- **The client is set up once.** `createWorkerClient` in `ingest/index.ts` makes the client for a Full pull, an Increment and the hash sample.
- **How a set is counted is not a column.** Every set a Pull reads, in any mode, is counted with `/$count` and `$inlinecount` (ADR-0005); a Full pull reports a short set and stores nothing, and an Increment throws on one. That is a property of the Pull, not of a set.

## Considered Options

- **The register in the OLIS client.** The client already had the exception and the option, and it would have kept the rule next to the filter it builds. Rejected: it makes a decision about what the worker reads inside the only code that is meant to know the feed's shapes and nothing else, and the rule changed in tickets about the worker (ADR-0042, ADR-0045).
- **One object in `domain` with every rule of a set, read by all four.** Rejected: the readers of the feed, the writer and the Listing are different packages, and the register's rules are `ingest`'s.
- **A separate reader for each of the five document sets.** Rejected: the placement of an analysis document needs the Versions read with it, which would move that rule into `ingest`.
- **Leave the writer's record as it was and key only the Listing.** Rejected: the record would still list the sets a second time, with its own field names, and a set could be read, stored and never listed.

## Consequences

Adding an entity set is a name in `pulledEntitySets`, a reader in the client, an entry in the register, a line in `readFeed`, a field in `PulledRows` and a line in the Listing's table. The compiler names each place, and a test of the Listing (`database/tests/listing-every-set.test.ts`) and of the requests a Pull makes (`test/tools/pull-reads.test.ts`) fail for a set that is stored and never listed or read the wrong way.

`FullPullRecord` changed shape (its fields are named for the feed's sets), so the seam-4 tests that arrange a record were rewritten to the new fields; none of their assertions changed. No seam-1 test changed. The index's tables, the tool results and the Build report are as they were.
