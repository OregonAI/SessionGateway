# Finding each 2026R1 committee meeting's video without breaching terms

Researched 2026-11-04, 21:00–21:12 Pacific (PST). That is inside the AUA's 5 pm–6 am window. This note follows `docs/research/hearing-video.md` (2026-10-28), referred to below as "the prior note".

Labels:
- **verified**: I read the fact at the URL, file, or command given. Quotes are exact.
- **inferred**: my reading of verified evidence. The source doesn't say it.
- **not found**: I looked and found nothing. That doesn't prove absence.
- **secondary**: a reputable summary, not the primary text.
- **local measurement**: measured on this machine for this note.

Ground rules I kept:
- I made **no call to any Invintus API endpoint**, with or without a key. The one exception is `api.v3.invintus.com/robots.txt`, which takes no key and is not an API method.
- I used no credential, token, or key that I found.
- I enumerated nothing.
- Key values are not reproduced in this note. Keys are identified only by where they appear and, when compared, by a SHA-256 prefix.
- OLIS / oregonlegislature.gov fetches were 9 in total: 4 robots.txt files, 2 feed-linked Recording Log PDFs, and 3 public-records policy pages. All were between 21:01 and 21:10 PST (list at the end). I fetched no meeting or session-day pages. Structural facts about those pages come from the prior session's cached copies, the research cache's `video-research/pages/` (not committed) (fetched 2026-10-28).

Working files (`fetched/`, `gh/`, `fetchlog.txt`) were local to the research job and are not committed.

---

## Summary

1. **A route that needs no scraping exists: the Recording Log PDFs already in the feed carry the eventID.**
   - Every timecode line in a committee Recording Log is a clickable PDF link annotation to `https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=<id>&startStreamAt=<seconds>`.
   - 43 of 43 cached 2025R1 logs carry it, each with exactly one eventID. Both 2026R1 logs fetched tonight carry it: JWM 2026-02-02 → `2026021004`; HRULES 2026-03-06 14:00 → `2026031032`.
   - The prior note's HALNRW eventID `2025011038` matches its log's annotations.
   - **verified** (`/URI` annotations parsed from the PDFs; §d1)
2. **All 279 scheduled 2026R1 committee meetings have a feed-linked Recording Log** (279 `recording_log` rows for 279 meetings, over 25 distinct days, 2026-02-02 to 2026-03-06). So route (d) covers the whole backfill. **measured locally** (a read-only query of the 2026R1 backfill's index database on the researcher's machine; the file was not committed, so a reader cannot re-run it)
3. **The stored text drops the links.** The ingest keeps only extracted text: none of the 279 logs' text contains "mediaplayer" or "eventID". The eventIDs need either a change to extraction (read link annotations) or one more fetch of 279 feed-linked PDFs, which ADR-0005 and the existing feed-linked-document rule already cover. **measured locally** (a text search of that same uncommitted database) / **inferred** (remedy)
4. **The `startStreamAt` values give a seconds-on-the-media-clock offset for each speaker turn and agenda item.** That is a better alignment key than the printed `hh:mm:ss`. **verified** (annotations) / **inferred** (use)
5. **The eventID still doesn't give the MP3/MP4 URL.** Download files sit at `m-download.invintus.com/{clientID}/{assetID}_audio.mp3`, where `assetID` is a hash. The player gets that hash, or `downloadLinks.audioDownloadURI`, only from the Invintus API response (`/Event/getDetailed`). Discovery is solved; **resolving eventID → media** is the step that still needs Invintus's API, run either by the player in a browser or directly. **verified** (`player.invintus.com/app.js` text)
6. **Invintus publishes a documented Public API.** It is a Postman collection, "Public API 3", published 2025-02-16. Its Acceptable Use section says: "Do not provide content to third parties, including downloadable datasets of Content or an API that returns Content, you will only distribute or allow download of Media assets or meta-data under client owners and Invintus Media LLC.'s explicit permission or under the client's contractual terms with Invintus Media LLC." Server access uses a per-client API key from the client's Control Center ("If you do not have an API key, you can contact support@invintus.com"). **verified**
7. **The key in public JavaScript is a vendor-wide "embedder" credential, not an Oregon key.**
   - The player names it `embedderAuth: {vendorName: "embedder", vendorKey: …}`. It is one build-time constant (`WSC`) in Invintus's own player and listing apps, shipped to every viewer of every Invintus client.
   - The same key (same SHA-256 prefix `23ac5f27`) appears in streamlink's `invintus.py` and yt-dlp's `tvw.py`.
   - Scoping to a client is only a `clientID` field in the request body.
   - It is not the documented customer auth, which is `Authorization: <client API key>` plus a `clientID` header.
   - **verified** (bundles, Postman collection, GitHub files)
8. **`api.v3.invintus.com/robots.txt` reads `User-agent: * / Disallow: /`.** **verified**
9. **Route (c) is not "hacking" in the CFAA sense, but it isn't clean.**
   - On the legal side (inferred, not legal advice): the key is served to every browser, so no gate is lifted (Van Buren; hiQ 2022: "the concept of 'without authorization' does not apply to public websites").
   - Against it:
     - It uses Invintus's own app credential, from a server, for a purpose Invintus's published policy says needs the client owner's and Invintus's "explicit permission".
     - The host's robots.txt disallows all.
     - Contract claims survive where the CFAA doesn't (hiQ later lost on breach of contract; secondary).
   - Written permission from the Legislature (the client owner) and Invintus, or the Legislature's own key, would make it clean. **inferred**
10. **Precedent exists, but none of it shows permission.**
    - streamlink and yt-dlp ship embedder-key extractors.
    - `mroconnell/rtr-deeplink` calls `Event/getDetailed` and `Search` across Invintus tenants, **including the Oregon Legislature (clientID 4879615486)**, and calls the key "a fixed, public 'embedder' credential".
    - `jeffpar/argument-aloud` uses it for Washington Supreme Court video on TVW.
    - None of the files I read claims permission. **verified** (files) / **not found** (permission)
11. **Invintus Media** was "established in 2012 by TVW", Washington's non-profit public-affairs network. Its address is 1058 Capitol Way South, Olympia WA. I found no acquisition. I found no public Oregon Legislature–Invintus contract, RFP, or Oregon Buys record. **verified** (invintus.com/about, footer) / **not found** (acquisition, contract)
12. **Route (a) has a statutory fallback.**
    - Legislative-branch public records requests go in writing to `Leg.RecReq@oregonlegislature.gov`, c/o the Office of the Legislative Counsel.
    - The Legislature must acknowledge within 5 business days.
    - Fees: $25/h clerical, $40/h legislative-process work, $75/h IT expertise. Fees of $25 or less are waived.
    - **verified** (LC policies 142-109, 142-112)
