---
status: accepted; replaces the note in ADR-0039 that the worker sees only committee-meeting days (the rest of ADR-0039 stands); the bullet "A null `EndDate` means in progress from the begin date on" is superseded by ADR-0043
---

# The days the Session meets come from committee meetings, floor convenings and the Session's dates

ADR-0039 defined a day the Session meets as a day with a committee meeting or a floor convening (ConveneTimes) scheduled, or any weekday while the Session is in progress, and noted that the worker passed only the committee meetings the index holds. A floor-only day, or a weekday in session with no committee meeting, ran no `15min` increment, and the staleness warning's `15min` rule did not count it as a working day. Ticket #67 (owner, 2026-10-31) reads the two missing inputs.

## Decision

- **A full pull reads two more whole sets and counts them.** `ConveneTimes` and `LegislativeSessions` are read for the Session with `/$count` and `$inlinecount` like every other set. A short read of either refuses the pull, and `build-report.json` lists them with the others.
- **They are stored with the feed and listed under the two-pull rule.** Each convening is kept by its time and Chamber (the feed's key) and the Session's row by its key, and both are tracked in `feed_row`, so the report shows how many rows of each are listed and how many are no longer listed (ADR-0030). The rule has no effect beyond the report: no tool shows either set, and a convening that is no longer listed stays a meeting day, as a committee meeting that is no longer listed stays one. Nothing is deleted (ADR-0005).
- **A meeting day is the union.** `sessionScheduleOf` in `ingest/schedule.ts` builds the schedule from the days with a committee meeting, the days with a convening (each Pacific date of a `SessionDate`) and the Session's begin and end dates. The Session is in progress on a Pacific date from the begin date to the end date, both included; a weekday of a Session in progress is a meeting day and a Saturday or Sunday is not. The worker's loop and the server's staleness rule both build the schedule this way.
- **A null `EndDate` means in progress from the begin date on.** The feed leaves `EndDate` null for many Sessions, 2025R1's included (`docs/research/olis-odata.md` section 3), and says no more. Reading null as "never in progress" would make the in-progress rule dead for exactly the Sessions it is for, so null is read as open-ended. The cost is that a Session whose row is never given an end date keeps every weekday a meeting day under `15min`, which is more increments than needed and no more than the Acceptable Use Agreement allows ("as often as needed"). A deployment that does not want them sets `daily`. If the owner reads null the other way, `sessionScheduleOf` is the one place to change.
- **An increment does not read these sets.** They are read by the full pull and are as old as it is: under `weekly`, a convening scheduled after Saturday's pull is not seen until the next one. A floor convening on a weekday is covered by the in-progress rule; the days missed are a convening on a weekend or in the interim, scheduled after the last full pull. Reading both sets in every increment would add four requests (two counts, two pages) to each quarter hour to close that gap; the owner can ask for it.

## Considered options

- **Read the sets in every increment.** Fresher, at four requests every quarter hour on every meeting day. Not chosen: the ticket asks for the full pull, and the gap is a convening added late on a day with no committee meeting.
- **Treat a null `EndDate` as not in progress.** Rejected above.
- **Keep the days in the committee-meeting query.** One query for the three inputs would hide that the Session's dates are not days. The schedule is built from three inputs because ADR-0039 already made them the function's input.

## Consequences

`olis-client` gains `readConvenings` and `readSessionDates`; `database` gains the `convening` and `session_dates` tables (created empty when the worker opens a file, so an index made before this ticket has none until its next full pull, and then behaves as before), `conveneDays` and `sessionDates` on the writer and the reader, and the two sets in the listing. No package and no entry point is added, so ADR-0009 stands. `GLOSSARY.md` defines the Meeting day with these three inputs.
