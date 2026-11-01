---
status: accepted; completes the replaced-files rule of ADR-0005 (each night about 200 random documents are fetched again and their hashes compared)
---

# The nightly hash sample reports a replaced file and never stores it

ADR-0005 treats a fetched document as unchanging and says that each night about 200 random documents are fetched again and their hashes compared, "to catch a file replaced behind the same URL". Neither ADR-0005 nor ADR-0039 says when in the night that happens, how many documents it is, what a mismatch does, or what a document OLIS will not give does. Ticket #20 builds it. The Acceptable Use Agreement allows "on-demand queries as needed" but a full refresh only between 5 pm and 6 am Pacific, so the sample keeps to that window, which the owner confirmed on the ticket (2026-10-31).

## Decision

- **When.** Every night, whatever `INGEST_INCREMENTS` and `INGEST_FULL_PULL` say, once a night, inside 5 pm to 6 am Pacific, and never in the hours the full pull holds (midnight to 6 am of a full-pull date, ADR-0039). A night that ends on a full-pull date has the sample in its evening, 5 pm to midnight; any other night has all of it. A night belongs to the date it ends on, as in ADR-0039, and its slot is `hash-sample-<date>`. The pure `hashSampleAt` and `hashSampleDeadline` in `ingest/schedule.ts` say so, and `ingest/tests/schedule.test.ts` has their table (rows at the 5 pm and 6 am edges, on full-pull nights and others, under each `INGEST_FULL_PULL` value, and across both daylight-saving changes). They are functions beside `whatRunsAt` and not part of its result, because one night can hold an increment and the sample, and a single `Due` cannot say both.
- **No overlap.** The loop runs one thing at a time, and the sample is given a deadline: midnight on a full-pull night, otherwise 6 am. A document is not fetched at or after the deadline, and a fetch still going then is stopped (an abort timed to the deadline); the documents left are reported as not checked. The loop judges whether the sample is due, and its deadline, at the time the sample would begin, after the night's increment or full pull.
- **How many.** `INGEST_HASH_SAMPLE_SIZE`, a whole number of at least 1, read through the config schema by the worker: 200 unless set. A value that is not a whole number of at least 1 stops the start-up, naming the variable and not its value. A sample is the whole index when it holds fewer.
- **Which.** A draw without repeats from the stored documents, with the randomness the entry script passes (`Math.random`), so a test can choose them.
- **What a mismatch does.** It is reported and stored nowhere else. It stays in the report on later nights until a night compares that document again: the report carries forward the mismatches tonight's draw did not compare (keeping their time), and drops one when the file hashes as stored again. The stored document, its text and its hash stay as fetched (ADR-0002): the index does not follow a file that changed silently, and what a replaced file means is for the operator to judge. A mismatch carries the document id, `source_url`, the stored hash, the new hash and when it was checked. The worker also logs it as a warning line. Matching hashes report nothing: the report lists no mismatch.
- **A document OLIS will not give** (a 404, a timeout after the usual retries, the window closing) is reported as not checked, with the reason, and is not a mismatch.
- **Where the operator reads it.** `hash-sample-report.json` beside the database, written whole after every sample, empty or not (as `build-report.json` is written): the night's start, the configured size, how many documents were drawn and compared, the mismatches and the documents not checked. Its start time is also how a worker that restarts in the night knows the night's sample has run.

## Considered options

- **Replace the stored document on a mismatch.** It would make the index follow OLIS, but the index would change without a full pull's checks, and the stored hash is the evidence that the file moved. ADR-0002 and ADR-0005 treat a fetched document as unchanging.
- **Count it against `Due`.** One result per time cannot hold an increment and the sample at 5 pm.
- **The sample anywhere in the night.** It would fall in the full pull's hours on a full-pull night.
- **Record the night in the database.** The report file already carries the start time and needs no new table.

## Consequences

`config` adds `INGEST_HASH_SAMPLE_SIZE` for the worker. `ingest` gains `runHashSample` (`index.ts`) and `hashSampleAt` and `hashSampleDeadline` (`schedule.ts`); the loop calls them after the night's increment. `olis-client` gains `downloadStoredDocument`, and `database` gains `documentsToSample` on the writer. No package or entry point is added. A file replaced behind a URL is found within a night only if it falls in the night's draw: 200 of 278 documents in a small Session, about 200 of several thousand in a large one, so a replaced file in a large Session may go unseen for many nights.
