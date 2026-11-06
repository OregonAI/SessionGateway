# Transcription bake-off: `small.en` on CPU against `large-v3-turbo` on GPU, on four 2025R1 committee hearings

Run 2026-11-06, 00:25 to 02:51 Pacific (PST; 08:25 to 10:51 UTC), on the GPU desktop. Ticket #133, owner-approved; parent spec #123; ADR-0051 (path A). Written the same morning.

Labels:
- **verified**: read from a file, a log or the code, which the row names.
- **local measurement**: measured on this machine during this run.
- **inferred**: my reading of the above. Not stated by any source.
- **pending the owner's hand-check**: needs a person listening to the audio. Nothing in this note stands in for it.

Scratch files are in `/home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff/` (outside every repository). The transcripts and the excerpt files stay there, behind the publication gate (ADR-0055); none of them is committed. The audio is deleted (section 1).

**Summary.**
1. The two models are close on the Recording Log's names: the same 38 of 108 names exactly right, and 27 (turbo) against 28 (small.en) of the 66 witnesses exact. Both miss the same kinds of names (unusual surnames, nicknames). Neither is better on names. **local measurement**
2. On four 10-minute excerpts the models disagree with each other on 2.4% to 6.7% of words (4.6% over all four). That is inter-model disagreement, not word error. Word error is **pending the owner's hand-check**.
3. Throughput: `large-v3-turbo` on the GPU took about 98 s of wall time per audio hour (about 37 times real time); `small.en` on the CPU took about 323 s per audio hour (about 11 times real time). **local measurement**
4. The owner picks. The "Owner's pick" section at the end is blank.

---

## 1. The run record

