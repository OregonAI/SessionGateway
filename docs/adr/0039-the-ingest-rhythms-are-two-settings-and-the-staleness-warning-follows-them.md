---
status: accepted; supersedes the schedule of ADR-0005 in part (its 15-minute increments and its nightly full pull; the live lookups, the two-pull rule and the replaced files stand)
---

# The ingest rhythms are two settings, and the staleness warning follows them

ADR-0005 fixed one rhythm: an increment every 15 minutes on days the Session meets, and a full pull every night. A deployment that does not need that rhythm, or that must not make that many requests, had no way to say so, and a server could not tell whether an index that had not changed for a day was a quiet Session or a worker that had stopped. The owner decided on ticket #17 (2026-10-31) that both rhythms are configuration. The Acceptable Use Agreement is unchanged: a full refresh only "once per day after business hours between 5:00 pm-6:00 am Pacific Time", increments "as often as needed".

## The two settings

Both are read through the config schema, by the worker and by the server (the server needs them for the staleness warning), and an unset variable takes its default. A value that is not listed stops the start-up, naming the variable and not its value.

| Setting | Values | Default |
|---|---|---|
| `INGEST_INCREMENTS` | `off`, `daily`, `15min` | `daily` |
| `INGEST_FULL_PULL` | `nightly`, `weekly`, `monthly` | `weekly` |

- **`daily`:** one increment a night, inside 5 pm to 6 am Pacific, on the nights the full pull does not run.
- **`15min`:** an increment every 15 minutes from 6 am to 10 pm Pacific, on days the Session meets.
- **`off`:** no increment.
- **The full pull** always runs inside 5 pm to 6 am and at most once a day. `weekly` and `monthly` name the day too: **`weekly` is Sunday, `monthly` is the 1st**. `nightly` is every day.

## When things run: one pure function

`whatRunsAt(time, settings, what the Session has scheduled)` in `ingest/schedule.ts` returns an increment, the full pull, or nothing, each with a `slot` that names the occurrence (one night, one quarter hour). It reads the Pacific wall clock only, so a daylight-saving change moves no window. The loop (`ingest/loop.ts`) wakes on the quarter hours, calls it, and runs what is due once for each slot; it has no rule of its own, and the clock and the sleep are passed in.

- **A night belongs to the date it ends on.** The night that ends on Sunday is 5 pm Saturday to 6 am Sunday.
- **The full pull runs from midnight to 6 am of its date.** It is the small hours so that it can fall only once on any calendar date, whenever the worker started or restarted (the agreement's "once per day"), and a worker restarted in the night finds from the database that the slot has run. Under `15min` the evening increments (until 10 pm) therefore never collide with it.
- **`daily` increments run in the night windows that are not full-pull nights**, from 5 pm to 6 am, once for each night (the first wake in the window; a worker that starts at 3 am runs the night's increment then). With `nightly` every night is a full-pull night, so `daily` runs none.
- **`15min` increments run on a day the Session meets.** That is a day with a committee meeting or a floor convening (ConveneTimes) scheduled, or any weekday while the Session is in progress. The function takes both facts as input. **The worker passes only the committee meetings the index holds**: it reads neither ConveneTimes nor LegislativeSessions yet, so a floor-only day and "in progress" are not seen (a gap reported on the ticket).
- **A run that fails is not run again in its slot.** The loop writes the failure to stderr and goes on; the next slot tries again. A failed full pull therefore waits for its next night, which keeps the full pull to one attempt a day.
- **`ingest.ts --once` runs one full pull at once and exits.** It is how the first pull is made, since an increment needs a full pull before it, and how an operator pulls by hand; it ignores the window, as before, so the operator keeps to it.

## What an increment does and moves

An increment reads, for each set the full pull reads, the rows with `CreatedDate gt X or ModifiedDate gt X`, where X is the start of the latest run (full pull or increment) less two hours, and stores them as the full pull stores its rows. Legislators and Committees are small and the rest resolve against their names, so it reads them whole. A document a new row links is fetched during the increment, once, as the full pull does.

- **It is not a complete pull.** It writes no `feed_pull` and no `feed_row`, so it counts for nothing in the two-pull rule (ADR-0030, "What ticket #17 inherits"): a row a complete pull has seen keeps the number of the latest complete pull that listed it, and a row first seen by an increment has no listing row, which the tools read as listed, not yet checked (`last_listed_at: null`). It never marks anything no longer listed, and it adds to the listing of Versions without replacing it.
- **It moves the index's as-of time.** `as_of` in every result is the start of the latest update, a full pull or an increment, because the index holds rows OLIS wrote up to then. `session_overview` also reports `last_increment`, the start of the last increment (null while there has been none).
- **It does not write the build report**, which describes the full pull. A document an increment could not fetch is tried again by the next full pull, not by the next increment (its row has not changed).
- **A short read stores nothing** and throws, as a full pull's does.

## The delays this makes

- **A row OLIS stops listing leaves search after two complete full pulls**, as ADR-0030 says: about two weeks under the default `weekly`, two nights under `nightly`, two months under `monthly`. Increments do not shorten it.
- **A change to an existing row of MeasureDocuments or MeasureAnalysisDocuments waits for the next full pull.** Both sets have a null `ModifiedDate` on every row (olis-odata.md section 6), so an increment finds only new rows, by `CreatedDate`. The same holds for any row of another set whose `ModifiedDate` OLIS leaves null. A file replaced behind an unchanged row was never signalled by OLIS and is not found by either.
- **A new document is searchable by the next increment**: within the quarter hour on a meeting day under `15min`, by the next morning under `daily`, and only after the full pull under `off`.

## The staleness warning

Every tool result carries one more block of text, after the tool's own, when the index is too old by the configured rhythm. No output schema changes. `stalenessAt` (in `ingest/schedule.ts`, beside the schedule it follows) decides; the server words it.

- **`15min`:** the latest update is more than two hours old, during working hours (6 am to 10 pm on a day the Session meets).
- **`daily`:** the latest update is older than the start of the last night window that has closed: a night was missed. A night still open is not missed.
- **`off`:** the last full pull is older than the start of the last full-pull night that has closed: a scheduled full pull was missed. An increment does not clear it.

## Considered options

- **Keep ADR-0005's fixed rhythm.** The deployment on two shared cores (ADR-0007) cannot always afford a 15-minute increment, and cannot say so.
- **The staleness rule in the server alone.** The rule is the schedule read backwards ("older than the last window"); two copies of the windows would drift. The server imports the one pure module.
- **A warning field in each output schema.** Eight tools would each grow a field; a block of text reaches an agent the same way and changes none of them.
- **The full pull anywhere in the night.** A pull at 3 am and the next at 5 pm fall on one calendar date, which "once per day" can be read to forbid.

## Consequences

`config` adds the two variables for the worker and the server. `ingest` gains two entry points, `schedule.ts` and `loop.ts`, and `runIncrement`; `mcp-server` imports `ingest/schedule.ts` (pure, importing only `config` and `time`). `database` gains the `increment_state` table, created empty when the worker opens a file, `lastRuns`, `meetingDays` and `recordIncrement` on the writer, and `lastFullPull`, `lastIncrement` and `meetingDays` on the reader. FloorLetters, which carry no dates, are not read (ticket #64).
