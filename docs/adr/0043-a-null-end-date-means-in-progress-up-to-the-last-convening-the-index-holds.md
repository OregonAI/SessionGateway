---
status: accepted; supersedes ADR-0042's bullet "A null `EndDate` means in progress from the begin date on" (the rest of ADR-0042 stands)
---

# A null EndDate means in progress up to the last convening the Index holds

ADR-0042 read a null `EndDate` on the Session's LegislativeSessions row as "in progress from the begin date on", with no end. 2025R1's real row has `EndDate` null, so under `INGEST_INCREMENTS=15min` every weekday from 2025-01-13 on was a meeting day indefinitely, and the staleness warning's `15min` rule counted each one as a working day, long after sine die. The owner decided on 2026-11-01 (ticket #74) to bound it by the floor calendar.

## Decision

- **A null `EndDate` ends at the last convening the Index holds.** The Session is in progress from `BeginDate` to the later of `BeginDate` and the last Pacific date of a `SessionDate` in the ConveneTimes the Index holds, both days included. With no convening held, it is in progress on `BeginDate` only.
- **A non-null `EndDate` is read as before**: from the begin date to the end date, both included. A convening after it is a meeting day of its own but does not stretch the Session.
- **The other two inputs are unchanged.** A day with a committee meeting or a convening is a meeting day whatever the Session's dates are.
- **`sessionScheduleOf` is the one place that reads null**, as ADR-0042 said it would be. The schedule it returns always carries an end date, so the worker's loop and the server's staleness rule, which both build it this way, read no null.

Why: during a live Session the floor calendar is published ahead of today, so the weekdays in session up to the last scheduled convening stay meeting days. After sine die the last convening is the last floor day, so the extra increments stop without waiting for the feed to fill in `EndDate`.

## Considered options

- **Not in progress until an `EndDate` appears.** Rejected, as ADR-0042 rejected it: the in-progress rule would be dead for exactly the Sessions it is for.
- **Keep ADR-0042's open-ended reading.** Rejected by the owner: it runs `15min` increments on every weekday for ever, and the staleness warning goes off on weekdays when nothing can change.

## Consequences

The convenings are read only by the full pull (ADR-0042), so the end moves when a full pull sees a later convening: under `weekly`, a convening scheduled after Saturday's pull extends the Session from the next pull on. Weekdays between the last convening held and one added later run no increment in the meantime unless a committee meets. A cap from the constitutional Session length is not applied.