**The four events** (taken from what the #124 parser reads in the Recording Log fixtures, `parseRecordingLog(...)`; the fixture's Recording Log id is in the second column):

| Event ID | Log (fixture id) | Committee and date | Audio | Why chosen |
|---|---|---|---|---|
| 2025021032 | 292593 | House Higher Education and Workforce, 2025-02-06 | 1 h 43 m 15 s | A recess (log 0:16:55 to 0:16:58) in the middle of a 3-measure hearing. 15 witnesses from unions and colleges across the state (Rogue, Oregon Coast, Central Oregon, Clackamas, Lane, Treasure Valley, Southwestern Oregon), so likely a mix of in-person and remote. |
| 2025031177 | 310522 | Senate Labor and Business, 2025-03-11 | 1 h 17 m 35 s | A recess (log 0:33:54 to 0:34:12). 12 witnesses, including residents and business owners from the south coast (Charleston, Coos Bay) and a school-district risk manager. |
| 2025041200 | 304494 | House Early Childhood and Human Services, 2025-04-15 | 0 h 49 m 38 s | A recess (log 0:10:38 to 0:10:39) and two sponsors from the Senate. 6 witnesses, including a member of the public (resident, Gresham) and a real-estate broker. The shortest. |
| 2025041266 | 317265 | Senate Rules, 2025-04-23 | 2 h 28 m 51 s | The substitute for the two-log hearing (below): the longest log in the fixtures, 66 speaker turns across four hearings, 33 witnesses, legislators giving testimony, a long run of back-to-back witnesses. No recess. |

Total audio: 22,758 s, 6.32 hours. Durations are the transcriber's own (`audio.duration_seconds` in each transcript file). Each log's adjournment second is within 1 to 21 s of its audio's end, so the logs' timecodes and the MP3s share a clock. **verified**

**Two criteria the fixture documents cannot meet.**
- **Two Recording Logs for one hearing.** The 2025R1 fixture holds 34 Recording Logs for 34 distinct meetings (`test/fixtures/olis-2025R1/feed/CommitteeMeetingDocuments.json`). Each meeting has one log, so no fixture hearing has two. The cached 2025R1 feed, which is not a fixture, has 27 committee meetings with more than one Recording Log row (1,492 log rows for 1,464 meetings by committee and date; many of the 27 are a draft and its final, or a joint log and a committee's own; `docs/research/hearing-video.md` counted 17 under a stricter rule). None of their 55 log PDFs is in the fixtures, the download cache or the research cache (checked by file name), and fetching one would be a request to OLIS that this run did not make. The nearest substitute is event 2025041266, the longest and most complicated single log: 66 turns, four hearings, 2.5 hours. It tests a long, many-part timeline but not the merge of two logs onto one clock. **That case is still untested**; ADR-0055 says the same of its merge. The 27 meetings are the place to look (for example SED 2025-04-02, HREV 2025-06-04, JTR 2025-06-09). **verified** (counts), **inferred** (that the substitute is the nearest)
- **Mixed in-person and remote testimony.** Neither the Recording Logs nor the committee agendas mark a witness as remote. The agendas only say that registration to testify closes 30 minutes before the meeting. The mix therefore cannot be shown from the documents. I chose hearings with many public witnesses from towns across the state, whom I **infer** include remote testifiers. The owner can confirm from the audio while hand-checking the excerpts.

**Requests made to Invintus.**
- The downloader was run once, 00:25:08 to about 00:29 Pacific (checked with `TZ=America/Los_Angeles date` at 00:25:08, the moment before the command): `download --approved-run` with the four event IDs. It exited 0 and printed `fetched 4`. Its record file `fetched.jsonl` holds four lines (event ID, sha256, bytes: 74,340,436; 55,860,916; 35,736,340; 107,172,724).
- **Count: 8 requests**, two per event: one `Event/getDetailed` and one GET of the MP3. The downloader writes no request log (only `fetched.jsonl` and one line on stdout), so the count is from the code (`src/hearing_transcripts/download.py`: `_request` for `getDetailed`, then `_open` for the MP3, once per event, nothing retried) and from the four records. **verified** by reading the code and the record; not counted from a log, because there is none. A request log would be a reasonable addition to the downloader.
- **No halt.** Exit 0; no `HALTED.json`; no 401, 403 or 429; no refusal.
- No other request to Invintus or OLIS. The Recording Logs and agendas were read from the checked-in fixtures; the 2025R1 cache listing was read from disk.
- Other network use, not to Invintus: the transcriber took `large-v3-turbo` and `small.en` from Hugging Face (the transcriber's documented use), and `uv sync --extra gpu` took the CUDA wheels from PyPI.

**Transcription runs.**
- GPU, `large-v3-turbo`, `--device cuda` (float16): 00:29 to 00:41 Pacific. One process per event.
- CPU, `small.en`, `--device cpu` (int8): 02:17 to 02:51 Pacific. Both models used beam size 5 and English.
- **The backfill.** `~/wt/backfill-2026R1/run.sh status` said RUNNING from before the run until some time between 02:13 and 02:17. The CPU runs waited for it (a loop on that status; the backfill was never touched) and started at 02:17:08 with the status "not running"; it was "not running" again at the end of each of the four runs. **The CPU numbers are uncontended. The GPU numbers are not**: the GPU runs overlapped the backfill (system load average 0.7 to 1.0 at the time, sampled at 00:42). The GPU job needs the CPU only for decoding, feature extraction and writing, so I expect the effect to be small, but I did not measure it. **inferred**
- Each transcript was validated by the tool against the version-1 schema before its MP3 was deleted (the tool's rule).

**Audio deleted.** After the last transcription, `find /home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff -name '*.mp3'` printed nothing (count 0). The transcriber deletes each MP3 after a valid transcript. The CPU and GPU workfolders each held a copy of the four MP3s (so both models read the same bytes); both copies are gone. **verified**

---

## 2. Table (a): the Recording Log's names

**What was counted.** For each hearing, the names the Recording Log gives: the members present (from "MEMBERS PRESENT"), and everyone named on a speaker turn (witnesses, staff analysts, and legislators who testified as sponsors). Members excused are not counted, since they were not there. The log's spelling is the reference for spelling. That is what the ticket asks for, but it is a **log spelling, not a verified one**: the logs can be wrong, and a disagreement is not proof that the model is. One example is in the fixtures themselves: log 317265 (Senate Rules, 2025-04-23) spells the Ethics Commission's executive director "Susan Meyers" while log 309415 (House Rules, 2025-06-05) spells the same title and name "Susan Myers". `large-v3-turbo` wrote "Susan Myers". The hand-check should settle spellings like this.

**How a name was matched** (whole transcript, case and punctuation ignored, diacritics kept):
- **Witnesses and speakers who are not legislators or staff:** the full name as logged must appear. Witnesses state their names to the Chair, so this is the test that matters.
- **Legislators:** the surname as logged must appear. Chairs and members address each other by surname ("Chair Hudson"), so a full name is rarely said.
- **Staff analysts:** full name or surname. None was found by either model; I looked at the transcripts for near-misses (O'Brien, Perez, Porter) and found none, so I **infer** the analysts' names are not said aloud.
- A whole-transcript match can be credited to a name the Chair says, not the witness. That makes the count a little generous to both models, equally.

| Hearing (event) | Names in the log | Witnesses, full name exact: small.en | large-v3-turbo | Legislators, surname: small.en | large-v3-turbo | Staff, found: small.en | large-v3-turbo |
|---|---|---|---|---|---|---|---|
| HHED 02-06 (2025021032) | 25 | 6 of 15 | 7 of 15 | 7 of 9 | 7 of 9 | 0 of 1 | 0 of 1 |
| SLB 03-11 (2025031177) | 19 | 4 of 12 | 4 of 12 | 5 of 6 | 6 of 6 | 0 of 1 | 0 of 1 |
| HECHS 04-15 (2025041200) | 13 | 1 of 6 | 1 of 6 | 6 of 7 | 6 of 7 | n/a | n/a |
| SRULES 04-23 (2025041266) | 51 | 17 of 33 | 15 of 33 | 12 of 15 | 12 of 15 | 0 of 3 | 0 of 3 |
| **All four** | **108** | **28 of 66** | **27 of 66** | **30 of 37** | **31 of 37** | **0 of 5** | **0 of 5** |

All names, full name exact (the strictest count): small.en 38 of 108, large-v3-turbo 38 of 108. All names, surname found: 71 and 69 of 108. **local measurement**

**What the witness misses look like.** Most are a near spelling of a rare name; the two models usually make the same error ("Cameron Harrington", "Keisha Duffy", "Carrie Silva", "Josh Nasby"). Below, "not found near the turn" means no rendering resembling the name was in the two minutes after the log's turn. Rows where both models are right are left out.

**2025021032** (HHED 02-06)

| Log's spelling | small.en wrote | large-v3-turbo wrote |
|---|---|---|
| John Wykoff | John Weckoff | John Wyckoff |
| Hollie Oakes-Miller | Oakes -Miller | Oaks -Miller |
| Enrique Farrera | Enrique Ferreira | Enrique Ferreira |
| Alison Lutz | right | Allison Lutz |
| Dave Koehler | David Kohler | David Kohler |
| Kimberly Puttman | Kimberly Putman | Kimberly Putman |
| Laurie Chesley | Lori Chesley | Lori Chesley |
| Peggy Oberstaller | not found near the turn | not found near the turn |
| Stephen Gladfelter | Steven Gladfelter | right |
| Bernadette Kapocias | not found near the turn | not found near the turn |

**2025031177** (SLB 03-11)

| Log's spelling | small.en wrote | large-v3-turbo wrote |
|---|---|---|
| Karl Koenig | Carl Koenig | Carl Kenick |
| Joe Crelier | joe crayer | joe creeler |
| T.J. Crockett | tj crockett | tj crockett |
| Michiel Majors | michael majors | michael majors |
| Josh Bettesworth | josh bettersworth | josh bettisworth |
| Karie Silva | carrie silva | carrie silva |
| Courteney Halstead | courtney halstead | courtney halstead |
| Josh Nasbe | josh nasby | josh nasby |

**2025041200** (HECHS 04-15)

| Log's spelling | small.en wrote | large-v3-turbo wrote |
|---|---|---|
| Laura Bower | Laura Bauer | Laura Bauer? |
| Abi Brambila | Abby Brambila | Abby Brambila? |
| Cameron Herrington | Cameron Harrington | Cameron Harrington |
| Kaysha Duffy | Keisha Duffy | Keisha Duffy |
| Erin Meechan | Erin Meehan | Erin Meehan |

**2025041266** (SRULES 04-23)

| Log's spelling | small.en wrote | large-v3-turbo wrote |
|---|---|---|
| Arnie Roblan | Arnold Roblin | Arnie Roblin |
| Alicia McAuley | Alisa McCauley | Alyssa McCauley |
| Bill Hansell | not found near the turn | not found near the turn |
| Susan Meyers | right | Susan Myers (see the note above) |
| Lori Sattenspiel | not found near the turn | not found near the turn |
| Scott Winkels | Scott Winkles | Scott Winkle |
| Odalis Aguilar Aguilar | not found near the turn | Adalas Aguilar Aguilar |
| Jennie Olson | Jenny Olson | Jenny Olson |
| Patsy Chenpanas | Patsy Chan | Patsy Chanbonas |
| Matt Edinger | Matt Eddinger | Matt Eddinger |
| Sean Kolmer | Sean Colmer | Sean Colmer |
| Christopher Allnatt | right | Christopher Alenad |
| Nick Budnick | Nick, but | Nick Buttnick |
| Justin Francese | right | Justin Franchese |
| Laurie Hieb | Lori Hebb | Lori Hebb |
| Clayton Franke | Clayton Frankie | right |
| Amy Bos | Amy Boss | Amy Boss |
| Shawn Cleave | Sean Cleve | Sean Cleve |
| Maddy Do | Maddie Doan | Maddie Doe |
| Matt Pearce | Matt Pierce | Matt Pierce |

**Legislators whose surname was not found:**
- small.en: Lisa Fragala and Lesly Muñoz (HHED), Khanh Pham (SLB), Emily McIntire (HECHS), Sara Gelser Blouin, Jules Walter, Willy Chotzen (SRULES).
- large-v3-turbo: Lesly Muñoz and Dwayne Yunker (HHED), Emily McIntire (HECHS), Sara Gelser Blouin, Jules Walter, Willy Chotzen (SRULES).
- Both models write "Munoz" without the tilde (so the log's "Muñoz" is a miss under exact spelling; with diacritics folded it would be found). `small.en` writes "Yonker" and "Yunker" for Yunker; `large-v3-turbo` writes "Yonker".
- Several of these legislators spoke only briefly, or were never addressed by surname, so a miss may mean the name was not said. I did not check the audio for that.

**Reading of table (a).** On these hearings the two models do not differ on names beyond a witness or two per hearing, and they err in the same places. The names are the weak point of both: a quarter to a half of witnesses' names come out as a near-miss spelling. That bears on the feature: the Recording Log, not the transcript, is the place to take a speaker's name from, which is the design already (turns carry the logged name; the transcript gives the words). **inferred**

---

## 3. Table (b): the 10-minute excerpts

**Method.** For each hearing I fixed the window by a rule before reading either transcript: ten minutes starting at the first witness turn (not a legislator, not staff) that begins at or after the midpoint of the audio. The windows are by the media clock.

**No reference exists.** Nobody on this run can listen to the audio, so there is no ground truth, and neither model is treated as one. What the table reports is how often the two models' words disagree.

**Inter-model disagreement.** The word-level edit distance between the two models' texts for the window (lowercase, punctuation removed, apostrophes dropped, words taken by their start time falling in the window), divided by the number of words in `large-v3-turbo`'s text. It counts every difference between the two (a name, a number, a dropped "um") and says nothing about which side is right. It is **not a word error rate**.

| Hearing (event) | Window (media clock) | Starts at the turn of | Words: small.en | Words: large-v3-turbo | Edits between them | Inter-model disagreement | Word error |
|---|---|---|---|---|---|---|---|
| 2025021032 | 0:58:18 to 1:08:18 | Kimberly Puttman | 1,224 | 1,264 | 57 | 4.5% | pending the owner's hand-check |
| 2025031177 | 0:46:34 to 0:56:34 | Josh Bettesworth | 1,522 | 1,533 | 103 | 6.7% | pending the owner's hand-check |
| 2025041200 | 0:26:52 to 0:36:52 | Cameron Herrington | 1,379 | 1,391 | 33 | 2.4% | pending the owner's hand-check |
| 2025041266 | 1:23:00 to 1:33:00 | Patsy Chenpanas | 1,697 | 1,690 | 80 | 4.7% | pending the owner's hand-check |
| **All four** | 40 minutes | | 5,822 | 5,878 | 273 | **4.6%** | **pending the owner's hand-check** |

**local measurement** (the counts), by `scripts` in the scratch folder.

**The files for the hand-check** (outside the repository, in `/home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff/excerpts/`):
- `<event>-side-by-side.md`: twenty 30-second blocks. Each block has the `small.en` words, the `large-v3-turbo` words, and a `- CORRECTED:` line left empty for the owner to type the words actually spoken. A word is placed by its own start time, so a word at a block edge can sit in the neighbouring block of the other model.
- `<event>-small.en.txt` and `<event>-large-v3-turbo.txt`: each model's text for the whole window, to edit directly instead.
- The four events: `2025021032`, `2025031177`, `2025041200`, `2025041266`.

When the `CORRECTED` lines are filled in, `python3 /home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff/scripts/wer.py` prints each model's word error against them (same normalisation; blocks left empty are skipped and counted). Do not re-run `scripts/excerpts.py` after editing: it rewrites the side-by-side files.

---

## 4. Table (c): throughput

**Hardware** (**local measurement**): NVIDIA GeForce RTX 5060 Ti, 8,151 MiB, driver 610.88 (`nvidia-smi --query-gpu=name --format=csv`); 20 logical CPUs (`nproc`), Intel Core Ultra 7 265F; 19 GiB of memory visible in the WSL2 guest. CTranslate2 4.8.5 through faster-whisper, set up with `uv sync --extra gpu`.

**What the number is.** The wall time of one `hearing-transcripts transcribe` process per event: starting Python, loading the model, decoding, transcribing with word timestamps, validating, writing and deleting the MP3. It is not the model's compute time alone. Per audio hour = wall seconds ÷ audio hours. The transcriber sets no thread count, so the CPU runs used faster-whisper's default; the load average was about 4 during them, which I **infer** means 4 threads of the 20.

| Model, device | Event (audio) | Wall time | Per audio hour | Times real time |
|---|---|---|---|---|
| large-v3-turbo, GPU (float16) | 2025041200 (0:49:38) | 183.3 s | 221.6 s | 16 (includes the model's first download) |
| | 2025021032 (1:43:15) | 164.8 s | 95.8 s | 37.6 |
| | 2025031177 (1:17:35) | 120.8 s | 93.4 s | 38.5 |
| | 2025041266 (2:28:51) | 252.6 s | 101.8 s | 35.4 |
| | **Last three (5.50 h)** | 538.2 s | **97.9 s (1.63 min)** | **36.8** |
| small.en, CPU (int8) | 2025041200 (0:49:38) | 261.7 s | 316.4 s | 11.4 |
| | 2025021032 (1:43:15) | 504.3 s | 293.1 s | 12.3 |
| | 2025031177 (1:17:35) | 390.4 s | 301.9 s | 11.9 |
| | 2025041266 (2:28:51) | 883.7 s | 356.2 s | 10.1 |
| | **All four (6.32 h)** | 2,040.1 s | **322.7 s (5.38 min)** | **11.2** |

- GPU: the first event includes the one-time download of the model (`large-v3-turbo` was not in the cache), so the headline uses the other three. All four together: 721.5 s for 6.32 h, 114 s per audio hour.
- GPU runs overlapped the backfill (see section 1); the CPU runs did not. No contention applied to the CPU numbers. Earlier, `docs/research/hearing-video.md` measured `small.en` int8 at 12.9 times real time on 8 threads for one 10-minute clip; this run's 11.2 times on the full hearings is the same order.
- **Against the spec's budget of one night per 100 hours** (6 hours of window, 00:00 to 06:00): 100 audio hours takes about 2.7 hours on the GPU at 97.9 s per hour, and about 9.0 hours on the CPU at 322.7 s per hour. The 2026R1 volume of about 330 to 430 hours would take about 9 to 12 hours on the GPU and about 30 to 39 hours on the CPU. Transcription is not in the 00:00 to 06:00 window (only the downloads are), so neither is blocked by the window, but the CPU run is about 3.3 times longer. **inferred** (arithmetic over the table)

---

## 5. What the owner must do to pick

1. **Hand-check the four excerpts** (about 40 minutes of audio). Open each `<event>-side-by-side.md`, listen to the matching stretch of the official recording from the second given (the player link form is in the Recording Log), and type the spoken words on each `- CORRECTED:` line. Then run `scripts/wer.py` (section 3). That gives each model's word error, which this note does not have. The disagreement figures say the models differ by 2% to 7% of words; they cannot say which is closer to what was said.
2. **Settle the contested spellings** in table (a) that matter for names: for example "Susan Meyers" or "Myers", and whether the log's other unusual spellings are right.
3. **Weigh what the numbers show:**
   - Names: a tie on these four hearings (38 and 38 of 108, exact). The names come from the Recording Log either way.
   - Speed: the GPU model is about 3.3 times faster per audio hour here.
   - Cost: both are local and free. `small.en` also runs where there is no GPU (as the tool's CI does); `large-v3-turbo` here needs the desktop's GPU.
   - A third option the ticket did not ask for, `large-v3-turbo` on the CPU, was not run.
4. **Say whether the mix is enough.** This run did not test two logs for one hearing (section 1), and could not show remote against in-person testimony from the documents. If either matters for the choice, say which hearing to add; the 27 two-log meetings are in the cached feed.
5. **Record the pick** in the section below and in #123.

---

## Owner's pick

(blank: to be filled in by the owner)
