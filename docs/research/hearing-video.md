# Oregon Legislature hearing and floor video: hosting, graph links, captions, volume, transcription cost

Researched 2026-10-28 (live checks ran 22:30 to 23:40 Pacific, inside the AUA's 5 pm to 6 am window). Every price is as published on 2026-10-28.

Labels:
- **verified**: I fetched the URL or file and saw the fact.
- **inferred**: my reading of verified evidence. The source doesn't state it.
- **local measurement**: measured on this machine for this note.

Scratch work, scripts, and the transcript sample are in `/home/dzinck/.claude/jobs/a3847f05/tmp/video/` (`scripts/`, `out/`, `pages/`). The cached feed is `/home/dzinck/SessionGateway/.cache/olis-2025R1/feed/`, written `feed/` below.

**How the video pages were observed.** The Invintus player builds its page in JavaScript. I loaded the public OLIS player page (`https://olis.oregonlegislature.gov/liz/mediaplayer/?clientID=…&eventID=…`) in headless Chromium, as a viewer would. I read the rendered page and the request URLs the player made, and pressed its own buttons (Play, Agenda, Download, Turn on captions, Transcript). I also tried to call the Invintus API directly, using the key the player publishes in `https://player.invintus.com/loader.js`. This session's permission layer **blocked** that call as access circumvention, so I made no direct API calls. Every Invintus fact below comes from the rendered player, from files the player itself requested, or from the player's own Download button.

---

## Summary

1. Video is hosted by **Invintus Media**, not Granicus or YouTube. OLIS meeting pages link to an OLIS-branded Invintus player. Streams are HLS (H.264/AAC, 160p–1080p) on Fastly. The player's own **Download** button offers **MP4 and MP3** files on `m-download.invintus.com`. **verified**
2. **The OData feed has no video field.** The only link is a boilerplate agenda comment pointing to a general video page. The Invintus `eventID` appears only on OLIS HTML pages (meeting, session-day). **verified**
3. **Per-agenda-item chapter markers exist.** For committees, the player's Agenda tab lists the same timecodes as the **Recording Log** PDF, which the feed *does* link (1,492 rows, `DocumentType = "Recording Log"`). The log also gives a timecode for **every speaker turn, with names and titles**. In the sample, its timecodes match the MP3 timeline to within about 2 s. **verified**
4. **Captions exist** as EIA-608 embedded in the video stream, with an official disclaimer that they are "not an official record". Their quality is poor. Over a 10-minute sample they lag the audio by a median of 7.8 s and diverge from a local Whisper transcript by a word edit distance of 29%. A few events also have a "Transcript" tab: a WebVTT file with word confidence and generic speaker labels. I saw one in 15 events checked. **verified / local measurement**
5. **Volume estimate for 2025R1: about 2,000 hours** (range about 1,770–2,360). That is about 1,764 h of committee video (1,474 recorded meetings × a mean of 1.20 h from 40 sampled logs) plus about 250–350 h of floor sessions (157 convenings × a sampled median of 1.6 h or mean of 2.2 h). Peak weeks are about 105–120 h. **inferred** (arithmetic on verified counts)
6. **Hosted batch transcription** costs $0.15–$0.36 per audio hour. For the whole session that is about $300–$720; a peak week is about $16–$43. Real-time or streaming tiers cost $0.15–$1.02 per hour. All prices are dated 2026-10-28. **verified** (price pages) / **inferred** (totals)
7. **Local measurement:** faster-whisper `small.en` int8 on CPU (8 threads, Intel Core Ultra 7 265F, load average 0.6 at start) transcribed 600 s of the official MP3 in 46.5 s, a real-time factor of **0.078** (12.9× real time). At that rate the full session is about 155 h of 8-thread compute. The GPU (RTX 5060 Ti 8 GB) was not measured. **local measurement**
8. **Terms:** the AUA defines "Data" as "tabular or numerically derived information", which arguably excludes video. Its clause 3 asks clients to forego regular "scraping" of the Legislature website, and finding event IDs needs OLIS HTML pages. I found no Invintus terms of use. The website disclaimer has no reuse restriction. The legislature's own player offers the download. **verified** (text) / **inferred** (fit)

---

## 1. Hosting

| Item | Finding | Status | Source |
|---|---|---|---|
| Vendor | The legislature's video page embeds the **Invintus** event-listing widget (`https://eventlisting.invintus.com/app.js`, `clientID 4879615486`, listings 252 live, 253 scheduled, 254 recent archives). | verified | https://www.oregonlegislature.gov/citizen_engagement/Pages/Legislative-Video.aspx (HTML, lines with `invintus-event-listing`) |
| What the page says | "The Oregon State Legislature live-streams and archives meetings to ensure public access." | verified | same page |
| Player page | Each OLIS meeting page has a "Recorded Content" link to `https://olis.oregonlegislature.gov/liz/mediaplayer/?clientID=4879615486&eventID=<id>`, which launches `Invintus.launch({clientID, eventID})` through `https://player.invintus.com/loader.js`. | verified | https://olis.oregonlegislature.gov/liz/2025R1/Committees/HALNRW/2025-01-22-08-00/Agenda, and the player page HTML |
| **Committee example** (2025R1) | House Agriculture, Land Use, Natural Resources, and Water (`HALNRW`), 2025-01-22 08:00: **https://olis.oregonlegislature.gov/liz/mediaplayer/?clientID=4879615486&eventID=2025011038**. Player shows duration 1:29:16 (`video.duration` = 5356.07 s). | verified | OLIS meeting page above; rendered player |
| **Floor example** (2025R1) | Senate floor 2025-03-04 11:00: **https://olis.oregonlegislature.gov/liz/mediaplayer/?clientID=4879615486&eventID=2025031021** (1:37:30). House floor same day: eventID `2025031000` (1:34:19). | verified | https://olis.oregonlegislature.gov/liz/2025R1/2025-03-04 (session-day page, "Convened at 11:00 AM" + play icon) |
| Streaming format | HLS. The master playlist is `https://api.v3.invintus.com/StreamURI/hls/4879615486/2025011038/media.m3u8`, a stable pattern of client ID and event ID. It redirects to `invintus-otfp.global.ssl.fastly.net`. Renditions: 284×160, 640×360, 854×480, 1280×720, and 1920×1080; H.264 + AAC (`avc1.640028,mp4a.40.2`); about 6 s MPEG-TS segments; `#EXT-X-PLAYLIST-TYPE:VOD`. | verified | request log of the rendered player; the master playlist file |
| **Download** | The player has a **Download** button with two choices, "Video MP4" and "Audio MP3". Choosing MP3 opened `https://m-download.invintus.com/4879615486/c1a6b888f62c6a9a843b8997c77f4e3195a391ed_audio.mp3` (`Page.windowOpen`). That file is 64,273,108 bytes, `audio/mpeg`, 96 kb/s 48 kHz stereo, 1:29:16. The MP4 at the same path (`….mp4`) is 1,463,051,601 bytes, `video/mp4`. Both come from an S3-compatible origin (`x-amz-*` headers) behind Fastly/Varnish (`via: 1.1 varnish`), with `access-control-allow-origin: *`. | verified (MP3 URL captured from the button; MP4 URL checked by HEAD on the same path, but its button URL was not captured) | rendered player; `curl -I` headers |
| Media key | The file name (`c1a6b888…`) is a hash and cannot be derived from the eventID. Only the player, which gets it from the Invintus API, knows the mapping. | inferred | URLs above |
| Archive latency | The MP3's `last-modified` is `Wed, 22 Jan 2025 19:26:59 GMT` (11:27 Pacific), about 2 h after the meeting ended (08:00 + 1:29). This is one sample. | verified (header) / inferred (typical latency) | `curl -I` |
| API / listing | Invintus has an **undocumented** "embedder" REST API at `https://api.v3.invintus.com/v2`, with endpoints `/Event/getDetailed`, `/Search/general`, `/Listings/getContentYears`, `/Categories/getCategories`, `/Embeded/getListingPreferenceByID`, `/Transcript/getTranscriptV3`, and `/Player/getPlayerPreference`. Its `wsc-api-key` is embedded in public JavaScript. I found no public documentation, RSS, or JSON listing. The OLIS RSS icon points to press releases. OLIS live/upcoming lists are pushed over SignalR (`/liz/signalr/hubs`, `mediaHub.updateEventLists`). | verified (endpoints in `eventlisting.invintus.com/app.js` and `player.invintus.com/loader.js`; RSS link target) / not exercised (direct API calls blocked, see top) | the two scripts; https://olis.oregonlegislature.gov/liz/Scripts/MediaPlayer/PlayerSignalr.js |
| YouTube | No official legislature YouTube channel for hearings was found. The legislature's pages point only to its own player. The former cable carrier, The Oregon Channel, ended in 2011. That is a secondary source, Wikipedia, not relied on. | inferred (absence) | web search 2026-10-28 |
| Physical archive | "archival DVD video content available to the public by request … call Legislative Media at 503-986-1195". The list itself returned "Web Part Error: Access denied". | verified | https://www.oregonlegislature.gov/Pages/video-library.aspx |
| Support topics | The video-support page lists "How to use the Clipping/Sharing Tool", "How to View Agenda and Video at the Same Time", and "What's the Closed Captioning Disclaimer". Their answer text is in a SharePoint list that returned 401. | verified | https://www.oregonlegislature.gov/citizen_engagement/Pages/video-support.aspx |

## 2. Linking video to the session graph

**The feed has no video or media field.** I searched every cached entity set for `video|granicus|youtube|mediaplayer|.m3u8|.mp4`. The only hits are:
- `CommitteeAgendaItems.Comments`: 2,006 boilerplate links to the general video page ("To access links to a livestream or recordings of legislative meetings: https://www.oregonlegislature.gov/citizen_engagement/Pages/Legislative-Video.aspx"). **verified** (`feed/CommitteeAgendaItems.json`)
- 16 `CommitteeMeetingDocuments` exhibits titled "(video)" or "(video link)", which are presenters' materials. **verified**

No eventID appears anywhere in the feed. **verified**

**Where the eventID lives.** It appears in two kinds of OLIS HTML page:
- The committee meeting page `/liz/{session}/Committees/{CommitteeCode}/{yyyy-MM-dd-HH-mm}/Agenda`. The URL keys are exactly `CommitteeMeetings.CommitteeCode` and `MeetingDate`. **verified**
- The session-day page `/liz/{session}/{yyyy-MM-dd}`, which carries one link per chamber for floor sessions next to "Convened at …" and one per committee meeting under `SessionDay/ScheduledMeetings?sessionDate=…`. **verified**

Event IDs look like `YYYYMM` plus a 4-digit sequence (`2025011038`, `2025031021`, `2025061166`). They cannot be computed from the meeting key. **inferred** from 17 observed IDs.

Mapping to feed entities:

| Video | Feed key | How |
|---|---|---|
| Committee meeting video | `CommitteeMeetings (SessionKey, CommitteeCode, MeetingDate)` | The OLIS meeting page for that key has exactly one "Recorded Content" link. **verified** for HALNRW 2025-01-22. |
| Floor session video | `ConveneTimes (SessionKey, SessionDate, Chamber)` | The session-day page shows "Senate / House … Convened at HH:MM" plus a link. A reconvened day shows one link ("10:00 AM, Reconvened at 2:15 PM"). **verified** for 7 dates. |
| Agenda item / measure in a committee video | `CommitteeAgendaItems (CommitteCode, MeetingDate, MeasurePrefix, MeasureNumber)` | Recording Log line "HB 2167 - Public Hearing" at `00:01:37`. **verified** (see below). |
| Measure in a floor video | `FloorSessionAgendaItems`, `MeasureVotes` | Player Agenda chapters, e.g. `0:30:18 HB 2706 A-Eng - Boshart Davis - Third reading commenced`. **verified** |

**Per-agenda-item timestamps: committee meetings.** Each feed-linked **Recording Log** PDF lists elapsed timecodes for the call to order, each agenda item, each motion and vote, each speaker, and adjournment. Example: `feed/CommitteeMeetingDocuments.json` id 288741, https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/288741, `HALNRW 1-22-2025 (recording log)`. Excerpt from `pdftotext -layout`:

```
00:01:37           HB 2167 - Public Hearing
00:01:38           Co-Chair Helm
00:01:47           Anna Glueder, LPRO Analyst
00:02:49           Kurt Williams, Director, Oregon Veterinary Diagnostics Lab, Oregon State
                   University (OSU)
00:06:15           Melissa Rice, student, Carlson College of Veterinary Medicine, OSU
...
01:29:10           Meeting Adjourned
This recording log is in compliance with Senate and House Rules. For complete contents, refer to the digital audio recording.
```

- The player's Agenda tab for the same event shows the same agenda timecodes: `0:00:03 Meeting Called to Order … 0:01:37 HB 2167 - Public Hearing … 1:15:48 HB 3131 - Public Hearing … 1:29:10 Meeting Adjourned`. **verified** (rendered player)
- The log's clock matches the media clock. The log says adjournment was at 01:29:10, and the video runs 1:29:16. Speaker-turn times match the local Whisper transcript of the MP3 to within about 0–5 s: Glueder 00:01:47 in the log vs. 00:01:47 in Whisper; Williams 00:02:49 vs. 00:02:47–00:02:51; Rice 00:06:15 vs. 00:06:13; Krebs 00:08:44 vs. about 00:08:41. **local measurement**
- `CommitteeMeetingDocuments` holds 1,492 Recording Log rows for 1,474 distinct meetings. 17 meetings have two logs. All 1,474 match a `Scheduled` meeting, and 9 `Scheduled` meetings have no log. **verified** (`feed/`)
- The OLIS URL `https://apps.oregonlegislature.gov/liz/2025R1/Downloads/RecordingLog/{CommitteeCode}/{yyyy-MM-dd-HH-mm}` returns the same bytes as the feed's `DocumentUrl`: MD5 identical for SRULES 2025-03-03. **verified**
- **Recording logs are posted late.** For the 1,492 logs, `CreatedDate − MeetingDate` has a median of 382 h (about 16 days). 194 were posted within 24 h, 267 within 72 h, and 418 within 7 days. The HALNRW log was posted 7 days after the meeting, while its MP3 existed about 2 h after it. Whether the player's Agenda chapters appear on the day of the meeting was not observed. **verified** (feed timestamps) / open question (live chapters)

**Per-agenda-item timestamps: floor sessions.** The feed has no floor recording logs. The player's Agenda tab carries measure-level chapters. Example from House 2025-05-06, eventID 2025051043: `0:24:00 HB 2567 B-Eng - Lively moved the House concur in Senate amendments and repass the bill … 0:30:18 HB 2706 A-Eng - Boshart Davis - Third reading commenced 0:31:26 HB 2706 A-Eng - Boshart Davis opened … 1:55:29 ADJOURNMENT`. These chapters name the carrier but not every speaker. They are reachable only through the player, the Invintus API. **verified** (rendered player for 14 floor sessions)

## 3. Existing captions and transcripts

| Source | What exists | Quality and timing | Reachable from feed? | Status / source |
|---|---|---|---|---|
| Closed captions | EIA-608 captions embedded in the H.264 stream of every rendition, both 160p and 1080p. The HLS playlist declares no `CLOSED-CAPTIONS`/`SUBTITLES` group, but `ffmpeg -f lavfi movie=…[out0+subcc]` extracts them. The player shows "Turn on captions" once playback starts. Roll-up style, mixed case, `>>` marks a speaker change, no names. | Over 600 s of the HALNRW sample: median lag **7.8 s** behind the audio (145 matched distinctive words, range 4.8–13.0 s). The word edit distance against the local Whisper transcript is **507 / 1,740 = 0.29**. This is divergence between two machine outputs, not a WER against ground truth. Errors seen: "HB 2, 1, 6, 7", "glued or" for Glueder, "lawrie's bat a cousin" for Lois Bates Acheson, "2.5 million" where the audio says 3.5, "laugh" for lab. Live and archive captions are presumably the same stream (inferred). | No | local measurement (`out/cc_600s_collapsed.txt`, `scripts/cc_compare.py`) |
| Caption disclaimer | "The Oregon Legislative Assembly provides closed captioning as a public service solely for the convenience of viewers. The information displayed in a closed caption is not an official record of any proceeding, is not an official record of the Legislative Assembly and may not be relied upon as an accurate or complete record of any proceeding." | n/a | n/a | verified: player page and https://www.oregonlegislature.gov/Pages/disclaimer.aspx |
| Invintus "Transcript" tab | **Some** events have a Transcript tab with search, word highlighting, and "Download transcript". Senate floor 2025-01-21 (eventID 2025011019) loads `https://m-download.invintus.com/4879615486/fac472a7619170ff206acdb3dd861492aa16a546.vtt` (77,291 bytes, `last-modified` 2025-02-10, about 3 weeks after the session). It is WebVTT with `<v.Male.spk1.Speaker1>` voice tags and per-word `<c.CONF_HIGH|CONF_MEDIUM>` confidence. | Machine output, similar in quality to the captions ("Our indication this morning as by senator Casey John a."). It has generic speaker numbers, not names. **1 of 15 events checked** had the tab (14 floor sessions plus the HALNRW hearing). | No | verified (rendered player; VTT file) |
| CART | The agenda says human CART (Communication Access Realtime Translation) can be requested "at least 3 days in advance". Whether CART output is kept was not checked. | n/a | No | verified: https://olis.oregonlegislature.gov/liz/2025R1/Committees/HALNRW/2025-01-22-08-00/AgendaItems |
| Minutes | For committees, the **Recording Log** replaces minutes. It is a speaker-and-topic index with timecodes, not a transcript: "For complete contents, refer to the digital audio recording." | Exact timecodes (see §2), no speech text | **Yes** (`CommitteeMeetingDocuments`, type "Recording Log") | verified |
| Floor journals | Not checked in this pass. | | | open question |
| YouTube auto-captions | No YouTube channel found. | | | inferred (absence) |

Captions exist, but at this quality they don't replace transcription for search or quotation. They might work as a fallback for live use. **inferred**

## 4. Volume estimate for 2025R1 (estimate)

All counts come from the cached feed. All durations are verified samples. The arithmetic is **inferred**.

- **Committee meetings with recordings:** 1,474. These are the distinct meetings with a Recording Log, from 1,696 `CommitteeMeetings` rows: 1,483 Scheduled, 129 "No Meeting Scheduled", 84 Cancelled.
- **Committee duration sample:** 40 Recording Logs chosen at random (`random.seed(20261028)`, `scripts/log_durations.py`). Duration is the "Meeting Adjourned" timecode, which every sampled log had. Results: mean **1.197 h**, SD 0.517, SE 0.082; median 1.26 h; p25 0.88 h; p75 1.52 h; range 0.02–2.93 h. The log end matched the video length for the one meeting where both were checked.
- **Committee hours:** 1,474 × 1.197 h = **1,764 h**. Using ±2 SE gives 1,523–2,006 h.
- **Floor convenings:** `ConveneTimes` has 157 rows (79 dates × about 2 chambers).
- **Floor duration sample:** 14 player durations on 7 dates spread across the session. This sample was chosen, not random, and includes the final week. Durations: 0.41, 0.39, 1.27, 0.63, 1.49, 1.61, 1.43, 1.93, 1.90, 4.27, 3.83, **8.60** (House 2025-06-25), 1.62, 1.57 h. Median 1.59 h, mean 2.21 h. Floor videos include pre-roll before the gavel: the Senate 2025-06-25 video reaches "come to order" at 1:12:00.
- **Floor hours:** 157 × 1.59 = **250 h** (median) to 157 × 2.21 = **347 h** (mean).
- **Session total: about 2,000 h** (about 1,770–2,360 h).
- **Per week:** committee meetings with logs ran 62–87 a week from ISO week 5 to week 21 (peak 87), and floor convenings ran 3–10 a week. A peak week is therefore about 87 × 1.2 ≈ 104 h of committee video plus about 8 × 1.6–2.2 ≈ 13–18 h of floor video, **about 105–120 h**. The last weeks (weeks 25–26) have 20–28 committee meetings but long floor days.
- **Bytes**, scaling the sample's file sizes (inferred): MP3 at 96 kb/s ≈ 43 MB per hour, so about 86 GB for the session. MP4 at 1080p ≈ 0.98 GB per hour (1.46 GB for 1.49 h), so about 2 TB.

## 5. Transcription options and cost

### 5a. Hosted APIs (prices as published 2026-10-28)

| Provider / model | Mode | Price as published | Per audio hour | Diarization | Notes | Source |
|---|---|---|---|---|---|---|
| OpenAI `gpt-transcribe` | file upload | $0.0045 / minute | $0.27 | not stated for this model | Page calls it "the recommended model for transcribing recorded speech". Files can be up to 25 MB, so a 1.5 h MP3 at 96 kb/s needs re-encoding or splitting. | https://developers.openai.com/api/docs/pricing ; https://developers.openai.com/api/docs/guides/speech-to-text |
| OpenAI `gpt-4o-mini-transcribe` | file | $0.003 / minute | $0.18 | no | Deprecated: "will shut down on February 26, 2027" | same |
| OpenAI `gpt-4o-transcribe`, `whisper-1` | file | $0.006 / minute | $0.36 | no | Deprecated on the same date. `timestamp_granularities[]` is "only supported for `whisper-1`" | same |
| OpenAI `gpt-4o-transcribe-diarize` | file | $0.006 / minute | $0.36 | yes: `diarized_json` with `speaker`, `start`, `end`; up to 4 known-speaker reference clips of 2–10 s | Deprecated on the same date | same |
| OpenAI `gpt-realtime-whisper` / `gpt-live-transcribe` | live | $0.017 / minute | $1.02 | not stated | live transcription | pricing page |
| Azure AI Speech, batch (S1 "Speech to Text Batch") | batch | $0.18 / hour | $0.18 | the price list has no separate diarization meter for batch (whether it is included was not verified) | Free tier: "5 audio hours free per month" for real-time; "Batch transcription isn't supported on the free tier" | Azure Retail Prices API `https://prices.azure.com/api/retail/prices` (westus2, meter "S1 Speech to Text Batch", effective 2024-05-01); https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/ |
| Azure AI Speech, real-time (S1 "Speech To Text") | live | $1.00 / hour | $1.00 | add-on "per hour per feature" (amount not rendered) | | same |
| Azure AI Speech, fast transcription | file | $0.36 / hour; "Fast Transcription Promo" $0.10 / hour effective 2026-09-01 | $0.36 (promo $0.10) | | Promo end date not found | Retail Prices API |
| Google Cloud STT V2, standard (includes `chirp`) | sync/streaming | $0.016 / minute (0–500,000 min/month) | $0.96 | Chirp 3: "Automatically identifies the different speakers in a single-channel audio sample" (batch) | | https://cloud.google.com/speech-to-text/pricing ; https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3 |
| Google Cloud STT V2, dynamic batch | batch (lower urgency) | $0.003 / minute | $0.18 | as above | BatchRecognize covers "1 minute to 1 hour in general, but up to 20 minutes with word-level timestamp enabled". The 60 free minutes/month appear in the V1 table. | same |
| AssemblyAI Universal-2 | file | $0.15 / hr | $0.15 | +$0.02/hr (async standard) | $50 free credit | https://www.assemblyai.com/pricing |
| AssemblyAI Universal-3.5 Pro | file | $0.21 / hr | $0.21 | +$0.02/hr | | same |
| AssemblyAI Universal-Streaming English | live | $0.15 / hr (billed on session time) | $0.15 | +$0.12/hr | | same |
| Deepgram Nova-3 (monolingual) | file / live | $0.0043 / min pre-recorded; $0.0077 / min streaming | $0.258 / $0.462 | included for pre-recorded; +$0.0020/min streaming | "Free $200 credit" | https://deepgram.com/pricing |

**Session and weekly totals** (inferred; hours from §4: about 2,000 h per session, about 120 h in a peak week):

| Rate per audio hour | Session (1,770–2,360 h) | Peak week (about 120 h) |
|---|---|---|
| $0.15 (AssemblyAI U-2) | $266–$354 | $18 |
| $0.18 (Azure batch; Google dynamic batch; OpenAI 4o-mini) | $319–$425 | $22 |
| $0.258 (Deepgram Nova-3 pre-recorded) | $457–$609 | $31 |
| $0.27 (OpenAI gpt-transcribe) | $478–$637 | $32 |
| $0.36 (OpenAI 4o / diarize / whisper-1; Azure fast) | $637–$850 | $43 |
| $0.96–$1.02 (Google standard; Azure real-time; OpenAI realtime) | $1,700–$2,407 | $115–$122 |

Free credits as published: Deepgram's $200 covers about 775 h of Nova-3 pre-recorded audio, and AssemblyAI's $50 covers about 333 h of Universal-2 (both inferred from the prices). Azure's free tier is 5 h a month of real-time only.

### 5b. Local models

| Model | Size | Licence | Speed evidence | Source |
|---|---|---|---|---|
| faster-whisper (CTranslate2) | `small.en` weights 464 MB on disk (local measurement) | MIT (code); `Systran/faster-whisper-small.en` MIT | README, 13 min audio: CPU `small` int8 beam 5 in 1m42s on an i7-12700K with 8 threads (RTF 0.13); GPU `large-v2` int8 in 59s, or 16s with `batch_size=8`, on an RTX 3070 Ti 8 GB (RTF 0.076 / 0.021). GPU needs "cuBLAS for CUDA 12 and cuDNN 9". | https://github.com/SYSTRAN/faster-whisper ; HF API `Systran/faster-whisper-small.en` |
| whisper.cpp | small 466 MiB, ~852 MB RAM; large 2.9 GiB, ~3.9 GB RAM | MIT | CPU `small` fp32 in 2m05s for 13 min (faster-whisper README). Backends: CUDA, Vulkan, OpenVINO, and others. Experimental diarization through `small.en-tdrz` (`[SPEAKER_TURN]`). | https://github.com/ggml-org/whisper.cpp |
| Whisper large-v3-turbo / large-v3 | (not downloaded) | HF cards: turbo MIT; large-v3 apache-2.0 | n/a | HF API `openai/whisper-large-v3-turbo`, `openai/whisper-large-v3` |
| distil-whisper distil-large-v3.5 | (not downloaded) | MIT | n/a | HF API `distil-whisper/distil-large-v3.5` |
| NVIDIA Parakeet TDT 0.6B v3 | 0.6 B params | CC-BY-4.0, "ready for commercial/non-commercial use" | RTFx 3,332.74 on the Open ASR Leaderboard (hardware not stated); average WER 6.34%; word and segment timestamps; "Up to 24 minutes per pass" with full attention, "up to 3 hours" with local attention; GPU-oriented. | https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 |
| NVIDIA Canary 1B v2 | 1 B | CC-BY-4.0 | not checked | HF API `nvidia/canary-1b-v2` |

**This machine:** `nvidia-smi` shows an **NVIDIA GeForce RTX 5060 Ti, 8,151 MiB**, driver 610.57.01, CUDA UMD 13.3, with 1,429 MiB in use. The CPU is an Intel Core Ultra 7 265F (20 cores), with 19 GB RAM. **verified** (`nvidia-smi`, `lscpu`, `free`)

GPU transcription was **not measured**. The CUDA 12 cuBLAS and cuDNN 9 wheels faster-whisper needs are over 1 GB, beyond this job's download budget. The README's RTX 3070 Ti figures above are the nearest published reference. **inferred**

**Running local transcription on the free hosting tiers** (inferred, rough):
- From the measurement in §6, CPU cost is about 279 s × 8 threads ≈ **2,230 vCPU-s per audio hour**, assuming a cloud vCPU is about as fast as one local core.
- Cloud Run Jobs' free tier is "First 240,000 vCPU-seconds free per month; First 450,000 GiB-seconds", which covers about **107 audio hours a month**. Request-based services get 180,000 vCPU-s, about 80 h. The Azure Container Apps grant is "180,000 vCPU-seconds, 360,000 GiB-seconds, and 2 million requests per subscription per month", also about 80 h.
- A peak session month is about 450 h, so it exceeds these grants with `small.en`; larger models need more.
- Cloud Run GPU (NVIDIA L4) is $0.0001867/s ($0.67/h), and no GPU free tier is listed.
- Sources: https://cloud.google.com/run/pricing, https://azure.microsoft.com/en-us/pricing/details/container-apps/ (both verified 2026-10-28).

### 5c. Diarization and mapping speakers to legislators

- **Committees:** the Recording Log already says **who spoke when, by name and title** ("Co-Chair Helm", "Rep. B. Levy", "Anna Glueder, LPRO Analyst"). Its timecodes are on the media clock (§2), so transcript words or segments can be labelled by time interval without acoustic diarization. One wrinkle: Whisper segments sometimes span a turn change ("…We appreciate your testimony. And then Dr. Krebs. Hi, good morning everybody. My name is Wendy Krebs."), so labelling needs word-level timestamps, which faster-whisper provides (`word_timestamps=True`). Legislator names in the log ("Rep. B. Levy") would be resolved against `feed/Legislators.json` and `feed/CommitteeMembers.json`. Not tested. The catch is timing: logs are posted with a median lag of 16 days (§2). **verified** (log content and alignment) / **inferred** (method)
- **Floor:** there is no recording log. Player chapters give per-measure markers and the carrier's name, and roll-call order comes from `MeasureVotes`. Acoustic diarization would be needed for other speakers. **verified** (chapters) / **inferred** (need)
- **Acoustic diarization options:**
  - pyannote `speaker-diarization-community-1`: CC-BY-4.0, gated (accept conditions plus an HF token). It provides `exclusive_speaker_diarization` "to simplify aligning speaker turns with transcription timestamps". DER on AMI is 17.0%, and on VoxConverse 11.2%. A hosted "precision-2" scores better, but no price is published. (https://huggingface.co/pyannote/speaker-diarization-community-1)
  - NVIDIA `diar_streaming_sortformer_4spk-v2`: CC-BY-4.0, max 4 speakers. `diar_sortformer_4spk-v1` is CC-BY-**NC**-4.0. (HF API)
  - Hosted: AssemblyAI (+$0.02/h), Deepgram (included for pre-recorded), OpenAI `gpt-4o-transcribe-diarize` (up to 4 known-speaker reference clips), Google Chirp 3 (batch).
  - Acoustic diarization yields anonymous speakers. Turning those into legislator names needs a name source (the recording log, voice reference clips, or roll calls). **inferred**

## 6. Local measurement

All rows below are **local measurements** taken 2026-10-28 between 22:44 and 22:50 Pacific.

| Item | Value |
|---|---|
| Source | Official MP3 from the player's Download → Audio MP3 button: `https://m-download.invintus.com/4879615486/c1a6b888f62c6a9a843b8997c77f4e3195a391ed_audio.mp3` (HALNRW 2025-01-22). The full 64.3 MB file downloaded in 44 s. |
| Sample | 600 s, from 00:01:37 (start of HB 2167) to 00:11:37, cut with ffmpeg 7.0.2 (`imageio-ffmpeg` static build) to 16 kHz mono WAV |
| Engine | faster-whisper 1.2.1, ctranslate2 4.8.4, model `small.en`, `compute_type=int8`, `cpu_threads=8`, `beam_size=5`, `vad_filter=True`, in a scratch venv |
| Load | `uptime` load average 0.74 before, 4.97 after (1-minute). No other heavy job was running at the start. |
| Time | model load 0.9 s; transcription **46.5 s** for 600 s of audio |
| **Real-time factor** | **0.0775** (12.9× faster than real time) |
| Extrapolation (inferred) | about 2,000 h × 0.0775 ≈ 155 h of 8-thread CPU time per session (about 6.5 days running non-stop); about 120 h × 0.0775 ≈ 9.3 h for a peak week |

Excerpt of the output (meeting clock = sample time + 97 s; file `out/small.en_600s.json`):

```
00:01:37 So I'll open a public hearing on House Bill 2167 and invite Ms. Gluter to give us the
00:01:46 summary.
00:01:47 Chair, members of the committee, House Bill 2167 appropriates $10 million from the General
00:01:54 Fund to the Higher Education Coordinating Commission for Distribution to the Carlson College
00:01:59 of Veterinary Medicine at Oregon State University to support veterinary education programs and
00:02:04 the College's Lois Batch Eichison Veterinary Teaching Hospital.
00:02:07 It further appropriates $3.5 million from the General Fund to the Commission for Distribution
00:02:11 to OSU Veterinary Diagnostics Lab to support faculty and personnel working on chronic wasting
00:02:16 disease and zoonotic diseases.
...
00:02:51 Co-chairs Hellman-Owens and members of the committee, my name is Kurt Williams and I
00:02:55 serve as the Director of the Oregon Veterinary Diagnostic Lab at Oregon State University.
```

The same passage in the embedded captions (`out/cc_600s_collapsed.txt`), about 5–8 s later:

```
00:01:42 Public hearing so open a public
00:01:44 hearing on House bill. 2, 1, 6,
00:01:47 7, And invite miss
00:01:50 glued or to give
00:01:53 us the summary down members of
00:01:55 the committee House bill 2167
...
00:02:11 and the college’s lawrie’s bat
00:02:12 a cousin veterinary teaching
00:02:15 appropriate 2.5 million from
```

Errors in the Whisper output are mostly proper nouns: "Gluter" for Glueder, "Hellman-Owens" for Helm and Owens, "HP 2167" for HB 2167, "Lois Batch Eichison" for Lois Bates Acheson. **local measurement**

What was downloaded:
- Media: 64.3 MB (MP3), 35 MB (101 HLS segments at 160p plus one 1.8 MB 1080p segment, used to extract captions), and 77 KB (one VTT).
- Documents: 7 MB of Recording Log PDFs (42 files, feed-linked).
- Tooling, not media: about 550 MB of Python wheels and the 464 MB model.

Large media and the model were deleted afterwards. The transcript and caption extracts are kept in `out/`.

## 7. The AUA and the video host's terms

**The OData AUA**, quoted exactly from `olis-odata.md` §1 (source: https://www.oregonlegislature.gov/citizen_engagement/Documents/OLODataAcceptableUseAgreement.pdf):

> Data is defined as tabular or numerically derived information in digital form.

> 3. Clients agree to utilize the Oregon Legislature Open Data Service as the preferred method to obtain Oregon legislative data and forego regular "scraping" of the Oregon Legislature Website.

> 5. Oregon Legislature Information Services reserves the right to temporarily suspend the Open Data Service, and also the ability to "scrape" the Oregon Legislature Website, if client usage is significantly impacting the performance of the Oregon Legislature Information System (OLIS) or other Oregon Legislature applications.

**The website disclaimer** (https://www.oregonlegislature.gov/Pages/disclaimer.aspx) is the only terms page found for oregonlegislature.gov. Its text in full:

> General: Information on the Oregon Legislature's website is made available as a public service. It does not constitute or represent an official record of the Oregon Legislature. … The Legislature, its offices, and employees make no warranty as to the accuracy, reliability, completeness, or timeliness of any information on the Oregon Legislature's website and are not responsible for any errors or omissions or for results obtained from the use or misuse of this information.

It also has the closed-caption paragraph quoted in §3. It contains no copyright notice, licence, or reuse restriction. **verified**

**Invintus:**
- `https://www.invintus.com/terms`, `/terms-of-use`, and `/terms-of-service` return 404.
- `https://player.invintus.com/terms` returns only the player's app shell (592 bytes, no text).
- `https://www.invintus.com/privacy-policy` exists, but I found no download or reuse terms in it.
- No Invintus terms of use for viewers were found.

**verified** (HTTP responses 2026-10-28)

How video downloading relates to these terms (facts and trade-offs only):

| Point | Status |
|---|---|
| The legislature's own player offers "Download → Video MP4 / Audio MP3" to any viewer, so downloading single recordings is a sanctioned feature. | verified |
| Video and audio files are not "tabular or numerically derived information", so the AUA's scope ("Data") arguably doesn't reach them. Clause 3 is about obtaining "Oregon legislative data" and scraping "the Oregon Legislature Website". | inferred |
| The media files are served from Invintus and Fastly hosts (`m-download.invintus.com`, `invintus-otfp.global.ssl.fastly.net`), not from `oregonlegislature.gov`. | verified (hosts) / inferred (whether clause 3 applies) |
| The bottleneck is *discovery*, not download. The eventID, and the hashed file name behind it, can't be found through the feed. Each video needs either (a) an OLIS HTML page (a meeting page or session-day page, i.e. "the Oregon Legislature Website", the activity clause 3 asks clients to forego "regular"ly), or (b) the undocumented Invintus embedder API using the key in public JavaScript. This session's permission layer blocked (b) as circumvention. About 1,470 meeting pages plus 79 day pages per session would be needed. | verified (no ID in feed; blocked call) / inferred (count) |
| The Recording Logs that carry the timecodes are feed-linked documents, so they fall under the existing "download only what the feed links, once, 5 pm–6 am" rule in `early-decisions.md`. | verified |
| Bulk volume: about 86 GB of MP3 or about 2 TB of MP4 per session (§4) from a vendor CDN. No rate limits or terms were published. | inferred |
| Captions and the Invintus transcripts carry the legislature's "not an official record" disclaimer. The recording log says the "digital audio recording" holds the complete contents. | verified |

---

## Comparison of transcription options

Prices are as published 2026-10-28. "Session" means about 2,000 h (1,770–2,360). "Peak week" means about 120 h. Totals are inferred.

| Option | Where it runs | Per audio hour | Session | Peak week | Live-capable | Timestamps | Diarization | Licence / terms | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| Existing EIA-608 captions | already in stream | $0 | $0 | $0 | yes (inferred) | cue-level, ~7.8 s late | `>>` turn marks only | Legislature disclaimer | local measurement |
| Invintus transcript VTT | already hosted, some events only | $0 | n/a | n/a | no (posted ~3 weeks later) | word-level | generic Speaker1/2 | same | verified (1 of 15) |
| faster-whisper `small.en` int8, CPU | local machine | electricity | ~155 h of 8-thread CPU | ~9.3 h CPU | near-live (12.9× real time) | segment + word | none (use recording log / pyannote) | MIT | local measurement (RTF 0.0775) |
| faster-whisper `large-v2` int8, GPU | local GPU (8 GB) | electricity | ~150 h (RTF 0.076) or ~42 h batched (0.021), on the README's 3070 Ti | ~2.5–9 h | yes | segment + word | none | MIT | README benchmark, not measured here |
| whisper.cpp | local CPU/GPU | electricity | similar to faster-whisper (README CPU small: 2m05s per 13 min) | | yes | segment/word | experimental tinydiarize | MIT | GitHub README |
| Parakeet TDT 0.6B v3 | local GPU | electricity | not measured (RTFx 3,333 published, hardware unstated) | | yes | word + segment | none | CC-BY-4.0 | HF model card |
| Free-tier container (Cloud Run Jobs / ACA) with local model | cloud CPU | $0 up to ~80–107 h a month | exceeds the free grant | exceeds | slow | as model | as model | provider ToS | inferred from free-grant text |
| AssemblyAI Universal-2 | hosted batch | $0.15 (+$0.02 diarization) | $266–$354 (+$35–$47) | $18 (+$2.4) | streaming $0.15/h | word | yes | vendor ToS | pricing page |
| Azure batch | hosted batch | $0.18 | $319–$425 | $22 | no (real-time $1.00) | word | not verified | vendor ToS | Retail Prices API |
| Google STT V2 dynamic batch (Chirp) | hosted batch | $0.18 | $319–$425 | $22 | no | word (≤20 min with word timestamps) | Chirp 3 batch | vendor ToS | pricing + Chirp 3 docs |
| OpenAI gpt-4o-mini-transcribe | hosted file | $0.18 | $319–$425 | $22 | no | none listed | no | deprecated 2027-02-26 | pricing + guide |
| Deepgram Nova-3 | hosted file / stream | $0.258 file; $0.462 stream | $457–$609 | $31 | yes | word | included (file) | $200 credit | pricing page |
| OpenAI gpt-transcribe | hosted file | $0.27 | $478–$637 | $32 | no ($1.02 realtime) | not stated | not stated | 25 MB file limit | pricing + guide |
| OpenAI gpt-4o-transcribe-diarize | hosted file | $0.36 | $637–$850 | $43 | no | segment | yes, plus 4 reference voices | deprecated 2027-02-26 | pricing + guide |
| Azure real-time | hosted stream | $1.00 | $1,770–$2,360 | $120 | yes | word | add-on | 5 h/month free | Retail Prices API |

## Open questions

1. **Discovering event IDs without scraping.** Would the legislature (Leg.Helpdesk@oregonlegislature.gov, or Legislative Media at 503-986-1195) add the Invintus eventID or media URL to the OData feed, or approve use of the Invintus embedder API or a bulk export? Without that, linking a video needs one OLIS HTML page per meeting.
2. **Live-session timing.** Do the player's Agenda chapters appear while a meeting is live or soon after, given that the Recording Log PDF lags by a median of 16 days? Does the live HLS stream carry the same 608 captions, and how soon after adjournment do the MP3 and MP4 appear across many meetings? Only one sample was seen, about 2 h after.
3. **The Invintus Transcript tab.** What decides which events get a transcript? Only 1 of 15 had one. Is it on request, and is it produced from the captions?
4. **Terms.** Does Invintus have viewer terms of use, or a contract with the legislature that covers bulk download or redistribution of the MP3 and MP4 files? Does the legislature regard downloading via the player's button at session scale as fine under AUA clause 3?
5. **Floor-session speaker data.** Do the House and Senate Journals, or any floor log, give speaker timecodes the way committee recording logs do?
6. **Recordings without logs.** Do the 9 `Scheduled` meetings without a log, and the 129 "No Meeting Scheduled" rows, ever have video? Are there recorded events (informational meetings, work sessions) outside `CommitteeMeetings`?
7. **GPU throughput on this machine.** Needs the CUDA 12 cuBLAS and cuDNN 9 runtime (over 1 GB) to measure faster-whisper or Parakeet on the RTX 5060 Ti. Quality of larger models (large-v3-turbo, Parakeet) on hearing audio was not measured either.
8. **Recording-log-to-speaker alignment at scale.** The sample matched within about 5 s for 5 turns. Does that hold for remote testimony, recesses (5 of 40 sampled logs mention a recess), and meetings with two logs (17 cases)?
9. **Azure batch diarization:** included or billed separately? The price list shows no separate meter.
10. **Promo pricing:** when does Azure's "Fast Transcription Promo" ($0.10/h from 2026-09-01) end?