13. **Route (b) is now unnecessary for committee meetings.**
    - robots.txt doesn't block it: OLIS has no robots.txt (404), and www only disallows SharePoint system paths.
    - It would take 25 fetches: one `SessionDay/ScheduledMeetings` fragment per meeting day, with eventIDs in server-rendered HTML.
    - **verified** (robots; cached HTML; day count) / **inferred** (fetch count)
14. **Other sources:**
    - Agendas carry only the boilerplate link to the general video page. **verified**
    - I found no Legislature YouTube channel. **not found**
    - The event-listing widget has no RSS or iCal feed. Its "Add to calendar" builds one event client-side. **verified**
    - Invintus's API docs list **keyless RSS endpoints** `GET /Rss/{clientID}/today|week|month`. They are not tested, sit on the robots-disallowed host, and are for a rolling window, so they're no use for a closed Session. **verified** (docs) / **not tested**

**Recommendation in one line:**
- Take eventIDs from the Recording Logs (route d) now.
- Ask the Legislature in writing for the eventID → media step (route a): an email first, with a public records request as the fallback.
- Don't call the Invintus API (route c) without that written permission.
- Route (b) isn't needed for the backfill.

---

## Route (c): the Invintus embedder API, in detail

### c1. Who Invintus is

| Claim | Status | Source |
|---|---|---|
| "Invintus Media, Inc. was established in 2012 by TVW, the nation's leading state public affairs television network … TVW, a non-profit organization best described as Washington state's version of C-SPAN." Scott Freeman is "CTO/Founder", and "co-founded Invintus Media Inc. in 2012". | verified | https://www.invintus.com/about |
| Footer: "© 2020 Invintus Media, LLC." Address "1058 Capitol Way South Olympia WA". The API docs name "Invintus Media LLC". | verified | https://www.invintus.com/privacy-policy (page shell only), docs.publicapi.invintus.com |
| The GitHub org `TVWIT` has the display name "INVINTUS MEDIA" and the blog `www.invintus.com`. It publishes the official WordPress plugin. | verified | `gh api orgs/TVWIT`; https://github.com/TVWIT/invintus-wp-plugin |
| Acquisition by a larger company: none found. Searches for "Invintus Media acquired" and an Invintus–Touchcast link returned nothing relevant. | not found | web search 2026-11-04 |
| Named customers: WisEye and CVTV appear in a loader comment: "alias -- clients (WisEye, CVTV) embed data-playerid". The homepage carries testimonials from "The florida channel", "KTOO Alaska", and "PCTV". TVW is the platform behind yt-dlp's `tvw.py`. The Oregon Legislature is client `4879615486`. | verified | https://player.invintus.com/loader.js; https://www.invintus.com/; yt-dlp `tvw.py`; prior note |
| Other tenants named by a third party: University Place WA, Clark County WA, Leon County FL. | secondary | `mroconnell/rtr-deeplink` `app/platforms/invintus.py` comments |
| Status page lists "Invintus Platform API … Operational". | verified | https://status.invintus.com/ |
| Oregon Legislature contract with Invintus (contract number, RFP, Oregon Buys record): none found. A public records request could get it (see (a)). | not found | web searches 2026-11-04 |

### c2. Documentation

There is real first-party documentation. The prior note's "I found no public documentation" no longer holds.

- **Public API docs**: https://docs.publicapi.invintus.com/view/metadata/2sAYXEEdQQ, a Postman collection titled "Public API 3", `publishDate` 2025-02-16. Full collection JSON: `documenter.gw.postman.com/api/collections/934987/2sAYXEEdQQ`. **verified**
  - "The API endpoints are POST requests ONLY …" and "Requests are for retrieving data only."
  - "Recurring requests are limited to 1 per second, per endpoint."
  - "API Keys are required. To retrieve your API key, please view the "Api Key" tab in the accounts section of the Control Center application. If you do not have an API key, you can contact support@invintus.com to request one."
  - "Your Customer Identification number (clientID) is required to make API requests, this can be found at the top toolbar of the Control Center interface …"
  - **Acceptable Use**, quoted in full:
    > - Misuse of API by means of making requests greater than 1 per second will result in revoking API access.
    > - Replicating features of the INVINTUS Platform management interface is not authorized.
    > - Do not provide content to third parties, including downloadable datasets of Content or an API that returns Content, you will only distribute or allow download of Media assets or meta-data under client owners and Invintus Media LLC.'s explicit permission or under the client's contractual terms with Invintus Media LLC. Any Content provided to third parties via non-automated file download remains subject to this Policy.
  - Documented auth headers: `Authorization: {{APIKEY}}` and `clientID: {{CLIENTID}}` on every method except `/v2/sourcesLive`, which uses `Authorization: {{CLIENTID}}` plus `Wsc-api-key: {{APIKEY}}`. The environment carries a sample key for demo client `1000000000`, which I didn't use.
  - Methods relevant here:
    - `Listings/getEventIDsInCategory` (category plus date range)
    - `Listings/getDetailed`, `Listings/search`, `Search/general`
    - `Event/getDetailed`, `Event/getDownloadMedia`, `Event/getStreamLinks`
    - `Assets/getMediaAssets`, `Assets/getPublishedVideoAsset`
    - **RSS**: `GET {{APIV3HOST}}/Rss/{{CLIENTID}}/today`, `/week`, `/month`, sent with only a `Content-Type` header (no key in the documented request).
- **Product docs**: https://docs.invintus.com (Docusaurus, sitemap 267 URLs) covers Control Center, Video Player, Channel Listings, Audio Descriptions, and OTT. **verified**
  - `player/sdk/embed-strategies`: "`loader.js` … optimizes the Player's boot sequence by **prefetching API data**". It also documents a **customer-keyed Event (`customID`)**: "Load an Event by your own identifier instead of the Invintus platform ID. Useful when your integration keys Events by agenda item, meeting code, or CMS slug."
  - `docs/events/ai-captioning`: live "AI Closed Captions … inject[s] CEA-608 compliant captions", saved afterwards as a VTT in the Event's Assets tab. Separately, "Transcriptions" for recorded media are generated on demand ("Click **Generate Transcript**"). This probably explains why only 1 of 15 events had a Transcript tab in the prior note (inferred).
  - `docs.invintus.com/robots.txt` blocks named AI-training crawlers (GPTBot, ClaudeBot, Claude-Web, anthropic-ai, CCBot and others) and allows `*`. It says: "The docs are for clients and their developers, not for scraping into language model training data." I read 4 pages plus llms.txt and the sitemap, user-directed, for this note.
