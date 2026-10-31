---
status: accepted; supersedes the part of ADR-0014 that makes the live_status block repeat the Measure's location, history and votes in full
---

# The live_status block says only what the top level does not

ADR-0014 gave `get_measure` a `live_status` block: the Measure's location, history, schedule and votes as OLIS says them at the read, dated by the read, and the cache's when the lookup fails. It repeated every value in full, so when OLIS gave exactly what the Index holds, the block was a second copy of the top level's History and Votes. On the fixture at the clock 2026-08-01 17:00 UTC with OLIS answering as the Index, SB 69's block was 14,608 characters of an answer of 65,629, and HB 3795's 23,289 of 64,525 (the text of the `get_measure` result, documents served, no Statutes Affected Table; measured on `main` at `5cdcea0`; the ticket's 65,623 and 64,519 were measured at `cee9d03`, and `main` has moved since, which is the 6 characters between). Ticket #48 keeps ADR-0014's purpose for the block and makes it lossless and smaller. Everything else in ADR-0014 stands: the five requests, the failure as a value, the bound, the configuration.

- **Each of the location, History, floor votes and committee votes is said against the top level's value, with a `status`.**
  - `unchanged`: OLIS gives exactly the top level's value. Nothing else is in the object.
  - `new_entries` (a list only): OLIS gives the top level's entries, in the same order and equal in every field (a vote's voters included), followed by more. `entries` holds only the ones after the top level's last. The full list is the top level's followed by `entries`.
  - `full`: any other difference (an earlier entry changed, an entry missing, OLIS gives fewer entries, a different order, a different location). The object holds OLIS's whole value (`entries`, or `current` and `committee_code` for the location), and it replaces the top level's.
  A list the top level holds empty and OLIS gives entries for is `new_entries` with all of them. Equality is on the values as the tool shows them (dates in Pacific time with their offset, each voter as the Legislator the code names), so a code the index resolves one way in the top level and the same way in the block cannot differ.
- **The Schedule is shown as before.** The top level has none, so there is nothing to say it against: the upcoming meetings, or `null` for a block that fell back.
- **A block that fell back to the cache repeats none of the top level's values.** The cache's values are the top level's, so the four values are `unchanged`, the Schedule is `null`, and `source: "cache"`, `lookup_failed: true`, the as-of time and the `notice` (which names the reason) say what happened. `unchanged` there means "read the top level's", not "OLIS confirmed it": nothing was read, and `source` tells the two apart. The schema's descriptions of `unchanged` and of the lists say so for `source: "cache"`.
- **The output schema says how to read it.** Each list's description names the three statuses and what each means (`full` is any difference other than new entries at the end: an entry changed, missing or reordered, or fewer entries), the location's names two, and the block's `notice` says it again in the result.

On the same fixture and clock, with OLIS answering as the Index, SB 69's block comes to 478 characters (from 14,608) and its answer to 51,499 (from 65,629); HB 3795's block to 478 (from 23,289) and its answer to 41,714 (from 64,525). Nothing is lost: an agent with the top level and the block can rebuild what OLIS said.

## Considered Options

- **A `diff` of added and removed entries.** Lossless too, but an agent has to apply it, and a changed entry in the middle reads as one removal and one addition. "The top level's entries plus new ones at the end" is the one change History and Votes make in practice (OLIS appends), and anything else is rare enough to show whole.
- **Leaving a value out when it is unchanged.** Smaller by a few words, but absent would mean both "unchanged" and "not read" (the fallback), and an optional field is easy to read as missing.
- **A fourth status, `not_read`, for the fallback.** It tells the cache from a confirmed value without reading `source`, at the cost of a status an agent has to learn for one case. `source` and `lookup_failed` already say it, so the fallback uses `unchanged`.
