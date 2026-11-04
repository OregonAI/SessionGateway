# The 2026R1 backfill: what the run measured (ticket #24)

Run 2026-11-02 18:39 to 2026-11-03 23:31 Pacific on the GPU desktop (ADR-0007, ADR-0046), recorded 2026-11-03 and reviewed 2026-11-04. The steps to run it again are in the README ("Rebuilding a Session: the backfill").

Labels used below:
- **verified**: read from a file the run left, from the code, or from a committed document, which the row names.
- **local measurement**: a number I measured on the GPU desktop after the run, with the method stated. Every query of the finished database is one: it ran against a copy of `index.db`, opened read-only. The embedding benchmark (section 4) is one too.
- **inferred**: arithmetic over the numbers above, or my reading of them.

The run's own files (`build-report.json`, `unresolved-legislator-codes.json`, `time-1.txt`, `time-2.txt`, `progress.csv`, `runs.log`, `RESULTS.md`) are on the owner's desktop and are not committed. The finished database is not committed either (#24, Delivery). Every row says which of them it was read from, and each document is also named by its OLIS `source_url` in the follow-up tickets.

## 1. The run

| Item | Value | Status | Source |
|---|---|---|---|
| Commit | `946f61d` (main after #55), both runs | verified | `runs.log` |
| Settings | `SESSION_KEY=2026R1`, `MODEL_THREADS=8`, `STATUTES_AFFECTED_TABLE_URL=https://www.oregonlegislature.gov/AutoPubs/artables2026R1.pdf`, `ingest.ts --once` | verified | `runs.log`, kit `run.sh` |
| Runs | **Two**, each a full pull the owner approved: the ticket asked for one, and the owner asked for run 2 ("Can you start the load?", 2026-11-03) after run 1 was stopped at the end of its night. The build took two owner-approved full pulls on two nights. | verified | `runs.log`, the owner's message of 2026-11-03 |
| Run 1 | 2026-11-02 18:39:07 to 2026-11-03 05:50:10 Pacific; wall 11:11:03; user 66,258.61 s, system 130.69 s, 164% CPU; max RSS 698,716 KiB (0.72 GB); exit 1 | verified | `runs.log`, `time-1.txt` |
| Run 1's end | Stopped by the kit's watchdog with SIGTERM at 05:50 (the window closes at 06:00). The worker died of an uncaught `AbortError`, which was ticket #113, fixed by #114: a stop on SIGTERM now exits 0. The 27,094 documents it had stored were all kept. | verified | `runs.log`, `ingest-1.log`, `gh issue view 113` |
| Run 2 | 2026-11-03 17:29:52 to 23:31 Pacific; wall 6:02:02; user 31,640.25 s, system 63.68 s, 145% CPU; max RSS 880,232 KiB (0.90 GB, 0.84 GiB); exit 0 | verified | `runs.log`, `time-2.txt` |
| Run 2's date | Run 2 started at 17:29 on 2026-11-03, the same calendar date on which run 1 was stopped (05:50). ADR-0039 says that "a pull at 3 am and the next at 5 pm fall on one calendar date, which 'once per day' can be read to forbid", and run 2 is that case. That is a reading ADR-0039 avoids by starting a full pull between midnight and 6 am of its date, so later reruns start after midnight (README). | verified | `runs.log`; ADR-0039, "When things run" |
| Total run time | **17 h 13 min 05 s** of worker wall time (1,033.1 minutes); 98,093 s (27.2 hours) of CPU time, user and system. The calendar span is 28 h 52 min, with 11 h 40 min between the runs. | inferred (sums of the two `time` files) | `time-1.txt`, `time-2.txt` |
| Stored before run 2 | 27,094 documents; run 2 stored 12,439 more | verified (27,094, `runs.log`); local measurement (12,439: `retrieved_at` of the `document` table split at 17:29:52) | `runs.log`; database |
| Snapshot | ERF commit `6c41efefb5683a35437c9db6baf235c2051cef4b` (commit date 2026-10-31T07:13:00-07:00): 231 Agencies, 39,002 ORS sections | verified | `data/snapshot.json` (`version.commit`), `RESULTS.md` |
| Database | 344,821,760 bytes: **0.34 GB** (329 MiB), schema version 1 (`PRAGMA user_version`), after a checkpoint of its WAL | local measurement | the database copy |

## 2. Counts

| Item | Value | Status | Source |
|---|---|---|---|
| Entity sets | All 18 match OLIS `$count` (the `pull.entity_sets` list: counted = read, `complete: true`) | verified | `build-report.json`, `RESULTS.md` |
| Document rows linked | 39,533 stored + 90 not fetched = 39,623. This is 326 more than the 39,297 of `docs/research/olis-odata.md` section 7, which sums six document-linking sets; the 326 are exactly the agendas (one for each of the 326 CommitteeMeetings, a seventh set that links a file). Every other kind sits inside one of the six sets, as the next table shows. | local measurement (39,533); verified (90); inferred (the sum and the gap) | `document` table; `build-report.json` |
| Documents stored, by kind | testimony 33,145; exhibit 2,885; analysis 955; proposed_amendment 910; version 663; agenda 326; recording_log 279; printed_amendment 207; floor_letter 163 | local measurement | `document` table |
| Text | 98,714,247 characters (`sum(length(text))`; it equals `RESULTS.md`) | local measurement | `document` table |
| Passages | **65,913** (`passage` table): 50,065 from the 27,094 documents run 1 stored and 15,848 from the 12,439 run 2 stored | local measurement | `passage` joined to `document.retrieved_at` |
| Vectors | **60,022** rows in `passage_vector`, all for `Xenova/bge-small-en-v1.5@ea104dacec62\|q8\|cls\|l2\|i-cdf0ab26`. A vector is kept once for each distinct passage text: the passages hold 61,483 distinct `text_hash`es, and 1,461 of them have no vector (61,483 - 1,461 = 60,022). **Both units:** 1,522 passages (1,461 distinct texts) have no vector. They are the keyword-only passages. | local measurement | `passage` left-joined to `passage_vector` on `text_hash` |
| The report's `search_index` | `passages: 15848`, `embedded: 14810`, `reused: 585`, `keyword_only_passages: 453`. This is **run 2's pull only**: its 15,848 equals the passages of the documents run 2 stored, and its 453 equals the passages of those documents that have no vector (a query of the database gives 453 passages, not distinct texts), both exactly. Run 1 was stopped before its pull finished, so it wrote no report; the other 1,069 of the 1,522 are run 1's. The report is not a count of the database; the table counts above are. | verified (the report); local measurement (the split) | `build-report.json`; `passage` split at 17:29:52 |
| No text layer | 651: testimony 465, floor_letter 163, exhibit 19, proposed_amendment 4 (the four have ids `posting-2026r1-<n>`). The report's `documents_without_text_layer` and the database agree on all 651. | verified (the report); local measurement (the database) | `build-report.json`, `document` table |
| Not fetched | 90: 56 files of zero bytes, 2 with "Invalid PDF structure", 32 timeouts after 3 attempts. By kind: testimony 84, exhibit 5, version 1. | verified | `documents_not_fetched` |
| Unresolved Legislator Codes | 0 (`unresolved_legislator_codes: []`) | verified | `unresolved-legislator-codes.json` |
| Statutes Affected Table | `outcome: loaded`, `held: true`, 2,893 entries, 0 unread lines, 89 lone-E entries, 0 of them with an E-Engrossed Version, 0 entries from a previous Session | verified | `statutes_affected_table` in the report |

The Statutes Affected Table's layout gave the parser nothing it could not read (0 unread lines), so there is no table quirk to report (verified, the same report).

### Where the document rows are

Stored and not fetched, by the six sets of olis-odata section 7 and the seventh set (agendas). Counts of the sets are OLIS's `$count` of 2026-11-01 (verified, `docs/research/olis-odata.md` section 7; Testimony re-measured at 33,229) and the report's, which equal them. The split into kinds is a local measurement of the `document` table, with the not-fetched kinds from the report (inferred, the sum).

| Entity set | Rows | = stored + not fetched, by kind |
|---|---:|---|
| CommitteePublicTestimonies | 33,229 | testimony 33,145 + 84 |
| CommitteeMeetingDocuments | 3,169 | exhibit 2,885 + 5 = 2,890, and recording_log 279 |
| MeasureDocuments | 871 | version 663 + 1 = 664, and printed_amendment 207 |
| MeasureAnalysisDocuments | 955 | analysis 955 |
| CommitteeProposedAmendments | 910 | proposed_amendment 910 |
| FloorLetters | 163 | floor_letter 163 |
| **The six** | **39,297** | |
| CommitteeMeetings | 326 | agenda 326 |
| **All** | **39,623** | = 39,533 stored + 90 not fetched |

### The Floor Letters

All 163 of 2026R1's Floor Letters have no text layer (163 of 163, `FloorLetterId` 4563 to 4725, 1 to 10 pages each; none has a passage; local measurement, `document` table). 78 of the 163 titles are a bare 14-digit timestamp (for example `20260205090114`); the other 85 are words (local measurement, `label` of the `document` table). 2025R1 cannot be compared offline: only letter 4220 of its 322 rows was ever fetched, and it is a scan (verified, `docs/research/olis-odata.md` section 4), so the two Sessions agree on everything checked, which is little (inferred). The extractor reports no text layer when it finds only whitespace (verified, `src/packages/pdf-text/lib/extract.ts`), so scans, photographs and text drawn as outlines look the same to it. Nobody has opened a 2026R1 letter. The follow-up ticket drafts say so.

### What happens to the 90 documents not fetched

A document the index does not hold is fetched again by every full pull: `storeLinkedDocuments` skips only ids already stored, and it makes three attempts of 60 seconds each (verified, `src/packages/ingest/index.ts`). The rhythm of a full pull is `INGEST_FULL_PULL`, weekly by default and nightly if set (verified, ADR-0039). The 32 timeouts can heal on the deploy box's next full pull (inferred). The 58 empty or invalid files will be tried again and fail again unless OLIS replaces them (inferred). An increment does not retry them: it fetches only rows created or changed since its last run (verified, ADR-0039). Until a file is held, its Testimony row is still listed with `fetched: false` (verified, ADR-0017).

## 3. The download rate

| Measure | Value | Status | How |
|---|---|---|---|
| Documents a minute, whole build | **38.3** (39,533 documents in 1,033.1 minutes of worker wall time) | inferred | `time-1.txt` + `time-2.txt`; document count from the `document` table |
| Run 1 | 40.4 a minute (27,094 in 671.05 minutes) | inferred | |
| Run 2 | 34.4 a minute (12,439 in 362.03 minutes). Its first hour stored 3 documents (27,094 to 27,097 between 17:29:53 and 18:32:10, 0.05 a minute); from 18:32 to the end it stored 12,436 in about 299 minutes, 41.6 a minute. | inferred | `progress.csv` |
| Pace through a night | 25 to 29 a minute in the first four hours of each run, 46 to 51 a minute after | inferred (four-hour windows of `progress.csv`) | `progress.csv` |
| What the slow starts are | **Run 2's** slow start is its pull of the feed, which came before any file: for its first hour the count stood at 27,097 while the database grew by 20 MB in the first six minutes and then not at all (inferred from `progress.csv`; `ingest-2.log` is empty). **Run 1's** slow start is not explained: it stored 368 documents in its first five minutes, so its feed pull was not slow, and then about 16 a minute for the next 45 minutes (780 at 18:49 to 1,507 at 19:34), against 46 to 51 a minute later. | inferred; run 1's cause not known | `progress.csv` |
| Text a minute | 95,553 characters | inferred | 98,714,247 / 1,033.1 |
| Database bytes a minute | 333,779 (344,821,760 / 1,033.1) | inferred | |
| Pages a minute | 64.8 (66,893 pages in the `page_count` column / 1,033.1) | inferred | `document` table, local measurement |
| **Bytes downloaded a minute** | **Not measured. The owner waived it on 2026-11-04.** No size is kept: the worker hashes each file's bytes and keeps the hash, the text and the page count, it keeps neither the PDFs nor their lengths, and the `document` table has no size column. The kit's `progress.csv` has the database's size, not the download's. The worker could keep the length (it holds `fetched.bytes` when it hashes), but this run did not, and the PDFs are not stored to measure afterwards. The proxies above are the rate in documents (38.3 a minute), in pages (64.8) and in text (95,553 characters). | verified (schema; `src/packages/ingest/index.ts`) | `document` columns: id, node_id, session_key, kind, label, source_url, retrieved_at, content_hash, text_hash, page_count, has_text_layer, posted_at, analysis_version_label, analysis_is_minority, text |

The kit's `summary.sh` printed 22.8 documents a minute. That divides 39,393 documents by the 1,729 minutes between the first and last sample of `progress.csv`, which includes the 700.75-minute gap between the runs (the runs were stopped by day). The divisor that is the work is the two runs' wall times (inferred). The kit's other mistake is its Passages line, which printed "see build-report.json" because the report's `search_index` is run 2's pull only. Both are the kit's, which is not committed; the rate and passage counts here replace its.

## 4. The embedding on the CPU

The worker embeds each passage alone (a runner is never given a batch: `src/packages/embedder/lib/embedder.ts`), so the run did not time the embedding by itself. I timed it afterwards, on the GPU desktop, **once**. Every row of this table is a local measurement. Appendix A gives the method.

| Item | Value | Status |
|---|---|---|
| CPU | Intel(R) Core(TM) Ultra 7 265F, 20 cores, 1 thread each, under WSL2 (`lscpu`, `nproc` = 20); 19 GB RAM | local measurement |
| Load before the run | 0.12 (`uptime`), so the machine was quiet | local measurement |
| Runs of the benchmark | One run of each of the two settings below, so there is no spread to report. The 8-thread figure takes 2,000 timed passages and the 1-thread figure takes **300**. | local measurement |
| Sample | 2,000 passages; mean 1,498 characters and 326 tokens | local measurement |
| MODEL_THREADS = 8 (the run's setting) | 32.83 s wall, 269.1 s CPU (8.2 cores busy): 16.4 ms a passage, 60.9 passages a second | local measurement |
| Extrapolated to 60,022 passages | **985 s wall: about 16.4 minutes, using 8 threads; 2.24 hours of CPU** | inferred (the measurement scaled to 60,022) |
| MODEL_THREADS = 1 (the deploy box's setting), 300 passages | 21.27 s wall, 22.1 s CPU: 70.9 ms a passage, 14.1 passages a second. Extrapolated to 60,022: 4,256 s, **1.18 hours**, 1.23 hours of CPU | local measurement; the extrapolation inferred |

The benchmark is a lower bound for what the run spent: it embeds a sample in one burst, with nothing else running (inferred).

The build as a whole took 17.2 hours of wall time and 27.2 hours of CPU time (inferred, section 1). Embedding the 60,022 passages is about 16 minutes of that wall time (1.6%) and 2.2 CPU-hours (8%) by this measurement (inferred). What the other 25 CPU-hours went to was not profiled. The candidates are PDF text extraction, the SQLite writes with their FTS indexes, and one request at a time. A further candidate is the 8 intra-op threads of onnxruntime, which may spin between the per-passage calls while the worker fetches, extracts and writes; the benchmark calls one passage after another with no such gap, so it hides that cost (inferred). The 8% share may therefore be understated. The runs' mean CPU use, 164% and 145% of one core, is the kind of figure that spinning would raise (inferred).

### Appendix A: the benchmark's method

The two scripts (`bench.ts` for 8 threads and `bench1.ts` for 1 thread, the same but for `THREADS` and `N`) are **local only**: they are in the desktop's scratch folder `tmp/b24/` of the job that wrote this note, and are not committed. They read a copy of the finished database, read-only, and load the embedder as `src/bin/ingest.ts` does. Their method, with the parts that decide the numbers:

```ts
const THREADS = 8, N = 2000;           // bench1.ts: THREADS = 1, N = 300
const db = new DatabaseSync(<copy of index.db>, { readOnly: true });
// one passage per distinct text_hash that has a vector (what the worker embedded)
const rows = db.prepare(`select p.text_hash h, p.document_id d, p.start_offset s, p.end_offset e from passage p
  where p.id in (select min(p2.id) from passage p2 join passage_vector v on v.text_hash=p2.text_hash
                 group by p2.text_hash) order by p.id`).all();
// Fisher-Yates shuffle with a linear congruential generator, seed 20261103
// sample = the first N + 20 of the shuffled rows
// text = document.text.slice(start_offset, end_offset); its sha256 must equal the stored text_hash
const embedder = await loadOnnxEmbedder({ modelPath, lockPath: modelLockPath, intraOpThreads: THREADS });
await embedder.embedPassages(texts.slice(0, 20));      // warm-up, not timed
// timed: process.cpuUsage() and performance.now() around ONE call over the other N texts
await embedder.embedPassages(texts.slice(20));
```

The sha256 of the sliced text equalled the stored `text_hash` for all 2,020 sampled passages of the 8-thread run (0 mismatches). The 60,022 of the extrapolation is the number of vectors. The passages are timed in one call, back to back, which is the point made above about what the benchmark hides.

## 5. Does the embedding warrant a GPU path?

ADR-0046 sets no threshold: it says a GPU path is built "when that time or the hearing-video work calls for it". The owner decided on 2026-11-04 that it does not, and that **no GPU-embedding ticket is opened**: the embedding is about 16 minutes of a 17-hour run, and ADR-0046 sets no threshold. The measurement behind it: a whole Session's vectors cost about 16 minutes of the desktop's 20 cores, or about 1.2 hours on one core (section 4, inferred), inside a run that took 17 hours and is limited by fetching documents one at a time (inferred). A GPU path would also need onnxruntime-node's install script, which ADR-0026 denies (verified, ADR-0026). The hearing-video transcription (ADR-0007) is a separate case with its own reasoning.

## 6. Follow-ups

Each list that was not empty has a ticket, opened on 2026-11-04.

| List | Result | Status | Ticket |
|---|---|---|---|
| Unresolved Legislator Codes | empty | verified | none |
| Documents with no text layer | 651 | verified (the report) | #115: Floor Letters (163 of 163); #117: the other 488 (testimony 465, exhibit 19, proposed amendment 4) |
| Documents not fetched | 90 | verified (the report) | #116: 58 empty or invalid files; the 32 timeouts are left to the next full pull, and #116 checks them |
| Statutes Affected Table | read, 0 unread lines | verified | none |
| Embedding time | 16.4 minutes on the desktop's CPU | local measurement | none, by the owner's decision (section 5) |
| Bytes downloaded a minute | not measured | verified | none, waived by the owner (section 3) |
