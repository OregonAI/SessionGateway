# The 2026R1 backfill: what the run measured (ticket #24)

Run 2026-11-02 18:39 to 2026-11-03 23:31 Pacific on the GPU desktop (ADR-0007, ADR-0046), recorded 2026-11-03. The steps to run it again are in the README ("Rebuilding a Session: the backfill").

Labels used below:
- **verified**: read from a file the run left, or a query of the finished database (a copy of `index.db`, opened read-only).
- **local measurement**: a number I measured on the GPU desktop after the run, with the method stated.
- **inferred**: my reading of verified evidence.

The run's own files (`build-report.json`, `unresolved-legislator-codes.json`, `time-1.txt`, `time-2.txt`, `progress.csv`, `runs.log`, `RESULTS.md`) are on the owner's desktop and are not committed. The finished database is not committed either (#24, Delivery).

## 1. The run

| Item | Value | Status | Source |
|---|---|---|---|
| Commit | `946f61d` (main after #55), both runs | verified | `runs.log` |
| Settings | `SESSION_KEY=2026R1`, `MODEL_THREADS=8`, `STATUTES_AFFECTED_TABLE_URL=https://www.oregonlegislature.gov/AutoPubs/artables2026R1.pdf`, `ingest.ts --once` | verified | `runs.log`, kit `run.sh` |
| Run 1 | 2026-11-02 18:39:07 to 2026-11-03 05:50:10 Pacific; wall 11:11:03; user 66,258.61 s, system 130.69 s, 164% CPU; max RSS 698,716 KB; exit 1 | verified | `runs.log`, `time-1.txt` |
| Run 1's end | Stopped by the kit's watchdog with SIGTERM at 05:50 (the window closes at 06:00). The worker died of an uncaught `AbortError`, which was ticket #113, fixed by #114: a stop on SIGTERM now exits 0. The 27,094 documents it had stored were all kept. | verified | `runs.log`, `ingest-1.log`, `gh issue view 113` |
| Run 2 | 2026-11-03 17:29:52 to 23:31 Pacific; wall 6:02:02; user 31,640.25 s, system 63.68 s, 145% CPU; max RSS 880,232 KB; exit 0 | verified | `runs.log`, `time-2.txt` |
| Total run time | **17 h 13 min 05 s** of worker wall time (1,033.1 minutes); 98,093 s (27.2 hours) of CPU time, user and system. The calendar span is 28 h 52 min, with 11 h 40 min between the runs. | verified (sums of the two files) | `time-1.txt`, `time-2.txt` |
| Stored before run 2 | 27,094 documents; run 2 stored 12,439 more | verified | `runs.log`; `retrieved_at` of the `document` table split at 17:29:52 |
| Snapshot | ERF commit `6c41efefb5683a35437c9db6baf235c2051cef4b` (commit date 2026-10-31T07:13:00-07:00): 231 Agencies, 39,002 ORS sections | verified | `data/snapshot.json` (`version.commit`), `RESULTS.md` |
| Database | 344,821,760 bytes: **0.34 GB** (329 MiB), schema version 1 (`PRAGMA user_version`) | verified | `index.db` |

## 2. Counts

| Item | Value | Status | Source |
|---|---|---|---|
| Entity sets | All 18 match OLIS `$count` (the `pull.entity_sets` list: counted = read, `complete: true`) | verified | `build-report.json`, `RESULTS.md` |
| Document rows linked | 39,533 stored + 90 not fetched = 39,623. This is more than the 39,297 of `docs/research/olis-odata.md` section 7, which sums the six document-linking sets only; the worker also stores 326 agendas, 279 recording logs, 207 printed amendments and the versions and analyses the feed links (kinds below). | verified | `document` table; `build-report.json` |
| Documents stored, by kind | testimony 33,145; exhibit 2,885; analysis 955; proposed_amendment 910; version 663; agenda 326; recording_log 279; printed_amendment 207; floor_letter 163 | verified | `document` table |
| Text | 98,714,247 characters | verified | `RESULTS.md` |
| Passages | **65,913** (`passage` table): 50,065 from the 27,094 documents run 1 stored and 15,848 from the 12,439 run 2 stored | verified | `passage` joined to `document.retrieved_at` |
| Vectors | **60,022** rows in `passage_vector`, all for `Xenova/bge-small-en-v1.5@ea104dacec62\|q8\|cls\|l2\|i-cdf0ab26`. A vector is kept once for each distinct passage text: the passages hold 61,483 distinct `text_hash`es, so 1,461 are keyword-only (inferred: the rest of the difference). | verified; the 1,461 inferred | database |
| The report's `search_index` | `passages: 15848`, `embedded: 14810`, `reused: 585`, `keyword_only_passages: 453`. This is **run 2's pull only**: the 15,848 equals the passages of the documents run 2 stored exactly, and run 1 was stopped before its pull finished, so it wrote no report. The report is not a count of the database; the table counts above are. | verified | `build-report.json`; `passage` split at 17:29:52 |
| No text layer | 651: testimony 465, floor_letter 163, exhibit 19, proposed_amendment 4 (their ids are `posting-2026r1-<n>`). The report's `documents_without_text_layer` and the database agree on all 651. | verified | `build-report.json`, `document` table |
| Not fetched | 90: 56 files of zero bytes, 2 with "Invalid PDF structure", 32 timeouts after 3 attempts. By kind: testimony 84, exhibit 5, version 1. | verified | `documents_not_fetched` |
| Unresolved Legislator Codes | 0 (`unresolved_legislator_codes: []`) | verified | `unresolved-legislator-codes.json` |
| Statutes Affected Table | `outcome: loaded`, `held: true`, 2,893 entries, 0 unread lines, 89 lone-E entries, 0 of them with an E-Engrossed Version, 0 entries from a previous Session | verified | `statutes_affected_table` in the report |

The Statutes Affected Table's layout gave the parser nothing it could not read (0 unread lines), so there is no table quirk to report.

### The Floor Letters

All 163 of 2026R1's Floor Letters have no text layer (163 of 163, `FloorLetterId` 4563 to 4725, 1 to 10 pages each; none has a passage). 2025R1 cannot be compared offline: only letter 4220 of its 322 rows was ever fetched (`docs/research/olis-odata.md` section 4), and the local OLIS cache holds the feed rows and no letter files. One of one sampled is a scan there, so the two Sessions agree on everything checked, which is little. The extractor reports no text layer when it finds only whitespace (`src/packages/pdf-text/lib/extract.ts`), so scans, photographs and text drawn as outlines look the same to it. Nobody has opened a 2026R1 letter. The follow-up ticket drafts say so.

### What happens to the 90 documents not fetched

A document the index does not hold is fetched again by every full pull (`storeLinkedDocuments`, `src/packages/ingest/index.ts`: it skips only ids already stored), three attempts of 60 seconds each. The 32 timeouts can heal on the deploy box's next full pull, whose rhythm is `INGEST_FULL_PULL` (weekly by default, nightly if set; ADR-0039). The 58 empty or invalid files will be tried again and fail again unless OLIS replaces them. An increment does not retry them: it fetches only rows created or changed since its last run. Until a file is held, its Testimony row is still listed with `fetched: false` (ADR-0017).

## 3. The download rate

| Measure | Value | Status | How |
|---|---|---|---|
| Documents a minute, whole build | **38.3** (39,533 documents in 1,033.1 minutes of worker wall time) | verified arithmetic | `time-1.txt` + `time-2.txt`; document count from the `document` table |
| Run 1 | 40.4 a minute (27,094 in 671.05 minutes) | verified arithmetic | |
| Run 2 | 34.4 a minute (12,439 in 362.03 minutes). Each run begins with a full pull of the feed before any file is fetched. | verified arithmetic | |
| Pace through a night | 25 to 29 a minute in the first four hours of each run, 46 to 51 a minute after | verified (four-hour windows of `progress.csv`); the cause is not known | `progress.csv` |
| Text a minute | 95,553 characters | verified arithmetic | 98,714,247 / 1,033.1 |
| Database bytes a minute | 333,779 (344,821,760 / 1,033.1) | verified arithmetic | |
| **Bytes downloaded a minute** | **Not recorded.** The worker hashes each file's bytes and keeps the hash, the text and the page count; it keeps neither the PDFs nor their lengths, and the `document` table has no size column. The kit's `progress.csv` has the database's size, not the download's. The worker could keep the length (it holds `fetched.bytes` when it hashes), but this run did not. | verified (schema; `src/packages/ingest/index.ts`) | `document` columns: id, node_id, session_key, kind, label, source_url, retrieved_at, content_hash, text_hash, page_count, has_text_layer, posted_at, analysis_version_label, analysis_is_minority, text |

The kit's `summary.sh` printed 22.8 documents a minute. That divides 39,393 documents by the 1,729 minutes between the first and last sample of `progress.csv`, which includes the 700.75-minute gap between the runs (the runs were stopped by day). The divisor that is the work is the two runs' wall times. The kit's other mistake is its Passages line, which printed "see build-report.json" because the report's `search_index` is run 2's pull only. Both are the kit's, which is not committed; the rate and passage counts here replace its.

## 4. The embedding on the CPU

The worker embeds each passage inline, one passage at a time, so the run did not time the embedding by itself. I timed it afterwards.

| Item | Value |
|---|---|
| CPU | Intel(R) Core(TM) Ultra 7 265F, 20 cores, 1 thread each, under WSL2 (`lscpu`, `nproc` = 20); 19 GB RAM |
| Load before the run | 0.12 (`uptime`), so the machine was quiet; the benchmark was run once |
| Method | A script outside the repo loads the embedder as `src/bin/ingest.ts` does (`loadOnnxEmbedder` with `intraOpThreads` = `MODEL_THREADS`, the pinned model directory, the committed lock file) and calls `embedPassages` on passage texts read from a copy of the database. It takes one passage for each distinct `text_hash` that has a vector, shuffles them with a fixed seed (20261103, a linear congruential generator), embeds 20 as a warm-up and times the next 2,000. The text of a passage is the slice of its document's text at the passage's offsets; the slice's sha256 equalled the stored `text_hash` for all 2,020. |
| Sample | 2,000 passages; mean 1,498 characters and 326 tokens |
| MODEL_THREADS = 8 (the run's setting) | 32.83 s wall, 269.1 s CPU (8.2 cores busy): 16.4 ms a passage, 60.9 passages a second |
| Extrapolated to 60,022 passages | **985 s wall: about 16.4 minutes, using 8 threads; 2.24 hours of CPU** |
| MODEL_THREADS = 1 (the deploy box's setting), 300 passages | 21.27 s wall, 22.1 s CPU: 70.9 ms a passage, 14.1 passages a second. Extrapolated to 60,022: 4,256 s, **1.18 hours**, 1.23 hours of CPU |

The benchmark is a lower bound for what the run spent: it embeds a sample in one burst, with nothing else running.

The build as a whole took 17.2 hours of wall time and 27.2 hours of CPU time. Embedding the 60,022 passages is about 16 minutes of that wall time (1.6%) and 2.2 CPU-hours (8%) by this measurement. What the other 25 CPU-hours went to was not profiled (PDF text extraction, the SQLite writes with their FTS indexes and one request at a time are the candidates; inferred).

## 5. Does the embedding warrant a GPU path?

ADR-0046 sets no threshold: it says a GPU path is built "when that time or the hearing-video work calls for it". On this measurement the time does not call for it. A whole Session's vectors cost about 16 minutes of the desktop's 20 cores, or about 1.2 hours on one core, inside a run that took 17 hours and is limited by fetching documents one at a time. A GPU path would also need onnxruntime-node's install script, which ADR-0026 denies. No GPU-embedding ticket was opened. The hearing-video transcription (ADR-0007) is a separate case with its own reasoning.

## 6. Follow-ups

| List | Result | Ticket |
|---|---|---|
| Unresolved Legislator Codes | empty | none |
| Documents with no text layer | 651 | drafts: Floor Letters (163 of 163); the other 488 (testimony 465, exhibit 19, proposed amendment 4) |
| Documents not fetched | 90 | draft: 58 empty or invalid files; the 32 timeouts are left to the next full pull |
| Statutes Affected Table | read, 0 unread lines | none |
| Embedding time | 16.4 minutes on the desktop's CPU | none (section 5) |

The drafts are for the owner to open. They are not in the repository.