- **Support articles**: https://invintus-support.freshdesk.com/support/solutions/articles/48001173664 ("Player SDK": `.launch` needs `clientID` and `eventID`). It says nothing about keys. **verified** (via WebFetch summary)
- `developer.invintus.com`: no response. `www.invintus.com/terms`, `/terms-of-service`: 404. **verified**

### c3. The key in public JavaScript

All facts in this section come from reading the bundles as text: `player.invintus.com/loader.js` (5,493 B, byte-identical to the prior session's copy), `player.invintus.com/app.js` (1,064,826 B, "APP_VERSION" not present; Vite build), and `eventlisting.invintus.com/app.js` (1,604,406 B, `APP_VERSION:"2.3.3"`).

| Question | Finding | Status |
|---|---|---|
| What is it? | A 31-character alphanumeric string. In the player it is `In.embedderAuth = {vendorName:"embedder", vendorKey:<key>}`. Requests send `authorization: "embedder"` and `wsc-api-key: <key>`. In the listing app it is the build env var `WSC` (`{NODE_ENV:"production",SCALEDRONE:…,WSC:<key>,APP_VERSION:"2.3.3",…}`). | verified |
| Per client or vendor-wide? | **Vendor-wide.** It is a hard-coded constant in the generic `loader.js`, which every Invintus embed loads ("Tiny standalone script … Reads player config from data attributes … Fires API prefetch calls"). The same value (SHA-256 prefix `23ac5f27`) is in the listing app, in streamlink's plugin (written for any `player.invintus.com/?clientID=…&eventID=…`), in yt-dlp's TVW extractor (TVW is a different client), and in rtr-deeplink, used across tenants. The client is chosen only by the `clientID` field in the JSON body. | verified |
| Read-only? | The embed apps call only read methods. The player sends `includePrivate:false` in the body, so private-event filtering appears to be a **request parameter**. Whether the server enforces it for the embedder vendor wasn't tested. | verified (what it sends) / not tested (server enforcement) |
| More privileged than a client key? | Unknown. It is a *different* credential from the documented client key: a vendor identity ("embedder") that Invintus issues to its own front-end apps. It is not something Invintus issued to the Legislature or to third parties. | verified (difference) / inferred (meaning) |
| Endpoints the player calls | Base `https://api.v3.invintus.com/v2`: `/Event/getDetailed`, `/Player/getPlayerPreference`, `/Transcript/getTranscriptV3`, `/Player/getAnalyticSiteID`. Also `/Assets/getNonVideoAssets` on `https://api.v3.invintusmedia.com/v2` (the "publicBaseUrl"), and `/V2/AdStudio/getAdProject` on the same host. | verified |
| Parameters (getDetailed) | `loader.js` sends `{clientID, eventID, showEncoder:true, showStreams:true, includePrivate:false, VAST:true, checkRecentBreak:true, showDownloadLinks:true, showDocumentAssets:true}`. `app.js` adds `showMediaAssets:true, getAudioDescriptionProjectID:true`. | verified |
| Endpoints the listing widget calls | `/Search/general` (events and search), `/Event/getDetailed`, `/Listings/getContentYears`, `/Categories/getCategories`, `/Embeded/getListingPreferenceByID`. Search pages by `resultPage` / `resultMax` with sort, status, and date filters. | verified |
| How the download URL is built | `downloadLinks.videoDownloadURI` / `audioDownloadURI` from getDetailed. As a fallback it uses `https://m-download.invintus.com/${clientID}/${assetID}.mp4` / `${assetID}_audio.mp3`, where `assetID` comes from `getPublishedAsset(mediaAssets)` (the first `type=="video"`, `currentStatus=="archive"` asset). The `assetID` is only in the API response. | verified |
| Is there a documented public embed endpoint? | The documented embed is the **JavaScript player** (`loader.js` / `Invintus.launch({clientID, eventID})`) or an iframe. The REST calls behind it are not documented as a public interface. The documented REST interface is the per-client-key Public API. | verified |
| Does a server call look like a browser viewer to Invintus? | Same URL, headers, and body, but no `Origin: https://olis.oregonlegislature.gov`, no player analytics (Matomo `statsmatomo.invintus.com`), a different user agent, and one IP fetching many events. Invintus could tell the difference if it looked. CORS (`mode:"cors"`) is a browser rule, not an access control on the server. | inferred |
| Does the key appear on other clients' pages? | Yes, by construction: it is in `loader.js` and `app.js`, which every client's embed loads. It also appears in two widely distributed open-source tools and in at least one civic project used against several tenants. It is public in the sense of "shipped to everyone". It is **not** public in the sense of "issued for anyone's server use": the docs route server use through a client key. | verified (presence) / inferred (sense) |

### c4. Precedent

| Project | What it does with Invintus | Permission stated? | Status / source |
|---|---|---|---|
| **streamlink** `src/streamlink/plugins/invintus.py` (since at least 2022) | POSTs `Event/getDetailed` with `Authorization: embedder` and the key ("hard coded in the middle of https://player.invintus.com/app.js") to get the HLS URL for any `player.invintus.com/?clientID=…&eventID=…`. | No | verified (file; commits 2022-03-11 … 2024-10-21) |
| **yt-dlp** `yt_dlp/extractor/tvw.py` (added 2025-03-03) | Reads `clientID`/`eventID` meta from a tvw.org page, then POSTs `Event/getDetailed` with the embedder key to get the HLS formats. | No | verified (file; commits) |
| **mroconnell/rtr-deeplink** ("Lean video+transcript+deep-link viewer for public government meetings", pushed 2026-11-04) | Calls `Event/getDetailed` and a `Search` "hub walker" across tenants. Its test fixtures include `invintus_hub/oregon_search.json` for "Oregon Legislature, clientID 4879615486". Its own comment calls the key "a fixed, public 'embedder' credential … not a per-tenant or per-session secret, so calling it directly from a plain HTTP client is the same trust boundary as reading any other platform's public client-side API key". | No (that comment is its own reasoning, not permission) | verified (files) |
| **jeffpar/argument-aloud** (argumentaloud.org, Washington Supreme Court arguments) | `scripts/import_wasc.js --tvw` fills `video_url`/`hls_url`/`captions_url` "from the Invintus media API" with TVW's clientID and a hard-coded key (not compared). | No | verified (file) |
| **TVWIT/invintus-wp-plugin** (Invintus's own) | Server-side PHP integration. Its settings ask the site owner for "API key, client ID" (`define( 'INVINTUS_API_KEY', 'your-api-key' );`), which is the documented client-key route, not the embedder key. | n/a (vendor) | verified (README, `inc/Invintus.php`) |
| OpenStates / Plural, Digital Democracy (CalMatters), LegiScan | No Invintus code found in GitHub code search. Digital Democracy's state coverage was not researched. | not found | `gh api search/code` for `api.v3.invintus.com`, `invintus eventID`, `m-download.invintus.com`, `invintus` (2026-11-04) |

### c5. Terms, robots, and the law

**robots.txt** (all fetched 21:01 PST):

| Host | Contents | Status |
|---|---|---|
| `api.v3.invintus.com` | `User-agent: *` / `Disallow: /` | verified |
| `player.invintus.com` | none (the SPA shell is served for `/robots.txt`) | verified |
| `eventlisting.invintus.com` | 403 `AccessDenied` (S3) | verified |
| `m-download.invintus.com` | 404 `NoSuchKey` | verified |
| `www.invintus.com` | 404 | verified |
| `docs.invintus.com` | blocks named AI-training crawlers; `User-agent: *` / `Allow: /` | verified |
| `www.oregonlegislature.gov` | `User-agent: *` / `Disallow: /_layouts/` / `Disallow: /_vti_bin/` / `Disallow: /_catalogs/` / `Sitemap: …/sitemap.xml` | verified |
| `olis.`, `apps.`, `api.oregonlegislature.gov` | 404 (no robots.txt) | verified |

robots.txt is a crawler convention, not a contract or an access control. A disallow-all on an API host is still a clear statement that the operator doesn't invite automated clients there. **inferred**

**Invintus terms:** no viewer terms of use were found (`/terms`, `/terms-of-service` return 404; the privacy-policy page is an empty shell). The API **Acceptable Use** above is the only published usage policy. It binds API users, and its distribution clause bears directly on a service that publishes transcripts derived from the media. **verified** (texts) / **inferred** (application)

**Law (considerations, not legal advice):**
- **CFAA, "without authorization" / "exceeds authorized access".** *Van Buren v. United States*, 593 U.S. 374 (2021), https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf: liability "stems from a gates-up-or-down inquiry—one either can or cannot access a computer system, and one either can or cannot access certain areas within the system." Footnote 8 leaves open "whether this inquiry turns only on technological (or 'code-based') limitations on access, or instead also looks to limits contained in contracts or policies." **verified**
- *hiQ Labs v. LinkedIn*, No. 17-16783 (9th Cir. Apr. 18, 2022), https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf: for publicly available pages, "that computer has erected no gates to lift or lower in the first place. Van Buren therefore reinforces our conclusion that the concept of 'without authorization' does not apply to public websites." Oregon and Washington are both in the Ninth Circuit. **verified**
- The same case on remand (N.D. Cal. Nov. 4, 2022): the court found hiQ breached LinkedIn's User Agreement, and the case ended in a stipulated $500,000 judgment. Contract and terms claims survive where the CFAA doesn't. **secondary** (https://newmedialaw.proskauer.com/2022/11/11/court-finds-hiq-breached-linkedins-terms-prohibiting-scraping-but-in-mixed-ruling-declines-to-grant-summary-judgment-to-either-party-as-to-certain-key-issues/ ; https://www.natlawreview.com/article/linkedin-s-data-scraping-battle-hiq-labs-ends-proposed-judgment)
- **Oregon, ORS 164.377(4):** "Any person who knowingly and without authorization uses, accesses or attempts to access any computer, computer system, computer network … commits computer crime" (Class A misdemeanor). "Without authorization" isn't defined in the section. **verified** (non-authoritative mirror of https://www.oregonlegislature.gov/bills_laws/ors/ors164.html, via the OregonAI corpus `ors-164.377`, retrieved 2026-07-20). Invintus is in Washington, and Washington's cybercrime statute was not researched.
- **How these apply to (c)** (inferred):
  - The key is sent to every browser, and nothing is bypassed: no login, no paywall, no rate-limit evasion, no hidden endpoint. On the Van Buren / hiQ reading, that is not breaking a gate.
  - The open questions are **policy and contract**:
    - The vendor's published policy routes server access through a client key and requires "explicit permission" to distribute media or metadata.
    - Its API host disallows all robots.
    - The credential identifies Invintus's own embed app.
    - Van Buren footnote 8 leaves open whether such policy limits count as gates.
  - The risk is not mainly criminal. It is:
    - (1) Invintus blocking or rotating the key, which would break every Invintus embed's clients for a moment and could cost the Legislature goodwill;
    - (2) a terms or contract dispute;
    - (3) reputational: a civic project being seen to use a vendor's credential against the Legislature's own vendor, after the Legislature asked clients (AUA clause 3) to use the sanctioned channel.

### c6. Bottom line for (c)

- **Is it circumvention?** Not in the technical sense: nothing is bypassed, and the request is byte-for-byte what the player sends. **inferred**
- **Is it using a public interface the way it's served?** Also no. The interface is served *to the Invintus player*, under a vendor credential. Invintus documents a different interface (client-keyed) for server use and publishes an Acceptable Use policy that requires the client owner's and Invintus's explicit permission to redistribute media or metadata. Using the embedder key from a server is using someone else's credential outside the purpose it was issued for. That is why the prior session's permission layer called it circumvention, and the call is defensible. **inferred**
- **What would make it clearly acceptable**, any one of:
  - (1) written permission from the **Oregon Legislature** (the "client owner") to resolve its 2026R1 eventIDs to download URLs through the Invintus API, plus Invintus's agreement where its policy requires it;
  - (2) the Legislature, or Invintus at its request, issuing or using a **client API key** for this purpose;
  - (3) the Legislature supplying the **list** itself (route a).
  - Any of these also settles the redistribution question for transcripts derived from the media. **inferred**

---

## Route (a): ask the Legislature

| Item | Finding | Status | Source |
|---|---|---|---|
| Help desk for the website and data | `mailto:leg.helpdesk@oregonlegislature.gov` (site footer, "Legislative Website Feedback"). AUA clause 2 asks clients to report "problems with data currency, quality, content, access" to the Open Data Service, which Legislative Information Services runs. | verified | https://www.oregonlegislature.gov/citizen_engagement/Pages/Public-Records.aspx (footer); `olis-odata.md` §1 |
| Legislative Media (video) | "call Legislative Media at 503-986-1195" (archival DVD requests). | verified (prior note) | https://www.oregonlegislature.gov/Pages/video-library.aspx |
| Public records route | Policy 142-109: "All public records requests to the Legislative Assembly or its members or staff must be in writing and must be addressed to the Public Records Staff Attorney and sent to the care of the Office of the Legislative Counsel." Mail: "Legislative Branch Public Records Request, c/o Office of the Legislative Counsel, 900 COURT STREET NE S101, SALEM OREGON 97301-4065". Email: "Leg.RecReq@oregonlegislature.gov". The request must state "the legislative body, member or legislative employee to which the request is directed, the date of the request and that it is a public records request", "describe in particularity the document or documents being requested", and give the requester's name, any organization, and an email or postal address. A fee-waiver request must state the uses, whether it is "related to any commercial or political opposition research purpose", and whether it relates to legal proceedings. | verified | https://www.oregonlegislature.gov/lc/PDFs/Policy_PublicRecordsRequest.pdf (dated 1-10-18) |
| Response time | "Legislative Counsel shall respond to public records requests within five business days … Within 10 business days after the date by which an acknowledgement is required, Legislative Counsel shall provide an estimated completion date". | verified | same |
| Fees | Policy 142-112: "Clerical work … $25 per hour. More complicated work requiring knowledge of the legislative process … $40 per hour. Professional-level work requiring comprehensive knowledge of public records law or other law or information technology expertise will be billed at $75 per hour." "If fees … are $25 or less, the fees are waived." Initial public-interest test: "40 percent reduction". "An interest in open and transparent government generally … does not constitute public interest in the requested records." | verified | https://www.oregonlegislature.gov/lc/PDFs/Policy_PRRFee.pdf (PDF modified 2026-06-05) |
| Statute | ORS 192.324(3): "If the public record is maintained in a machine readable or electronic form, the public body shall provide a copy of the public record in the form requested, if available." (4)(c): no fee over $25 without a written estimate the requester confirms. | verified (non-authoritative mirror, corpus `ors-192.324`) | https://www.oregonlegislature.gov/bills_laws/ors/ors192.html |
| Is the eventID → URL list a public record? | The Legislature's Invintus Control Center holds each event's ID and download links, and the Legislature uses that information. Whether records held in a vendor platform count as "retained by" the Legislature, and whether producing a list is "compiling" (allowed under 192.324(4)(a), at a fee), is for Legislative Counsel to decide. Note that the request no longer needs the eventIDs (route d gives them), only the download URLs or a permission. | inferred | ORS 192.324; Invintus docs |
| Media / video policy | The video page says only "The Oregon State Legislature live-streams and archives meetings to ensure public access". There is a closed-caption disclaimer. I found no reuse or licensing policy for recordings. | verified (prior note) / not found (policy) | Legislative-Video.aspx; disclaimer.aspx |
| Invintus contract | Not found publicly. It could be asked for in the same request, for any clause on public access, downloads, or data ownership. | not found | searches |

What to ask for has narrowed. Because route (d) gives the eventIDs, the ask is **only**:
- (1) permission to resolve 279 eventIDs to their MP3 download URLs (by the player's Download link, or through the Invintus API), or the list of those URLs;
- (2) confirmation that publishing machine transcripts of the recordings, with attribution and the caption disclaimer, is fine;
- (3) optionally, permission for live sessions later (the RSS endpoint or the session-day fragment).

## Route (b): one OLIS page per meeting, or per day

| Question | Finding | Status |
|---|---|---|
| Does robots.txt allow the pages? | Yes. `olis.oregonlegislature.gov/robots.txt` is 404, and www disallows only `/_layouts/`, `/_vti_bin/`, `/_catalogs/`. | verified |
| eventID in HTML or only via JavaScript? | **In server-rendered HTML.** Meeting page: `Meeting Details <a href="/liz/2025R1/Committees/HALNRW/2025-01-22-08-00">…</a>, HR D <a href="https://olis.oregonlegislature.gov/liz/mediaplayer/?clientID=4879615486&amp;eventID=2025011038" … title="Recorded Content">`. Session-day fragment (`/liz/2025R1/SessionDay/ScheduledMeetings?sessionDate=03%2F04%2F2025%2000%3A00%3A00`, loaded by the day page's `data-load-action`): 22 "Recorded Content" anchors with eventIDs for 2025-03-04. Floor links are on the day page itself ("Senate Convened at 11:00 AM <a …eventID=2025031021>"). | verified (cached HTML from 2026-10-28, `video-research/pages/mtg.html`, `day.html`, `day_ScheduledMeetings.html`) |
| Fetches for 2026R1 | **25** fragment fetches (one per distinct date with a Scheduled meeting, 2026-02-02 … 2026-03-06: 20 in February, 5 in March) cover all 279 meetings. Floor convenings: 42 rows on 21 dates, all within those 25. The per-meeting alternative is 279 fetches. | verified (counts from the backfill DB) / inferred (fragment covers every meeting of its date, seen for one 2025R1 date) |
| Is a one-time pass "regular scraping"? | **Reading for:** "regular" suggests recurring or habitual. A single, rate-limited, night-time pass of 25 pages for a closed Session isn't regular, and clause 5 assumes scraping still happens ("reserves the right to temporarily suspend … the ability to 'scrape'"), so the AUA tolerates some. **Reading against:** clause 3 makes the Open Data Service "the preferred method to obtain Oregon legislative data". An eventID is a fact about a meeting, and a project that builds this into its pipeline would repeat it every Session, which becomes regular. ADR-0005's spirit is to read OLIS within its terms. | inferred |
| Still needed? | **No, for committee meetings.** Route (d) gives the same eventIDs from feed-linked documents. (b) stays useful for **floor sessions** (no recording log) and for a **live Session**, where logs lag. | inferred |

## Route (d): sources that need no scraping

### d1. Recording Log PDFs: the eventID is in their link annotations

- **Method.** I parsed `/URI (…)` actions in each PDF, including Flate-compressed object streams, with a stdlib Python script (`python3 -I`).
- **2025R1:** 43 cached logs (`video-research/dl/logs/` in the research cache, feed-linked, fetched 2026-10-28). All 43 carry `eventID=`, each with exactly one distinct eventID. Example: `sample/289418.pdf` has 110 URIs; 109 are `https://olis.oregonlegislature.gov/liz/mediaplayer?clientID=4879615486&eventID=2025021020&startStreamAt=<n>` and 1 is `…/Committees/JWMNR/2025-02-03-15-00/MeetingMaterials`. `halnrw_0122.pdf` → `eventID=2025011038`, which matches the prior note's player URL. **verified**
- **2026R1** (fetched 21:03 PST tonight, both feed-linked):
  - `CommitteeMeetingDocument/311935`, "JWM 2-2-26 10:00 AM Recording Log": 22 URIs, 21 with `eventID=2026021004`. PDF `CreationDate` Mon Feb 2 16:25:59 2026 PST, the same day as the meeting.
  - `CommitteeMeetingDocument/316290`, "HRULES 3-6-26 2:00 PM Recording Log": 22 URIs, 21 with `eventID=2026031032`. Created Tue Mar 17 2026, 11 days after the meeting.
  - **verified**
- **Coverage:** every 2026R1 Scheduled meeting (279) has exactly one recording-log row (279 distinct meetings). **verified** (DB)
- **Caveats** (inferred):
  - Only 2 of 279 2026R1 logs were checked. The convention held across 43 random 2025R1 logs from Word/Acrobat generators, so I expect it to hold.
  - A log might be a scan without links. The extractor must report any log with no eventID rather than guess.
  - Meetings with two logs (17 in 2025R1) should yield the same eventID twice, or reveal a split recording.
- **What it costs:** no new kind of fetch. The logs are feed-linked documents, fetched once at night under the existing rule. The backfill already fetched them but stored only text, so the options are: (i) extract link annotations at ingest from now on and re-fetch 279 PDFs once; or (ii) a one-off reader of the 279 PDFs. **inferred**

### d2. Other feed documents

- Agendas: 269 of 326 carry only the boilerplate "To access links to a livestream or recordings of legislative meetings: https://www.oregonlegislature.gov/citizen_engagement/Pages/Legislative-Video.aspx". **verified** (DB text)
- 6 testimony documents and 1 exhibit mention a `mediaplayer`/`eventID` (citizens citing earlier hearings). They are not systematic. **verified**
- Agenda PDF link annotations were not inspected. **not checked**

### d3. Feeds and channels

| Source | Finding | Status |
|---|---|---|
| Invintus RSS | Documented `GET https://api.v3.invintus.com/Rss/{clientID}/today\|week\|month`, with no key in the documented request. Not tested: it's on the robots-disallowed API host, and the API Acceptable Use presumably covers it. Its rolling window means it can't cover 2026R1. It could serve a live Session, with permission. | verified (docs) / not tested |
| Event-listing widget RSS/iCal | None. The only "RssFeed" in the bundle is a Material icon. "Add to calendar" builds a single `BEGIN:VCALENDAR … PRODID:-//InvintusLLC//InvintusLLC Event Calendar//EN` client-side for one event. | verified (`eventlisting.invintus.com/app.js`) |
| OLIS RSS | The OLIS RSS icon points to press releases. | verified (prior note) |
| YouTube | No official Legislature channel carrying hearings was found. Video pages link only to the Invintus player. | not found (web search 2026-11-04) |
| "Legislative Video" page archive index | The page embeds three Invintus listing widgets (preferences 252 live, 253 scheduled, 254 recent archives) and links to `video-library.aspx` (DVD archive list: "Web Part Error: Access denied"). There is no static archive index; the listings are API-driven. | verified (cached `lv.html`; prior note) |
| `customID` | Invintus supports customer-keyed Events ("keys Events by agenda item, meeting code"). If the Legislature set `customID` = committee code plus meeting time, an eventID would be derivable from the feed. There is no sign that Oregon uses it: OLIS links use eventID. | verified (docs) / inferred (Oregon) |

---

## Comparison

| Route | What it needs | Terms risk | Effort | Timeliness (2026R1 backfill) | Fit for a live Session later |
|---|---|---|---|---|---|
| **(d) Recording Log link annotations → eventID** | 279 feed-linked PDFs (already fetched once; re-fetch or extract annotations) | **None new.** Feed-linked documents, once, at night (ADR-0005). | Small: an annotation extractor plus a report of logs with no ID | Immediate | Poor alone: logs lag (2025R1 median 16 days; 2026R1 samples were 0 and 11 days) |
| **(a) Email Legislative Information Services / Legislative Media** | A reply granting permission for eventID → MP3 resolution (player Download or API), or a URL list | None | One email; a wait | Days to weeks, unknown | Best: can cover the RSS endpoint, session-day fragment, or a feed field going forward |
| **(a′) Public records request to Leg.RecReq** | Written request; possible fee ($25 or less waived; $40–$75/h if IT work) | None | One request; 5-business-day acknowledgement | Weeks | One-off per Session, so poor for live |
| **(b) OLIS session-day fragments** | 25 night fetches (279 if per meeting) | Low to moderate: AUA clause 3, both readings | Small | Immediate | Workable (one fetch per meeting day), but becomes "regular", so needs permission |
| **(b′) Headless player per event, press Download** (the prior session's method) | 279 OLIS player loads; Invintus's own code makes the embedder calls | Moderate: viewer-equivalent per event, but in bulk it's the same API traffic as (c), under the API Acceptable Use | Medium (a browser) | Immediate | Workable, same caveat |
| **(c) Invintus embedder API direct** | The vendor's embed key from a server | **Highest:** a vendor credential outside its purpose; the API's own AUP requires the client owner's and Invintus's explicit permission; robots Disallow on the API host. No gate is bypassed. | Small | Immediate | Technically best (Search, RSS), only with permission |
| **(c′) Documented Public API with the Legislature's client key** | The Legislature's cooperation (it holds or can request the key) | None, if granted | Small once granted | Depends on (a) | Best |

## Recommendation

1. **Build route (d) now.** Extract `eventID` and `startStreamAt` from the Recording Log PDFs' link annotations.
   - Why: it is the only way to get every 2026R1 committee eventID without touching anything outside the feed and its linked documents, which the project already reads under ADR-0005.
   - Bonus: it yields a seconds offset per speaker turn, which the transcript alignment needs anyway.
   - Make the extractor report logs with no eventID, and logs whose annotations disagree, instead of guessing.
2. **Send the email below for the one remaining step**, eventID → MP3 URL, and for transcript publication. Ask before downloading. Nothing is time-critical: 2026R1 is closed, and each recording's MP3 has been available since about 2 h after its meeting (prior note).
   - The prior session already downloaded one MP3 through the player's Download button. That button is a sanctioned feature for a viewer. At 279 events, the honest reading is that the project wants a bulk, automated use, so it should say so and ask.
3. **If no answer in about 10 business days,** file the public records request as a fallback. It asks for the download URLs (or permission), and the Invintus contract's access clauses, with a fee waiver.
4. **Don't use route (c), the embedder key, without written permission** from the Legislature, and from Invintus if the Legislature says its contract needs it. If permission comes, ask whether to use the Legislature's own client key (c′) instead of the embedder key, and keep to the documented limit ("1 per second, per endpoint").
5. **Don't use route (b) for the backfill;** (d) makes it unnecessary. Keep (b) in the email as the proposed live-Session route (one session-day fragment per meeting day, at night), along with the Invintus RSS endpoint, so a live Session has an answer ready.
6. **Floor sessions** have no recording log. If wanted later, they need the day pages (21 dates in 2026R1) or the same permission. Fold this into the email.

### Email (route a), for the owner to send

To: Leg.Helpdesk@oregonlegislature.gov
Cc: (Legislative Media Services, if an email address is known; phone 503-986-1195)
Subject: Request: permission to download 2026 session committee audio for a public transcript archive

> Hello,
>
> I maintain SessionGateway (https://github.com/OregonAI/SessionGateway), a free, open-source, read-only mirror of one Oregon legislative session's public records. It reads the Oregon Legislature Open Data Service within its Acceptable Use Agreement: one full refresh a night between 5 pm and 6 am.
>
> We would like to add searchable, speaker-labelled transcripts of the 2026 Regular Session's committee hearings, about 280 recorded meetings. We'd label them as machine transcripts, with your closed-caption disclaimer and a link to each official recording. We already have each meeting's video event ID from the Recording Log PDFs linked in the Open Data feed, so we don't need to scrape the website to find them.
>
> The one step we can't take from the feed is going from an event ID to its audio file. The player's own "Download → Audio MP3" button does this for a viewer, but doing it for 280 meetings would be an automated, bulk use, and we would rather ask than assume. Could you tell us which, if any, of these is acceptable?
>
> 1. We fetch each recording's MP3 once, at night, at no more than one request every few seconds, either through the media player's Download link or through Invintus's API, whichever you prefer.
> 2. You send us a list of the 2026R1 committee recordings' MP3 (or MP4) download links, e.g. an export from your Invintus account.
> 3. Something else you'd prefer.
>
> We'd also be grateful to know:
> - whether publishing machine transcripts of these public recordings, with attribution, is fine with the Legislature;
> - for future sessions, whether we may read the next day's meeting list (one OLIS session-day page per meeting day, at night) or Invintus's RSS listing for the Legislature, to link recordings while a session is under way; and
> - whether adding the Invintus event ID or a media link to the CommitteeMeetings entity in the Open Data feed is something you would consider.
>
> We won't download any recordings until we hear from you. Thank you for running the open data service. It makes this kind of project possible.
>
> [Name]
> [Organization, if any] · [email]

### Public records request (fallback, route a′)

To: Leg.RecReq@oregonlegislature.gov
Subject: Public records request: 2026R1 committee recording download links

> Date: [date]
>
> This is a public records request under ORS 192.311 to 192.478, directed to the Legislative Assembly (Legislative Administration, Legislative Media Services / Information Services).
>
> Records requested:
> 1. For each committee meeting of the 2026 Regular Session (2026R1, February 2 – March 6, 2026) that was recorded, the media-hosting record showing the meeting's Invintus event ID and the URL(s) of its downloadable MP3 and/or MP4 file, in electronic form (CSV, spreadsheet or JSON preferred, per ORS 192.324(3)). A system export is sufficient; I am not asking for the media files themselves.
> 2. The current contract or agreement between the Legislature and Invintus Media (or its reseller) for live streaming and archiving, limited to the sections on public access, downloads, data ownership, and APIs.
>
> Requester: [name], [organization, if any], [email address].
>
> Fee waiver requested. The records will be used to link and transcribe public hearing recordings in SessionGateway, a free, open-source, read-only public mirror of the session's records (https://github.com/OregonAI/SessionGateway). The request is not related to any commercial or political opposition research purpose; neither I nor any organization is being paid by a third party to make it; and it is not related to any legal or administrative proceeding. It is narrowly tailored to one session and one data field. If fees will exceed $25, please send an estimate before proceeding.

(The policy's own test says "an interest in open and transparent government generally … does not constitute public interest". The waiver argument should rest on the specific public use: searchable access to hearing testimony. **inferred**)

---

## Open questions

1. **Do all 279 2026R1 Recording Logs carry the annotations?** 2 were checked. The extractor will answer it; any log without them needs (b) or (a) for that meeting.
2. **Will the Legislature allow bulk eventID → MP3 resolution, and by which mechanism?** Player Download, the API with the embedder key, the Legislature's own client key, or a supplied list.
3. **Does the Legislature's Invintus contract say anything about public downloads, redistribution, or ownership of recordings?** Not public. Asked in the request.
4. **Does the Legislature hold an Invintus client API key, and would it use one or delegate it for this?**
5. **Does the documented RSS endpoint (`/Rss/{clientID}/today`) work without a key, and what does it carry?** Download links? Only with permission.
6. **Live-Session latency:** how soon after a meeting is the Recording Log posted in a short session? 2026R1 samples were the same day and 11 days later; 2025R1's median was 16 days. That decides whether (d) can serve a live Session or (b) / RSS is needed.
7. **Does the session-day fragment list every recorded meeting of its date, including informational meetings outside `CommitteeMeetings`?** Seen for one 2025R1 date only.
8. **Floor sessions:** out of scope here. They have no recording log, and their eventIDs are on the day pages.
9. **Washington law:** Invintus is in Olympia, and the Washington cybercrime statute was not researched.

---

## Every URL fetched (Pacific time, 2026-11-04)

Direct fetches (`curl`; the researcher's local `fetchlog.txt` logged them, and that file was not committed):

| Time (PST) | URL | Result |
|---|---|---|
| 21:01:24 | https://player.invintus.com/loader.js | 200, 5,493 B |
| 21:01:25 | https://player.invintus.com/app.js | 200, 1,064,826 B |
| 21:01:26 | https://eventlisting.invintus.com/app.js | 200, 1,604,406 B |
| 21:01:26 | https://player.invintus.com/robots.txt | 200 (SPA shell) |
| 21:01:27 | https://eventlisting.invintus.com/robots.txt | 403 |
| 21:01:27 | https://api.v3.invintus.com/robots.txt | 200, 25 B |
| 21:01:27 | https://m-download.invintus.com/robots.txt | 404 |
| 21:01:28 | https://www.invintus.com/robots.txt | 404 |
| 21:01:28 | https://www.oregonlegislature.gov/robots.txt | 200 (OLIS fetch 1) |
| 21:01:28 | https://olis.oregonlegislature.gov/robots.txt | 404 (OLIS fetch 2) |
| 21:01:28 | https://apps.oregonlegislature.gov/robots.txt | 404 (OLIS fetch 3) |
| 21:01:29 | https://api.oregonlegislature.gov/robots.txt | 404 (OLIS fetch 4) |
| 21:03:47 | https://olis.oregonlegislature.gov/liz/2026R1/Downloads/CommitteeMeetingDocument/311935 | 200 PDF (OLIS fetch 5, feed-linked) |
| 21:03:51 | https://olis.oregonlegislature.gov/liz/2026R1/Downloads/CommitteeMeetingDocument/316290 | 200 PDF (OLIS fetch 6, feed-linked) |
| ~21:04 | https://docs.publicapi.invintus.com/view/metadata/2sAYXEEdQQ | WebFetch (summary) |
| ~21:04 | https://invintus-support.freshdesk.com/support/solutions/articles/48001173664 | WebFetch (summary) |
| 21:04:57 | https://docs.publicapi.invintus.com/view/metadata/2sAYXEEdQQ | 200 (raw) |
| 21:05:10 | https://documenter.gw.postman.com/api/collections/934987/2sAYXEEdQQ?segregateAuth=true&versionTag=latest | 200 (collection JSON) |
| 21:05:36 | https://www.invintus.com/ | 200 |
| 21:05:37 | https://www.invintus.com/about | 200 |
| 21:05:37 | https://www.invintus.com/privacy-policy | 200 (empty shell) |
| 21:05:37 | https://www.invintus.com/terms-of-service | 404 |
| 21:05:38 | https://www.invintus.com/terms | 404 |
| 21:05:38 | https://status.invintus.com/ | 200 |
| 21:05:38 | https://docs.invintus.com/ | 200 |
| 21:05:39 | https://developer.invintus.com/ | no response |
| 21:05:51 | https://docs.invintus.com/sitemap.xml | 200 |
| 21:05:52 | https://docs.invintus.com/robots.txt | 200 |
| 21:05:52 | https://docs.invintus.com/llms.txt | 200 |
| 21:06:14 | https://docs.invintus.com/docs/changelog/download-url-path.md | 404 |
| 21:06:15 | https://docs.invintus.com/docs/changelog/media-playback-and-downloads.md | 404 |
| 21:06:17 | https://docs.invintus.com/player/sdk/embed-strategies.md | 200 |
| 21:06:18 | https://docs.invintus.com/docs/events/ai-captioning.md | 200 |
| 21:07:41 | https://github.com/streamlink/streamlink/blob/HEAD/src/streamlink/plugins/invintus.py | via `gh api` contents |
| 21:07:42 | https://github.com/yt-dlp/yt-dlp/blob/HEAD/yt_dlp/extractor/tvw.py | via `gh api` |
| 21:07:43 | https://github.com/TVWIT/invintus-wp-plugin/blob/HEAD/README.md | via `gh api` |
| 21:07:43 | https://github.com/TVWIT/invintus-wp-plugin/blob/HEAD/inc/Invintus.php | via `gh api` |
| 21:08:16 | https://github.com/mroconnell/rtr-deeplink/blob/HEAD/app/platforms/invintus.py | via `gh api` |
| 21:08:17 | https://github.com/mroconnell/rtr-deeplink/blob/HEAD/README.md | via `gh api` |
| 21:08:17 | https://github.com/jeffpar/argument-aloud/blob/HEAD/scripts/import_wasc.js | via `gh api` |
| ~21:09 | https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf | 200 (WebFetch; text via pdftotext) |
| 21:09:29 | https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf | 200 |
| 21:09:38 | https://www.oregonlegislature.gov/citizen_engagement/Pages/Public-Records.aspx | 200 (OLIS fetch 7) |
| 21:09:46 | https://www.oregonlegislature.gov/lc/PDFs/Policy_PublicRecordsRequest.pdf | 200 (OLIS fetch 8) |
| 21:09:49 | https://www.oregonlegislature.gov/lc/PDFs/Policy_PRRFee.pdf | 200 (OLIS fetch 9) |
| 21:10:23 | https://github.com/mroconnell/rtr-deeplink/blob/HEAD/tests/test_invintus_hub.py | via `gh api` |

GitHub API metadata, about 21:07–21:10: `repos/TVWIT/invintus-wp-plugin`, `orgs/TVWIT`, `repos/{mroconnell/rtr-deeplink, jeffpar/argument-aloud, jeffpar/argument-aloud-wasc, dlq/parliament-streams}`, and commit lists for the streamlink and yt-dlp files. Code searches (`search/code`): `api.v3.invintus.com`, `invintus eventID`, `m-download.invintus.com`, `invintus`, `repo:mroconnell/rtr-deeplink 4879615486`, `repo:dlq/parliament-streams Oregon invintus`.

Web searches (2026-11-04, about 21:04–21:11):
- "Invintus Media acquired"
- "Oregon Legislature Invintus contract video streaming"
- "Invintus API developer documentation embed player clientID eventID"
- "Invintus legislature video platform company Seattle TVW"
- "Invintus Media government streaming customers state legislature 2025"
- "Touchcast Invintus"
- "invintus github api.v3.invintus.com"
- "Oregon Legislature public records request …"
- "Oregon State Legislature official YouTube channel committee hearings"
- "Invintus Oregon Buys …"
- "Invintus … WisEye …"
- "hiQ v. LinkedIn November 2022 …"

Local sources read (no network):
- The prior session's cached pages and logs under the research cache's `video-research/` folder (not committed) (fetched 2026-10-28).
- The 2026R1 backfill's index database on the researcher's machine, read-only (a local file that was not committed; the figures taken from it are labelled "measured locally").
- OregonAI corpus documents `ors-164.377` and `ors-192.324` (non-authoritative mirrors).
- `SessionGateway/docs/research/hearing-video.md`, `olis-odata.md` §1, and `docs/adr/0005-read-olis-within-its-terms.md`.
