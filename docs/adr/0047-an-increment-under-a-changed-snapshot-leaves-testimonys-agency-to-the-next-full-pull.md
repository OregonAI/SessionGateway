---
status: accepted; refines ADR-0027 and ADR-0035 for the Increment (both stand)
---

# An Increment under a changed snapshot leaves Testimony's Agency to the next Full pull

ADR-0035 lets only a Full pull switch the snapshot the Index reports, and an Increment skips reading a stored document's links when the snapshot file's commit is not the reported one. Testimony escaped that guard: an Increment matched every Testimony row it read against the snapshot file's registry and overwrote the row's Agency, so between a snapshot change and the next Full pull the Index held Agency Links made with a snapshot it did not report, which ADR-0027 rules out. The architecture review of 2026-11-01 found it, and the owner decided the fix there.

## Decision

- **When the snapshot file's commit is the one the Index reports**, an Increment matches each Testimony row it reads, as before (ADR-0016).
- **When it is another commit**, an Increment leaves the stored Agency of every Testimony row the Index already holds, and stores a Testimony row new to the Index with no Agency. The next Full pull matches every row with the new snapshot and only then reports it (ADR-0035).

## Considered Options

- **Match with the snapshot file's registry, and accept the gap.** Rejected: it breaks ADR-0027's promise that the Index never reports a snapshot some of its Agency Links were not made with.
- **Store the registry in the Index, so an Increment matches with the reported snapshot.** Rejected: it stores a second copy of the registry to close a gap that lasts only until the next Full pull.

## Consequences

Until the next Full pull, a Testimony row an Increment first stores has no Agency Link from its Organization, and a row whose Organization an Increment changed keeps the Agency its earlier text matched.
