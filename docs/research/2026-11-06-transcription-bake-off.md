# Transcription bake-off: `small.en` on CPU against `large-v3-turbo` on GPU, on four 2025R1 committee hearings

Run 2026-11-06, 00:25 to 02:51 Pacific (PST; 08:25 to 10:51 UTC), on the GPU desktop. Ticket #133, owner-approved; parent spec #123; ADR-0051 (path A). Written the same morning.

Labels:
- **verified**: read from a file, a log or the code, which the row names.
- **local measurement**: measured on this machine during this run.
- **inferred**: my reading of the above. Not stated by any source.

Word error is not measured anywhere in this note: it needs a person to listen to the audio and type the words spoken (section 3 and section 5). Nothing here stands in for that.

Scratch files are in `/home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff/` (outside every repository). The transcripts and the excerpt files stay there, behind the publication gate (ADR-0055); none of them is committed. The audio is deleted (section 1).

**Summary.**
1. The two models are close on the Recording Log's names: each model gets 37 of the 106 names exactly right, and 28 (turbo) against 29 (small.en) of the 66 witnesses. The counts match but the names do not entirely: 33 names are exact in both; `small.en` alone got Alison Lutz, Christopher Allnatt, Justin Francese and Susan Meyers, and `large-v3-turbo` alone got Lisa Fragala, Peggy Oberstaller, Stephen Gladfelter and Nick Budnick (the last only because the Chair said it: at the witness's own turn turbo wrote "Nick Buttnick"). Both miss the same kinds of names (unusual surnames, nicknames). Neither is better on names. **local measurement**
2. On four 10-minute excerpts the models disagree with each other on 2.4% to 6.7% of `large-v3-turbo`'s words (4.6% over all four; 2.4% to 6.8% and 4.7% counted against `small.en`'s words). That is inter-model disagreement, not word error. Word error is not measured; it needs the owner's hand-check.
3. Throughput: `large-v3-turbo` on the GPU took about 98 s of wall time per audio hour (about 37 times real time; the first of its four events, which includes the model download, is left out of this figure); `small.en` on the CPU took about 323 s per audio hour (about 11 times real time). **local measurement**
4. The owner picks. The "Owner's pick" section at the end is blank.

---

## 1. The run record

**The four events** (taken from what the #125 parser reads in the Recording Log fixtures (#124 is the fixture logs themselves), `parseRecordingLog(...)`; the fixture's Recording Log id is in the second column):

| Event ID | Log (fixture id) | Committee and date | Audio | Why chosen |
|---|---|---|---|---|
| 2025021032 | 292593 | House Higher Education and Workforce, 2025-02-06 | 1 h 43 m 15 s | A recess (log 0:16:55 to 0:16:58) in the middle of a 4-measure hearing (a work session on HB 2556, public hearings on HB 3027, HB 3028 and HB 2669). 15 witnesses from unions and colleges across the state (Rogue, Oregon Coast, Central Oregon, Clackamas, Lane, Treasure Valley, Southwestern Oregon), so likely a mix of in-person and remote. |
| 2025031177 | 310522 | Senate Labor and Business, 2025-03-11 | 1 h 17 m 35 s | A recess (log 0:33:54 to 0:34:12). 12 witnesses, including residents and business owners from the south coast (Charleston, Coos Bay) and a school-district risk manager. |
| 2025041200 | 304494 | House Early Childhood and Human Services, 2025-04-15 | 0 h 49 m 38 s | A recess (log 0:10:38 to 0:10:39) and two sponsors from the Senate. 6 witnesses, including a member of the public (resident, Gresham) and a real-estate broker. The shortest. |
| 2025041266 | 317265 | Senate Rules, 2025-04-23 | 2 h 28 m 51 s | The substitute for the two-log hearing (below): the longest log in the fixtures, 66 speaker turns across five public hearings (SCR 31, HCR 28 A, SB 983, SB 537, SB 686; the first two also had work sessions), 33 witnesses, legislators giving testimony, a long run of back-to-back witnesses. No recess. |

Total audio: 22,759 s (22,758.9), 6.32 hours. Durations are the transcriber's own (`audio.duration_seconds` in each transcript file). **verified** (the durations)

Each log's "Meeting Adjourned" second is within 1 to 21 s of its audio's end (HHED 19 s, SLB 21 s, HECHS 1 s, SRULES 5 s), so I **infer** that the logs' timecodes and the MP3s share a clock. That is an inference from four end points, not a check of every turn: one log turn is about 7.5 minutes early (Peggy Oberstaller in the HHED log, section 2: logged at 4,543 s, three seconds after Sandy Porter's turn, but both models place her speaking at about 4,973 to 4,996 s), and Bernadette Kapocias's logged turn is 82 s after both models place her name. The alignment of log to audio is therefore good at the ends and not guaranteed in between.

**Two criteria the fixture documents cannot meet.**
- **Two Recording Logs for one hearing.** The 2025R1 fixture holds 34 Recording Logs for 34 distinct meetings (`test/fixtures/olis-2025R1/feed/CommitteeMeetingDocuments.json`). Each meeting has one log, so no fixture hearing has two. The cached 2025R1 feed (`~/SessionGateway/.cache/olis-2025R1/feed/CommitteeMeetingDocuments.json`, not a fixture) holds 1,492 Recording Log rows for 1,474 meetings, grouping by committee code and `MeetingDate` including the time of day. 17 of those meetings have more than one log row: 16 have two and one (SECBH 2025-03-04) has three, 35 rows in all. That matches `docs/research/hearing-video.md` (1,474 meetings, 17 with two logs). The pairs are a draft and its final, or a final posted twice (the second title ends in "_"). Real examples, with the log document ids: SECBH 2025-02-27 13:00 (295852 draft, 301367 final); HEMGGV 2025-02-25 13:00 (294048, 303672) and HEMGGV 2025-02-27 13:00 (293979, 303651); SLB 2025-04-17 08:30 (302249 draft, 304649 final). None of the 35 log PDFs is in the fixtures, the download cache or the research cache (checked by document id as file name), and fetching one would be a request to OLIS that this run did not make. The nearest substitute is event 2025041266, the longest and most complicated single log: 66 turns, five public hearings, 2.5 hours. It tests a long, many-part timeline but not the merge of two logs onto one clock. **That case is still untested**; ADR-0055 says the same of its merge. **verified** (counts, ids), **inferred** (that the substitute is the nearest)
- **Mixed in-person and remote testimony.** Neither the Recording Logs nor the committee agendas mark a witness as remote. The agendas only say that registration to testify closes 30 minutes before the meeting. The mix therefore cannot be shown from the documents. I chose hearings with many public witnesses from towns across the state, whom I **infer** include remote testifiers. The owner can confirm from the audio while hand-checking the excerpts.

