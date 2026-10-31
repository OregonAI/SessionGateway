---
status: accepted; supersedes the part of ADR-0027's Consequences that makes `same_as` compare the whole Version entry
---

# A Version whose Statute Links repeat the Version before it says `same_links_as` and still shows its own table block and flag

ADR-0027 cut repeated Statute Links from `get_measure`: a Version whose reading is exactly that of the Version before it in print order says `same_as` that Version's id. Once tickets #18 and #22 put a Statutes Affected Table block (ADR-0033) and a `no_longer_listed` flag (ADR-0030) beside each Version, `same_as` compared the whole entry, so a Version that differs only in its block or its flag is listed in full. The 2025R1 table names SB 69's A-Engrossed Version and no entry names its Enrolled one, so with the table loaded the Enrolled Version is listed in full, 15,145 characters, and SB 69's answer is 82,145 characters against 65,623 without the table (measured on the fixture at `cee9d03`, 2026-10-31); HB 3795's Enrolled Version goes from 207 characters to 798 the same way. The owner decided on 2026-10-31 (PR #45 question 5) on one rule in place of `same_as`: `same_links_as` names the Version before it in print order when the parsed reading is exactly that Version's, and every Version shows its own table block and its own flag beside it, whatever its links. Nothing is lost, and SB 69's answer with the table loaded comes to about 67,200 characters (the Enrolled entry back to about 200).

## Considered Options

- **Two forms**: `same_as` when the whole entry repeats, `same_links_as` when only the reading does. The same sizes, and two rules for an agent to tell apart.
- **Keep `same_as` on the whole entry.** A Version is listed in full whenever the table names the Version before it and not this one, which is the usual case for an Enrolled Version.

## Consequences

- A Version that was not read is still never the same as another (ADR-0027).
- The tests that assert `same_as` change to `same_links_as`, and the case of a Version that differs from the one before it only in its table block or its flag now expects `same_links_as` beside the block or flag.
