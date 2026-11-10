# 2026R1 transcription runs: 268 committee recordings, ingested and copied to the deploy box with the gate off

Runs from 2026-11-08 to 2026-11-10 on the GPU desktop, under ticket #135 (parent spec #123), with path A (ADR-0051) and the owner's model pick, `large-v3-turbo` on the GPU (#133). Written 2026-11-10.

Labels:
- **verified**: read from a file, a log or the code, which the row names.
- **local measurement**: measured on this machine during these runs.
- **inferred**: my reading of the above. Not stated by any source.

## 1. The runs

The downloader is OregonAI/hearing-transcripts at 1862766 (`download --approved-run`), and the transcriber is the same tool's `transcribe --model large-v3-turbo --device cuda`. Every run was approved by the owner before it started. Requests went to Invintus only between 00:00 and 05:00 Pacific, each run stopped at the first refusal, and none was retried.

| Run | Night | Approved | Events requested / fetched | Requests to Invintus | Bytes | Audio hours | Halt |
|---|---|---|---|---|---|---|---|
| Canary | 2026-11-08, 00:07 to 00:23 | 2026-11-06 (moved from the missed 11-07 night; re-approved 2026-11-07) | 20 / 20 | 40 | 997,833,680 | 23.1 | none |
| Night 1 | 2026-11-09, 00:07 to 01:41 | 2026-11-08 | 124 / 124 | 248 | 6,002,700,688 | 138.95 | none |
| Night 2 | 2026-11-10, 00:07 to 01:41 | 2026-11-08 | 124 / 124 | 248 | 5,985,890,416 | 138.56 | none |
| **Total** | | | **268 / 268** | **536** | **12,986,424,784 (13.0 GB)** | **300.6** | **none** |

- **Sources** (**verified**): `fetched.jsonl` of each run's work folder gives the events and bytes. The run logs (`night.log`) give the times, the exit codes, and that no `HALTED.json` was written.
- **Request count** (**inferred**): the downloader keeps no request log, so the count is two per fetched event (`getDetailed`, then the MP3), as its code makes them.
- **Audio hours** (**verified**): from each transcript's own `audio.duration_seconds`.
- **Transcription** (**local measurement**): RTX 5060 Ti, float16. Wall time per audio hour, model load included: about 109 s for the canary, about 103 s for each night. #133 measured 98 s.
- **Files written** (**verified**): 268 transcript files, all valid against `docs/schemas/transcript-v1.schema.json` (sha256 d5fc48f8…), checked independently with `jsonschema`.
- **MP3s** (**verified**): none remains (`find … -name '*.mp3'` gives 0 in every run's folder). The transcripts sit on the desktop, behind the publication gate, and are not committed.

**Recordings missing: none.** The 279 Recording Logs give 268 distinct event IDs (`speaker_turn_index.event_id`), and all 268 are transcribed.
- 9 logs carry no event ID, so they have no recording to fetch: recording-log-2026r1-314824, 314969, 315084, 316067, 316216, 316221, 316222, 316234 and 316243, all House Revenue. They are the build report's `recording_log_gaps`.
- Two event IDs each serve two Meetings, which is why 268 files are stored as 270 transcripts: 2026021027 (HBH and SECBH on 2026-02-03) and 2026021046.

## 2. The ingest

The worker ingested the folder of 268 files into the desktop's 2026R1 database. The run was a full pull from the backfill kit at main 4d78bbe, with `TRANSCRIPTS_PATH` set: 2026-11-10, 06:41 to 08:39 Pacific, exit 0. The owner lifted the 00:00–06:00 OLIS window for this one pull. Its `build-report.json` (**verified**) has:

- `pull.complete`: true, as of 2026-11-10T06:41:30-08:00.
- `transcripts`:
  - `stored`: 270, and `ingested`: 270;
  - `refused`: 0, `unmatched_files`: 0, `file_no_longer_in_folder`: 0, `folder_error`: none;
  - 341,016 transcript passages, of which 261,567 were embedded (the rest reused a vector).
- `recording_log_refetches`: 9 attempted (the nine House Revenue logs with no links, re-fetched at every pull by ADR-0058's trigger), 0 failed.
- `documents_not_fetched`: 90. These are the same 58 empty or broken files and 32 timeouts as before (#116, #167).

The database is at schema v6, integrity "ok", 39,533 documents, 9,347 speaker turns, 270 transcripts (**verified**, read-only SQL).

### Drift

The build report lists 13 transcripts with a drift flag (ADR-0055). **No Meeting is flagged** (`meeting_flagged`: false for all 13). Each has 1 or 2 turns more than ten seconds from the log, and every median is under 1.4 s:

| Meeting | Event ID | Median s | Max s | Turns over 10 s |
|---|---|---|---|---|
| halnrw 2026-02-02 13:00 | 2026021029 | 0.38 | 10.6 | 1 |
| halnrw 2026-02-16 13:00 | 2026021166 | 0.44 | 13.0 | 2 |
| hbh 2026-02-03 13:00 | 2026021027 | 0.94 | 15.7 | 2 |
| hecdsb 2026-02-04 13:00 | 2026021019 | 0.60 | 10.5 | 1 |
| hrules 2026-02-17 08:00 | 2026021199 | 0.61 | 15.1 | 1 |
| jsrp 2026-02-09 13:00 | 2026021134 | 0.30 | 11.7 | 1 |
| jwmps 2026-02-03 08:00 | 2026021008 | 1.32 | 14.4 | 2 |
| jwmtr 2026-02-17 15:00 | 2026021187 | 1.19 | 10.8 | 1 |
| secbh 2026-02-03 08:00 | 2026021027 | 0.94 | 15.7 | 2 |
| secbh 2026-02-24 08:00 | 2026021252 | 0.56 | 10.0 | 1 |
| see 2026-02-23 15:00 | 2026021237 | 1.15 | 17.8 | 1 |
| sfr 2026-02-27 15:00 | 2026021307 | 0.68 | 12.0 | 1 |
| shdev 2026-02-03 15:00 | 2026021026 | 0.42 | 11.7 | 1 |

**Meetings with no log:** the build report lists Recording Logs that give no event ID (`recording_log_gaps`, the 9 above). It has no separate list of Meetings that have no Recording Log at all.

## 3. On the deploy box, gate off

The database was copied to the box on 2026-11-10 at 08:50 Pacific: sha256 b1274cbd…, 741 MB. The box's previous database is kept as `index.db.v6-before-135`. SessionGateway main 4d78bbe was deployed through the schema gate, and the box sets no `TRANSCRIPTS_PUBLISHED`, so the publication gate is off (ADR-0055).

Public checks (**verified**, at https://oregonai.morficflux.com/session-gateway/mcp, 2026-11-10):

- `search` "certified forester": the phrase is in 3 transcript passages and in no document (local FTS check). The search returns 20 results, of kinds `exhibit`, `printed_amendment`, `proposed_amendment`, `recording_log` and `version`. None is a transcript passage, none contains the phrase, and no machine-transcript notice is attached.
- `search` "Josh Nasbe SB 1518": returns his speaker turn, `recording-log-2026r1-313849` "HLWD 02-09-2026 (recording log)", snippet "00:03:40 Josh Nasbe, Legislative Director, Bureau of Labor and Industries", with no transcript text.
- Every answer carries "Note: this index is a static copy, as of its last full pull at 2026-11-10T06:41:30-08:00" (#119).

The transcripts are on the box but shown by no tool until the owner says "publish" (#136).