**Requests made to Invintus.**
- The downloader was run once, from about 00:25 Pacific (my clock check just before the command; no file records the start) to 00:29:30 (the last write to `download.log`, by file time): `download --approved-run` with the four event IDs. It exited 0 and printed `fetched 4` (`download.log`). Its record file `fetched.jsonl` holds four lines (event ID, sha256, bytes: 74,340,436; 55,860,916; 35,736,340; 107,172,724).
- **Count: 8 requests**, two per event: one `Event/getDetailed` and one GET of the MP3. The downloader writes no request log (only `fetched.jsonl` and one line on stdout), so the count is from the code (`src/hearing_transcripts/download.py`: `_request` for `getDetailed`, then `_open` for the MP3, once per event, nothing retried) and from the four records. **verified** by reading the code and the record; not counted from a log, because there is none. A request log would be a reasonable addition to the downloader.
- **Which code.** The downloader ran from the `OregonAI/hearing-transcripts` checkout at `~/hearing-transcripts`, `uv run`, HEAD `1862766a37ef2156d0b5cf523ab955d99a9c86df` (2026-11-05 17:11 -0800, "Merge pull request #2 from OregonAI/ticket/132-transcriber"), clean working tree when checked after the run. `download.log` shows `Built hearing-transcripts @ file:///home/dzinck/hearing-transcripts` and records no commit, so the commit is the checkout's HEAD, which is older than the run. **verified** (`git -C ~/hearing-transcripts log -1`), **inferred** (that it was HEAD at run time)
- **Authority.** Spec #123 user story 27: "As the owner, I want a model bake-off on four real 2025R1 hearings before the 2026R1 run, scored on names and a hand-checked excerpt, so that I pick the model on evidence." Its implementation notes: "The bake-off run (4 recordings) and the 2026R1 run (279) are separate owner-approved runs, and the owner may need to start them with `!`." (`gh issue view 123 -R OregonAI/SessionGateway`.) **verified**
- **Flag for the owner: ADR-0051's scope line.** ADR-0051 says "**2026R1 committee recordings only.** No floor sessions, no other sessions." This run fetched four 2025R1 committee recordings, on the authority of #123 above, not of the ADR's text read alone. The ADR's scope line may need an amendment (for example, to name the bake-off's four 2025R1 recordings); whether to amend it is the owner's call, and this change does not edit the ADR.
- **No halt.** Exit 0; no `HALTED.json`; no 401, 403 or 429; no refusal.
- No other request to Invintus or OLIS. The Recording Logs and agendas were read from the checked-in fixtures; the 2025R1 cache listing was read from disk.
- Other network use, not to Invintus: the transcriber took `large-v3-turbo` (00:29:55) and `small.en` (00:43:32, by the file times in the Hugging Face cache) from Hugging Face (the transcriber's documented use), so `small.en` was fetched outside the timed runs, while the first GPU run includes `large-v3-turbo`'s download. `uv sync --extra gpu` took the CUDA wheels from PyPI.

**Transcription runs.**
- GPU, `large-v3-turbo`, `--device cuda` (float16): 00:29 to 00:41 Pacific. One process per event.
- CPU, `small.en`, `--device cpu` (int8): 02:17 to 02:51 Pacific. Both models used beam size 5 and English.
- **The backfill.** `~/wt/backfill-2026R1/run.sh status` said RUNNING from before the run until some time between 02:13 and 02:17. The CPU runs waited for it (a loop on that status; the backfill was never touched) and started at 02:17:08 with the status "not running"; it was "not running" again at the end of each of the four runs. **The CPU numbers are uncontended. The GPU numbers overlapped the backfill, and the overlap was small**: `~/wt/backfill-2026R1/data/time-3.txt` (`time` output for the backfill's `node src/bin/ingest.ts --once`) shows it ended at 02:16:33 after 1:55:16 of wall time (so it began about 00:21) and got 1% of the CPU on average (72.2 s user and 13.6 s system). **local measurement** The system load average of 0.7 to 1.0 that I sampled at 00:42 was taken after the GPU runs ended (00:41:54), so it says nothing about the GPU runs; the backfill's own 1% is the evidence. That 1% is an average over the run, not a reading during the GPU window. **inferred** (that it was also low then)
- Each transcript was validated by the tool against the version-1 schema before its MP3 was deleted (the tool's rule).

**Audio deleted.** After the last transcription, `find /home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff -name '*.mp3'` printed nothing (count 0). The transcriber deletes each MP3 after a valid transcript. The CPU and GPU workfolders each held a copy of the four MP3s (so both models read the same bytes); both copies are gone. **verified**

---

## 2. Table (a): the Recording Log's names

**What was counted.** For each hearing, the names the Recording Log gives: the members present (from "MEMBERS PRESENT"), and everyone named on a speaker turn (witnesses, staff analysts, and legislators who testified as sponsors). Members excused are not counted, since they were not there. The log's spelling is the reference for spelling. That is what the ticket asks for, but it is a **log spelling, not a verified one**: the logs can be wrong, and a disagreement is not proof that the model is. One example is in the fixtures themselves: log 317265 (Senate Rules, 2025-04-23) spells the Ethics Commission's executive director "Susan Meyers" while log 309415 (House Rules, 2025-06-05) spells the same title and name "Susan Myers". `large-v3-turbo` wrote "Susan Myers". The hand-check should settle spellings like this.

**Counting rule.** A legislator named on a speaker turn by surname only ("Finger McDonald", "Manning Jr.") is the same person as the member listed in full ("Sarah Finger McDonald", "James Manning Jr.") and is counted once. An earlier count of this note counted both and gave 108 names.

**How a name was matched** (whole transcript; case and punctuation ignored, diacritics kept, apostrophes dropped, hyphens read as spaces, initials joined so "T.J." and "TJ" are both "tj"; the exact rules are `norm()` in the appendix):
- **Witnesses and speakers who are not legislators or staff:** the full name as logged must appear. Witnesses state their names to the Chair, so this is the test that matters.
- **Legislators:** the surname as logged must appear (for the three multi-word surnames, Finger McDonald, Gelser Blouin and Aguilar Aguilar, the whole surname). Chairs and members address each other by surname ("Chair Hudson"), so a full name is rarely said.
- **Staff analysts:** full name or surname. No analyst's full name or surname was found by either model; I searched the transcripts for near-misses of the surnames (O'Brien, Perez, Porter, Gezelter, Hart) and found none. First names are said aloud: the chair says "Ellen, would you" (turbo only), "Whitney" (both models, 2025031177, about 52 s and 191 s), "Leslie" (both), "Lisa" (turbo only) and "Katie" (both). So only the surnames are absent; the analysts are addressed by first name. **local measurement** (transcript search)
- A whole-transcript match can be credited to a name the Chair says, not the witness. That makes the count a little generous to both models, equally.

| Hearing (event) | Names in the log | Witnesses, full name exact: small.en | large-v3-turbo | Legislators, surname: small.en | large-v3-turbo | Staff, found: small.en | large-v3-turbo |
|---|---|---|---|---|---|---|---|
| HHED 02-06 (2025021032) | 24 | 6 of 15 | 7 of 15 | 6 of 8 | 6 of 8 | 0 of 1 | 0 of 1 |
| SLB 03-11 (2025031177) | 19 | 5 of 12 | 5 of 12 | 5 of 6 | 6 of 6 | 0 of 1 | 0 of 1 |
| HECHS 04-15 (2025041200) | 13 | 1 of 6 | 1 of 6 | 6 of 7 | 6 of 7 | n/a | n/a |
| SRULES 04-23 (2025041266) | 50 | 17 of 33 | 15 of 33 | 11 of 14 | 11 of 14 | 0 of 3 | 0 of 3 |
| **All four** | **106** | **29 of 66** | **28 of 66** | **28 of 35** | **29 of 35** | **0 of 5** | **0 of 5** |

All names, full name exact (the strictest count): small.en 37 of 106, large-v3-turbo 37 of 106. All names, surname found: 68 and 67 of 106. **local measurement** (`scripts/score.py`, appendix)

**What the witness misses look like.** Most are a near spelling of a rare name; the two models usually make the same error ("Cameron Harrington", "Keisha Duffy", "Carrie Silva", "Josh Nasby"). The tables list every witness whose full name is not exact anywhere in at least one model's transcript (the table (a) test), by `scripts/misses_table.py` (appendix). How each cell was found: `scripts/near.py` takes, for each witness, runs of 1, 2 and 3 consecutive transcript words (a name can come out split or joined, as in "Satin -Spiel") and compares each, normalised, with the logged name by difflib's similarity ratio. The window is from 20 s before to 120 s after the log's turn for that witness; the cutoff is a ratio of 0.7. A cell shows "right" if the exact name is inside the window; otherwise the closest run in the window if it reaches the cutoff; otherwise the closest run anywhere in the transcript, with its distance in seconds from the log's turn (a log turn can be off, as for Oberstaller and Kapocias below); otherwise the closest run in the window, marked as below the cutoff. A ratio of 0.7 is generous (it passes "Nick, but Nick" for "Nick Budnick"), so a near rendering here is not evidence the model heard the name.

Where the log's turn time and the speech disagree: Peggy Oberstaller's log turn (4,543 s) is 3 s after Sandy Porter's and 207 s before Jen Sacklin's, but both models place her saying her name at about 4,973 to 4,996 s (`large-v3-turbo` wrote it exactly; `small.en` wrote "Oberstahler"); Bernadette Kapocias is named 82 s before the log's turn by both models; "Bill Hansel" appears in both transcripts at 320, 1,880 and 1,883 s, which are mentions, none within 120 s of the log's turn at 1,442 s (the nearest is 438 s after it). Lori Sattenspiel is not a miss of the "not found" kind: both models wrote "Lori Satin -Spiel" at about 2,575 s, in the window. Rows where both models are exact are left out.

**2025021032**

| Log's spelling | small.en wrote | large-v3-turbo wrote |
|---|---|---|
| John Wykoff | John Weckoff | John Wyckoff |
| Hollie Oakes-Miller | Holly Oakes -Miller | Holly Oaks -Miller |
| Enrique Farrera | Enrique Ferreira | Enrique Ferreira |
| Alison Lutz | right | Allison Lutz |
| Dave Koehler | David Kohler | David Kohler |
| Kimberly Puttman | Kimberly Putman | Kimberly Putman |
| Laurie Chesley | Lori Chesley | Lori Chesley |
| Peggy Oberstaller | Peggy Oberstahler (+430 s from the log's turn) | Peggy Oberstaller (+430 s from the log's turn) |
| Stephen Gladfelter | Steven Gladfelter | right |
| Bernadette Kapocias | Bernadette Kaposius (-82 s from the log's turn) | bernadette capocias (-82 s from the log's turn) |

**2025031177**

| Log's spelling | small.en wrote | large-v3-turbo wrote |
|---|---|---|
| Karl Koenig | Carl Koenig | Carl Kenick |
| Joe Crelier | joe crayer | joe creeler |
| Michiel Majors | michael majors | michael majors |
| Josh Bettesworth | josh bettersworth | josh bettisworth |
| Karie Silva | carrie silva | carrie silva |
| Courteney Halstead | courtney halstead | courtney halstead |
| Josh Nasbe | josh nasby | josh nasby |

**2025041200**

| Log's spelling | small.en wrote | large-v3-turbo wrote |
|---|---|---|
| Laura Bower | Laura Bauer | Laura Bauer? |
| Abi Brambila | Abby Brambila | Abby Brambila |
| Cameron Herrington | Cameron Harrington | Cameron Harrington |
| Kaysha Duffy | Keisha Duffy | Keisha Duffy |
| Erin Meechan | Erin Meehan | Erin Meehan |

**2025041266**

| Log's spelling | small.en wrote | large-v3-turbo wrote |
|---|---|---|
| Arnie Roblan | Arnold Roblin | Arnie Roblin |
| Alicia McAuley | Alisa McCauley | Alyssa McCauley |
| Bill Hansell | Bill Hansel (+438 s from the log's turn) | Bill Hansel (+438 s from the log's turn) |
| Susan Meyers | right | Susan Myers |
| Lori Sattenspiel | Lori Satin -Spiel | Lori Satin -Spiel |
| Scott Winkels | Scott Winkles | Scott Winkle |
| Odalis Aguilar Aguilar | Alisa Yilara Yilara (nearest in the window, below the cutoff) | Adalas Aguilar Aguilar |
| Jennie Olson | Jenny Olson | Jenny Olson |
| Patsy Chenpanas | Patsy Chan -Panis | Patsy Chanbonas |
| Matt Edinger | Matt Eddinger | Matt Eddinger |
| Sean Kolmer | Sean Colmer | Sean Colmer |
| Christopher Allnatt | right | Christopher Alenad |
| Nick Budnick | Nick, but Nick | Nick Buttnick (exact elsewhere in the transcript) |
| Justin Francese | right | Justin Franchese |
| Laurie Hieb | Lori Heeb | Lori Hebb |
| Amy Bos | Amy Boss | Amy Boss |
| Shawn Cleave | Sean Cleve | Sean Cleve |
| Maddy Do | Maddie Doan | Maddie Doe |
| Matt Pearce | Matt Pierce | Matt Pierce |

**Legislators whose surname was not found:**
- small.en: Lisa Fragala and Lesly Muñoz (HHED), Khanh Pham (SLB), Emily McIntire (HECHS), Sara Gelser Blouin, Jules Walter, Willy Chotzen (SRULES).
- large-v3-turbo: Lesly Muñoz and Dwayne Yunker (HHED), Emily McIntire (HECHS), Sara Gelser Blouin, Jules Walter, Willy Chotzen (SRULES).
- Both models write "Munoz" without the tilde (so the log's "Muñoz" is a miss under exact spelling; with diacritics folded it would be found). `small.en` writes "Yonker" and "Yunker" for Yunker; `large-v3-turbo` writes "Yonker".
- **Jules Walter is a log spelling, not a model error.** Both models wrote "Walters" ("My name is Jules Walters", SRULES, about 5,904 s). The fixture logs 304494 (HECHS 04-15, the member list), 303298 and 305938 all spell it "Rep. Jules Walters", and the feed's vote record has "Rep Walters". Only log 317265's turn says "Walter". The scored miss comes from the log's spelling.
- **The name was said in at least two of these cases.** In SRULES both models wrote "Sarah Gelser -Bloon" or "Gelser Bluen" (about 336 s, in a run of member names) and "Chotson" for Chotzen (6,156 to 6,179 s, around the log's turn at 6,171 s), so the miss is a spelling miss, not an unsaid name. For the other legislators I did not check whether the name was said or only misspelled.

**Reading of table (a).** On these hearings the two models do not differ on names beyond a witness or two per hearing, and they err in the same places. The names are the weak point of both: the full name is not exact for 37 of 66 witnesses (56%) with `small.en` and 38 of 66 (58%) with `large-v3-turbo`, under a test that is generous (see above). For 36 of the 37 and all 38, a rendering within the 0.7 similarity cutoff exists in the transcript; the exception is Odalis Aguilar Aguilar in `small.en`. That bears on the feature: the Recording Log, not the transcript, is the place to take a speaker's name from, which is the design already (turns carry the logged name; the transcript gives the words). **inferred**

---

## 3. Table (b): the 10-minute excerpts

**Method.** For each hearing I fixed the window by a rule before reading either transcript: ten minutes starting at the first witness turn (not a legislator, not staff) that begins at or after the midpoint of the audio. The windows are by the media clock.

**No reference exists.** Nobody on this run can listen to the audio, so there is no ground truth, and neither model is treated as one. What the table reports is how often the two models' words disagree.

**Inter-model disagreement.** The word-level edit distance between the two models' texts for the window (`norm()` in the appendix: lowercase, punctuation removed, possessive "'s" and other apostrophes dropped, hyphens read as spaces, initials joined; words taken by their start time falling from the window's start up to, not including, its end), divided by the number of words in one model's text. Both divisors are shown. It counts every difference between the two (a name, a number, a dropped "um") and says nothing about which side is right. It is **not a word error rate**.

| Hearing (event) | Window (media clock) | Starts at the turn of | Words: small.en | Words: large-v3-turbo | Edits between them | Disagreement, ÷ turbo's words | Disagreement, ÷ small.en's words | Word error |
|---|---|---|---|---|---|---|---|---|
| 2025021032 | 0:58:18 to 1:08:18 | Kimberly Puttman | 1,224 | 1,264 | 57 | 4.5% | 4.7% | not measured |
| 2025031177 | 0:46:34 to 0:56:34 | Josh Bettesworth | 1,522 | 1,533 | 103 | 6.7% | 6.8% | not measured |
| 2025041200 | 0:26:52 to 0:36:52 | Cameron Herrington | 1,379 | 1,391 | 33 | 2.4% | 2.4% | not measured |
| 2025041266 | 1:23:00 to 1:33:00 | Patsy Chenpanas | 1,697 | 1,690 | 80 | 4.7% | 4.7% | not measured |
| **All four** | 40 minutes | | 5,822 | 5,878 | 273 | **4.6%** | **4.7%** | not measured |

**local measurement** (the counts): `excerpts.py` (which also wrote the files below) in the scratch folder, recomputed read-only with `disagree.py` after the normalisation fix (same numbers). Both scripts are in the appendix.

**The files for the hand-check** (outside the repository, in `/home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff/excerpts/`):
- `<event>-side-by-side.md`: twenty 30-second blocks. Each block has the `small.en` words, the `large-v3-turbo` words, and a `- CORRECTED:` line left empty for the owner to type the words actually spoken. A word is placed by its own start time, so a word at a block edge can sit in the neighbouring block of the other model. **These are the only files `wer.py` reads, and the only lines in them it reads as the owner's text are the `- CORRECTED:` lines** (plus the two model lines of each block, as the model text).
- `<event>-small.en.txt` and `<event>-large-v3-turbo.txt`: each model's text for the whole window, for reading. `wer.py` does not read them, so editing them changes no score. The owner edits the `CORRECTED` lines, not these.
- The four events: `2025021032`, `2025031177`, `2025041200`, `2025041266`.

When the `CORRECTED` lines are filled in, `python3 /home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff/scripts/wer.py` prints each model's word error against them. For each hearing it joins the 20 `CORRECTED` lines in order into one reference text, joins each model's 20 lines in the same order, and takes one word-level edit distance for the hearing (same normalisation as the disagreement figure), so a word at a block edge that the owner and a model place in different blocks is not counted twice. A final row sums edits and reference words over the hearings. A hearing with any empty `CORRECTED` line is reported as not scored; `--allow-partial` scores the filled blocks only, and says so. Blank, the script prints "not scored" for all four, and nothing here fakes an output. I tested it on a synthetic example (a block-edge word placed differently by owner and models, one substitution, and one incomplete hearing) in the job's scratch folder: it gave 0 and 1 edit as expected, where the earlier block-by-block version would have counted the edge word twice. Do not re-run `scripts/excerpts.py` after editing: it rewrites the side-by-side files.

---

## 4. Table (c): throughput

**Hardware** (**local measurement**): NVIDIA GeForce RTX 5060 Ti, 8,151 MiB, driver 610.88 (`nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv`, re-run on 2026-11-06 for this note); 20 logical CPUs (`nproc`), Intel Core Ultra 7 265F; 19 GiB of memory visible in the WSL2 guest. CTranslate2 4.8.5 through faster-whisper, set up with `uv sync --extra gpu`.

**What the number is.** The wall time of one `hearing-transcripts transcribe` process per event: starting Python, loading the model, decoding, transcribing with word timestamps, validating, writing and deleting the MP3. It is not the model's compute time alone. Per audio hour = wall seconds ÷ audio hours. The transcriber sets no thread count (`src/hearing_transcripts/transcribe.py:169` calls `WhisperModel(path, device=device, compute_type=...)`), so the CPU runs used faster-whisper's default: its `transcribe.py` (version 1.2.1 in the transcriber's `.venv`, line 652) documents "Number of threads to use when running on CPU (4 by default)". **verified** (the documentation). The load average was about 4 during the CPU runs (`timings-cpu.txt`: 3.84 to 4.10), consistent with 4 threads of the 20.

| Model, device | Event (audio) | Wall time | Per audio hour | Times real time |
|---|---|---|---|---|
| large-v3-turbo, GPU (float16) | 2025041200 (0:49:38) | 183.3 s | 221.6 s | 16.2 (includes the model's first download) |
| | 2025021032 (1:43:15) | 164.8 s | 95.8 s | 37.6 |
| | 2025031177 (1:17:35) | 120.8 s | 93.4 s | 38.5 |
| | 2025041266 (2:28:51) | 252.6 s | 101.8 s | 35.3 |
| | **Last three (5.49 h)** | 538.2 s | **98.0 s (1.63 min)** | **36.8** |
| small.en, CPU (int8) | 2025041200 (0:49:38) | 261.7 s | 316.4 s | 11.4 |
| | 2025021032 (1:43:15) | 504.3 s | 293.0 s | 12.3 |
| | 2025031177 (1:17:35) | 390.4 s | 301.9 s | 11.9 |
| | 2025041266 (2:28:51) | 883.7 s | 356.2 s | 10.1 |
| | **All four (6.32 h)** | 2,040.1 s | **322.7 s (5.38 min)** | **11.2** |

- GPU: the first event includes the one-time download of the model (`large-v3-turbo` was not in the cache), so the headline uses the other three. All four together: 721.5 s for 6.32 h, 114.1 s per audio hour. Figures recomputed from `timings-*.txt` and the transcripts' durations.
- GPU runs overlapped the backfill, which averaged 1% of the CPU (see section 1); the CPU runs did not overlap it. Earlier, `docs/research/hearing-video.md` measured `small.en` int8 at 12.9 times real time on 8 threads for one 10-minute clip; this run's 11.2 times on the full hearings is the same order.
- **Against the spec's budget of one night per 100 hours** (6 hours of window, 00:00 to 06:00), taken as the time to transcribe 100 audio hours: `large-v3-turbo` on the GPU **fits**: 100 h x 98.0 s = 2.72 hours, about 3.3 hours to spare. `small.en` on the CPU **does not fit**: 100 h x 322.7 s = 8.96 hours, about 3 hours over. The 2026R1 volume of about 330 to 430 hours would take about 9 to 12 hours on the GPU and about 30 to 39 hours on the CPU, so on the CPU it takes several nights. The CPU run is about 3.3 times longer than the GPU run. Whether transcription must sit inside the 00:00 to 06:00 window at all (the window is for the downloads) is not something this run tested. **inferred** (arithmetic over the table)

---

## 5. What the owner must do to pick

1. **Hand-check the four excerpts** (about 40 minutes of audio). Open each `<event>-side-by-side.md`, listen to the matching stretch of the official recording from the second given (the player link form is in the Recording Log), and type the spoken words on each `- CORRECTED:` line. Then run `scripts/wer.py` (section 3); it reads only the `CORRECTED` lines. That gives each model's word error, which this note does not have. The disagreement figures say the models differ by 2% to 7% of words; they cannot say which is closer to what was said.
2. **Settle the contested spellings** in table (a) that matter for names: for example "Susan Meyers" or "Myers", and whether the log's other unusual spellings are right.
3. **Weigh what the numbers show:**
   - Names: a tie on these four hearings (37 and 37 of 106, exact). The names come from the Recording Log either way.
   - Speed: the GPU model is about 3.3 times faster per audio hour here, and is the only one that fits 100 audio hours in the 6-hour night (2.7 hours against 9.0).
   - Cost: both are local and free. `small.en` also runs where there is no GPU (as the tool's CI does); `large-v3-turbo` here needs the desktop's GPU.
   - A third option the ticket did not ask for, `large-v3-turbo` on the CPU, was not run.
4. **Say whether the mix is enough.** This run did not test two logs for one hearing (section 1), and could not show remote against in-person testimony from the documents. If either matters for the choice, say which hearing to add; the 17 two-log meetings are in the cached feed (for example SECBH 2025-02-27, HEMGGV 2025-02-25 and 2025-02-27, SLB 2025-04-17).
5. **Decide on ADR-0051's scope line** (section 1): it says "2026R1 committee recordings only" and this run fetched four 2025R1 recordings under #123 story 27. Amend the ADR or not, as you see fit.
6. **Record the pick** in the section below and in #123.

---

## Appendix: the scoring scripts

The scripts are outside the repository, in `/home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff/scripts/`, and are reproduced here as run for this note (`score.py`, `near.py`, `misses_table.py`, `wer.py`, `disagree.py`; the paths in them are this machine's). They read the transcript files in `work-cpu/` and `work-gpu/`, the parsed speaker turns `turns-<event>.json` (written by `speakers.ts` from the fixture PDFs through `parseRecordingLog`) and the log text `logtext/<id>.txt` (written by `dump.ts` through `extractPdfText`). `excerpts.py` (which chose the windows and wrote the excerpt files) is not reproduced: it is described in section 3 and must not be re-run. Run order: `python3 score.py`, `python3 misses_table.py`, `python3 disagree.py`; `python3 wer.py` after the owner's hand-check.

### `score.py`

```python
import json, re, unicodedata, glob, sys, os
W = "/home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff"
EV = {"2025021032": "292593", "2025031177": "310522", "2025041200": "304494", "2025041266": "317265"}
MODELS = {"small.en": f"{W}/work-cpu", "large-v3-turbo": f"{W}/work-gpu"}

def norm(s, fold=False):
    s = unicodedata.normalize("NFC", s).lower()
    if fold:
        s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    s = s.replace("’", "'")
    s = re.sub(r"\b(\w)\.\s?(?=\w\b)", r"\1", s)   # initials: "t.j." and "t. j." -> "tj", as "TJ" is
    s = re.sub(r"[^\w\s']", " ", s)
    s = s.replace("'s ", " ").replace("'", "")
    return re.sub(r"\s+", " ", s).strip()

PREFIX = re.compile(r"^(Vice-Chair|Chair|Rep\.|Sen\.)\s+")
def person(speaker):
    s = PREFIX.sub("", speaker.strip())
    s = re.split(r"[,;]", s)[0].strip()
    return s

def is_suffix(short, full):
    """True when `short` is a strict trailing run of the tokens of `full` ("Finger McDonald" of "Sarah Finger McDonald")."""
    a, b = short.split(), full.split()
    return len(a) < len(b) and b[-len(a):] == a

def names_of(logid, ev):
    text = open(f"{W}/logtext/{logid}.txt").read()
    members = []
    m = re.search(r"MEMBERS PRESENT:(.*?)(?:MEMBER\(S\) EXCUSED:|\n\d\d:\d\d:\d\d)", text, re.S)
    for ln in m.group(1).splitlines():
        ln = ln.strip()
        ln = re.sub(r"(HHED|SLB|HECHS|SRULES)$", "", ln).strip()   # page footer glued to the last line by the PDF text layer
        if ln.startswith("MEMBERS PRESENT:"): ln = ln[len("MEMBERS PRESENT:"):].strip()
        if not ln or not (ln.startswith("Rep.") or ln.startswith("Sen.")): continue
        members.append(person(ln))
    turns = json.load(open(f"{W}/turns-{ev}.json"))["turns"]
    names = {}
    for n in members: names[n] = "member"
    for t in turns:
        sp = t["speaker"]
        p = person(sp)
        if len(p.split()) >= 2 and p not in names and not any(is_suffix(p, k) for k in names):
            if sp.startswith(("Rep.", "Sen.")): names[p] = "member/sponsor"
            elif "LPRO" in sp: names[p] = "staff"
            else: names[p] = "witness"
    # a turn name may come before the member list's longer form; drop any name that is a suffix of another
    for k in [k for k in names if any(is_suffix(k, o) for o in names)]:
        del names[k]
    return names

# multi-word surnames as the log spells them (the last token alone is not the surname)
MULTI_SURNAME = {"Sarah Finger McDonald": "Finger McDonald", "Sara Gelser Blouin": "Gelser Blouin",
                 "Odalis Aguilar Aguilar": "Aguilar Aguilar"}
def surname(n):
    if n in MULTI_SURNAME: return MULTI_SURNAME[n]
    toks = [t for t in n.replace("Jr.", "").split() if t]
    return toks[-1]

def words_text(path):
    d = json.load(open(path))
    return d, " ".join(w["text"] for s in d["segments"] for w in s["words"])

def score_names():
    res = {}
    for ev, logid in EV.items():
        names = names_of(logid, ev)
        for model, wd in MODELS.items():
            p = f"{wd}/{ev}.transcript.json"
            if not os.path.exists(p): continue
            _, txt = words_text(p)
            nt, nf = " " + norm(txt) + " ", " " + norm(txt, True) + " "
            rows = []
            for n, role in names.items():
                full = " " + norm(n) + " " in nt
                full_fold = " " + norm(n, True) + " " in nf
                sur = " " + norm(surname(n)) + " " in nt
                rows.append((n, role, full, full_fold, sur))
            res[(ev, model)] = rows
    return res

if __name__ == "__main__":
    res = score_names()
    out = {}
    for (ev, model), rows in res.items():
        tot = len(rows)
        out[f"{ev}|{model}"] = {"total": tot, "full": sum(r[2] for r in rows), "full_diacritics_folded": sum(r[3] for r in rows), "surname": sum(r[4] for r in rows),
                                "miss_full": [r[0] for r in rows if not r[2]], "miss_surname": [r[0] for r in rows if not r[4]],
                                "by_role": {role: [sum(1 for r in rows if r[1]==role), sum(1 for r in rows if r[1]==role and r[2])] for role in sorted({r[1] for r in rows})}}
    json.dump(out, open(f"{W}/names-score.json", "w"), indent=1, ensure_ascii=False)
    for k, v in out.items():
        print(k, v["total"], "full", v["full"], "fold", v["full_diacritics_folded"], "surname", v["surname"], v["by_role"])
        print("   miss_full:", v["miss_full"])
```

### `near.py`

```python
"""For each witness in a hearing's Recording Log, find the transcript rendering nearest to the logged name.
Candidates are runs of 1, 2 or 3 consecutive transcript words (a name can be split or joined: "Satin -Spiel").
Similarity = difflib ratio of the normalised candidate and the normalised logged name.
Window = from 20 s before to 120 s after the log's turn offset. If nothing in the window reaches 0.7, the nearest
rendering anywhere in the transcript is also reported, with its offset from the log's turn.
nearest() returns, per witness: (best in window, its ratio, name exact anywhere in the transcript, far match or None,
name exact inside the window)."""
import json, difflib, sys
sys.path.insert(0, "/home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff/scripts")
from score import *
CUT = 0.7
def best_in(words, n, pool, off=None):
    """Best rendering of n among runs of 1-3 words of pool. Ties on the ratio go to a run with as many words as the
    name has, then to the one nearest the log's turn (off)."""
    best, key, bt = "", (0.0,), None
    nn = norm(n); nk = len(nn.split())
    for k in (1, 2, 3):
        for i in range(len(pool) - k + 1):
            cand = " ".join(x["text"].strip() for x in pool[i:i+k]).strip(" ,.;:")
            sm = difflib.SequenceMatcher(None, norm(cand), nn)
            if sm.real_quick_ratio() < key[0] or sm.quick_ratio() < key[0]: continue
            kk = (sm.ratio(), k == nk, -abs(pool[i]["start"] - off) if off is not None else 0)
            if kk > key: best, key, bt = cand, kk, pool[i]["start"]
    return best, key[0], bt
def nearest(model, ev, logid):
    names = names_of(logid, ev)
    turns = json.load(open(f"{W}/turns-{ev}.json"))["turns"]
    d = json.load(open(f"{MODELS[model]}/{ev}.transcript.json"))
    words = [w for s in d["segments"] for w in s["words"]]
    out = {}
    for n, role in names.items():
        if role != "witness": continue
        off = next((t["offsetSeconds"] for t in turns if person(t["speaker"]) == n), None)
        win = [w for w in words if off - 20 <= w["start"] <= off + 120]
        # exact = the full name appears anywhere in the transcript (the same test as table (a))
        exact = (" " + norm(n) + " ") in (" " + norm(" ".join(w["text"] for w in words)) + " ")
        b, s, t = best_in(words, n, win, off)
        far = None
        if s < CUT:
            fb, fs, ft = best_in(words, n, words, off)
            far = (fb, round(fs, 2), round(ft - off))
        in_win = (" " + norm(n) + " ") in (" " + norm(" ".join(w["text"] for w in win)) + " ")
        out[n] = (b, round(s, 2), exact, far, in_win)
    return out
if __name__ == "__main__":
    model = sys.argv[1]
    for ev, logid in EV.items():
        print("==", ev)
        for n, (b, s, ok, far, _) in nearest(model, ev, logid).items():
            print(f"  {'OK ' if ok else 'MISS'} {n!r:35} -> {b!r} ({s}) {far or ''}")
```

### `misses_table.py`

```python
import sys; sys.path.insert(0,"/home/dzinck/.claude/jobs/a3847f05/tmp/bakeoff/scripts")
from near import *
"""Rows: witnesses whose full name is not exact anywhere in the transcript of at least one model (the table (a) test).
Cell: "right" if the exact name is inside the window; else the nearest rendering (window first, whole transcript with its
offset from the log's turn if none in the window reaches the cutoff); "below cutoff" if nothing reaches it."""
def f(n, x):
    b, sc, whole, far, inwin = x
    if inwin: return "right"
    if sc >= CUT: txt = b
    elif far and far[1] >= CUT: txt = f"{far[0]} ({far[2]:+d} s from the log's turn)"
    else: txt = f"{b} (nearest in the window, below the cutoff)"
    if whole and norm(txt.split(" (")[0]) != norm(n): txt += " (exact elsewhere in the transcript)"
    return txt
rows = []
for ev, logid in EV.items():
    s = nearest("small.en", ev, logid); t = nearest("large-v3-turbo", ev, logid)
    for n in s:
        if s[n][2] and t[n][2]: continue
        rows.append((ev, n, f(n, s[n]), f(n, t[n])))
cur = None
for ev, n, a, b in rows:
    if ev != cur: print(f"\n**{ev}**\n\n| Log's spelling | small.en wrote | large-v3-turbo wrote |\n|---|---|---|"); cur = ev
    print(f"| {n} | {a} | {b} |")
```

### `wer.py`

```python
"""After the owner fills in the CORRECTED lines of excerpts/<event>-side-by-side.md, run:
       python3 wer.py [--allow-partial] [--dir DIR]
   Reads ONLY the "- CORRECTED:" lines (and the two model lines of each block) of the side-by-side files.
   Per hearing: the CORRECTED lines of all blocks are joined in order into one reference text; each model's line of
   the same blocks is joined in the same order; ONE word-level edit distance is taken per hearing (so a word on a block
   edge that the owner and a model place in different 30 s blocks is not counted twice). Word error = edits / reference
   words. The last row sums edits and reference words over the hearings scored.
   Normalisation is score.norm: lowercase, punctuation removed, apostrophes dropped, initials joined ("T.J." = "TJ").
   A hearing with any empty CORRECTED line is not scored (reported as incomplete); --allow-partial instead scores only
   the filled blocks (joined in order) and says so."""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score import norm, W
MODELS = ["small.en", "large-v3-turbo"]
EVENTS = ["2025021032", "2025031177", "2025041200", "2025041266"]

def ed(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (x != y)))
        prev = cur
    return prev[-1]

def blocks(text):
    """[(heading, {"CORRECTED": str, model: str})] for each '## ' block."""
    out = []
    for blk in text.split("\n## ")[1:]:
        lines = blk.split("\n")
        d, key = {}, None
        for ln in lines[1:]:
            m = re.match(r"- (CORRECTED|small\.en|large-v3-turbo):[ ]?(.*)", ln)
            if m: key = m.group(1); d[key] = m.group(2)
            elif ln.startswith("- ") or not ln.strip(): key = None
            elif key: d[key] += " " + ln          # continuation line of the same entry
        out.append((lines[0], d))
    return out

def score_text(text, allow_partial=False):
    bl = blocks(text)
    filled = [d for _, d in bl if norm(d.get("CORRECTED", ""))]
    empty = len(bl) - len(filled)
    if empty and not (allow_partial and filled): return None, empty, len(bl)
    use = filled
    ref = norm(" ".join(d["CORRECTED"] for d in use)).split()
    res = {}
    for m in MODELS:
        hyp = norm(" ".join(d.get(m, "") for d in use)).split()
        res[m] = (ed(ref, hyp), len(ref), len(hyp))
    return res, empty, len(bl)

def main(argv):
    allow = "--allow-partial" in argv
    d = argv[argv.index("--dir") + 1] if "--dir" in argv else f"{W}/excerpts"
    tot = {m: [0, 0] for m in MODELS}; scored = 0
    print(f"{'event':12}{'ref words':>10}" + "".join(f"{m + ' edits':>24}{'WER':>9}" for m in MODELS))
    for ev in EVENTS:
        res, empty, n = score_text(open(f"{d}/{ev}-side-by-side.md").read(), allow)
        if res is None:
            print(f"{ev:12} not scored: {empty} of {n} CORRECTED lines are empty"); continue
        scored += 1
        line = f"{ev:12}{res[MODELS[0]][1]:>10}"
        for m in MODELS:
            e, r, _ = res[m]; tot[m][0] += e; tot[m][1] += r
            line += f"{e:>24}{e / r:>9.2%}"
        print(line + (f"   (partial: {empty} of {n} blocks left out)" if empty else ""))
    if scored:
        r = tot[MODELS[0]][1]
        print(f"{'total':12}{r:>10}" + "".join(f"{tot[m][0]:>24}{tot[m][0] / r:>9.2%}" for m in MODELS))
    else:
        print("nothing scored yet")
if __name__ == "__main__":
    main(sys.argv[1:])
```

### `disagree.py`

```python
"""Read-only recomputation of the inter-model disagreement per excerpt (what excerpts.py wrote to excerpt-summary.json),
without touching the side-by-side files. Edits = word-level edit distance between small.en's and large-v3-turbo's words
whose start time falls in the window, after score.norm; disagreement = edits / large-v3-turbo's words (and / small.en's)."""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score import *
from wer import ed
S = json.load(open(f"{W}/excerpt-summary.json"))
def toks(m, ev, a, b):
    d = json.load(open(f"{MODELS[m]}/{ev}.transcript.json"))
    return norm(" ".join(w["text"].strip() for s in d["segments"] for w in s["words"] if a <= w["start"] < b)).split()
T = [0, 0, 0]
for ev, v in S.items():
    s, l = toks("small.en", ev, v["start"], v["end"]), toks("large-v3-turbo", ev, v["start"], v["end"])
    e = ed(s, l); T[0] += e; T[1] += len(s); T[2] += len(l)
    print(ev, "small", len(s), "turbo", len(l), "edits", e, f"vs turbo {e/len(l):.4f} vs small {e/len(s):.4f}", "| summary.json:", v["words_small"], v["words_turbo"], v["edits"])
print("all", "small", T[1], "turbo", T[2], "edits", T[0], f"vs turbo {T[0]/T[2]:.4f} vs small {T[0]/T[1]:.4f}")
```

---

## Owner's pick

(blank: to be filled in by the owner)
