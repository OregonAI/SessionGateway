---
status: accepted (owner decision of 2026-11-05, spec #123, ticket #131)
---

# Hearing audio is fetched through the Invintus embedder interface once, and the owner accepts the risk

Spec #123 needs the audio of the 2026R1 committee hearings (279 recorded meetings, about 330-430 hours) to make machine transcripts. The Recording Logs give each meeting's Invintus event ID, but not the MP3 address. The address comes only from the Invintus API's `Event/getDetailed` response (`downloadLinks.audioDownloadURI`; the player's fallback is `https://m-download.invintus.com/{clientID}/{assetID}_audio.mp3`, where `assetID` is a hash that appears only in that response).

## Decision

On 2026-11-05 the owner decided to use **path A** knowingly: a separate tool, `OregonAI/hearing-transcripts`, calls the Invintus player's public embedder interface (`Event/getDetailed`, with the vendor-wide embedder credential that Invintus's own player sends to every browser) and then fetches the MP3 URL it returns. The decision is the owner's, made with the research and the risk below in front of them. Nothing here claims permission exists.

### Reasoning and research

The research is `docs/research/hearing-video-discovery.md` (written 2026-11-04; it lands with ticket #125, so the path does not exist on `main` until that merges; the path is kept here on purpose) and `docs/research/hearing-video.md`. What it found:

- The embedder credential is vendor-wide and public. It is a constant in Invintus's generic `loader.js`, sent to every browser, and the client is chosen only by the `clientID` in the request body. streamlink, yt-dlp and other tools use the same interface without stated permission. Nothing is bypassed: no login, no paywall, no hidden endpoint, and the request is the one the player makes.
- On the reading of *Van Buren v. United States* (2021) and *hiQ Labs v. LinkedIn* (9th Cir. 2022), there is probably no CFAA exposure for a public interface with no gate. *Van Buren* footnote 8 leaves open whether contract or policy limits count as gates, and *hiQ* shows that a contract or terms claim survives where the CFAA does not. ORS 164.377(4) turns on "without authorization", which the statute does not define. These are considerations, not legal advice.
- The interface is not used the way Invintus documents it. Invintus publishes a client-keyed Public API with an Acceptable Use policy: "Do not provide content to third parties, including downloadable datasets of Content or an API that returns Content, you will only distribute or allow download of Media assets or meta-data under client owners and Invintus Media LLC.'s explicit permission", and its API host's robots.txt disallows all. The embedder credential identifies Invintus's own player, so this is using a credential outside the purpose it was issued for.
- The ways to be clearly in bounds are written permission from the Oregon Legislature (and from Invintus where its policy requires it), a client API key, or a list of MP3 addresses supplied by the Legislature. The owner chose not to wait for them.

### The risk

- **To the Open Data Service.** AUA clause 5: "Oregon Legislature Information Services reserves the right to temporarily suspend the Open Data Service, and also the ability to 'scrape' the Oregon Legislature Website, if client usage is significantly impacting the performance of the Oregon Legislature Information System (OLIS) or other Oregon Legislature applications." Everything SessionGateway mirrors depends on that service. Traffic to Invintus is not traffic to OLIS, but the Legislature is Invintus's client, and a complaint from Invintus, or the Legislature taking a dim view of the project, could cost the project its access. That is the risk the owner accepts.
- **Other.** Invintus may block or rotate the key (which affects every Invintus embed, not only this project), a terms or contract dispute, and reputation: a civic project seen to use a vendor's credential against the Legislature's own vendor, after AUA clause 3 asked clients to use the Open Data Service.

### Limits

Some limits are enforced by the downloader's code and tested against a local fake server; the rest only the operator can keep. This ADR does not claim the code enforces what it cannot.

**Enforced in code:**

- **The window.** 00:00-06:00 Pacific only. Outside it the downloader refuses to start, and it checks again before every request.
- **Pacing.** One request at a time, about 3 seconds apart, measured on a monotonic clock. Invintus's documented limit is 1 per second per endpoint; the project stays well under it.
- **Once only.** The downloader records each fetched event (`event_id`, `sha256`, `bytes`) in a record file and fetches nothing already recorded. A damaged record file stops the run before any request. A fetch is recorded only after the MP3 is whole on disk.
- **MP3 only.** Event IDs are digits only. The audio address from `getDetailed` must be `https` on the expected download host (default `m-download.invintus.com`, the host of the MP3 URL in the research) and end in `.mp3`, or the run halts without requesting it. The reply must be an audio type with a matching Content-Length, a non-empty body and an MP3 start (an ID3 header or an MPEG frame sync). Video is never requested.
- **The User-Agent.** Every request carries `SessionGateway-transcripts/1 (+https://github.com/OregonAI/SessionGateway)`.
- **Halt on refusal or an unexpected reply.** See the stop rules.
- **No proxies and no redirects.** Proxy settings in the environment are ignored, and a redirect is an unexpected reply.
- **Tests never contact Invintus.** A session-wide guard in the test suite makes any connect or name lookup other than to loopback raise, and CI clears the proxy variables.

**The operator's to keep (not enforced by code):**

- **One-time backfill.** It is not a recurring job. A later Session, or a live Session, needs a new decision.
- **2026R1 committee recordings only.** No floor sessions, no other sessions. The downloader fetches whatever event IDs it is given.
- **Run from the GPU desktop only**, in runs the owner approves one by one.
- **The embedder key** is read from the environment and is never committed.

### Stop rules

The downloader halts the whole run at the first 401, 403 or 429, or any unexpected response (another status, a body that does not have the documented shape, an MP3 reply that is not a whole MP3, or a connection or protocol error), prints what happened, and waits for the owner. It does not retry around a refusal, and nothing resumes until the owner decides. A refusal is Invintus saying no, and the project takes it as an answer.

### No evasion

No rotating addresses, no proxies, no disguised or changed User-Agent, no headless browser posing as a viewer, no spreading requests across hosts to get around pacing, and no work around a block or a changed key. If the interface closes, the project asks the Legislature and Invintus instead.

### Audio is never kept or redistributed

The MP3 is hashed, transcribed locally, then deleted. It is never committed, served, or shared, and the repository ignores audio files. The record keeps the `event_id`, the `sha256` and the byte count, not the audio. The duration is not in the download record; the transcription step reports it later, in the transcript file.

### Transcripts stay behind a publication gate

The transcripts derived from the audio are built and checked locally and are kept off the public deployment until the owner decides to publish them. The gate and the machine-transcript notice are decided in a separate ADR (spec #123, another ticket). Stage 1, the speaker-turn index, needs no audio and is not gated.

## Considered Options

- **Ask the Legislature first (route a), and wait.** The research recommends it, and the owner may still send it; a reply would make this ADR's risk moot and is welcome at any time. Rejected as a precondition: the owner decided not to block on an answer of unknown timing.
- **A headless browser that loads the player and presses Download (route b').** Rejected: the same API traffic as path A, dressed as a viewer, which the no-evasion rule forbids.
- **OLIS meeting or session-day pages (route b).** Rejected: they add OLIS traffic beyond the feed, against AUA clause 3's preference for the Open Data Service, and they give only event IDs, which the Recording Logs already carry.
- **Skip audio; use only the Invintus Transcript tab's WebVTT or broadcast captions.** Rejected: about 1 in 15 events has a WebVTT file, and the captions are poor and about 8 s late (spec #123, Out of Scope).
- **Use the Legislature's own client key or the documented Public API.** Not available: no key has been issued.

## Consequences

The new repository `OregonAI/hearing-transcripts` holds the downloader and enforces in code the limits listed above as enforced, and the stop rules, with tests against a fake server (ticket #131). SessionGateway never calls Invintus. If the Legislature or Invintus objects, the project stops at once and the owner decides what follows; if permission or a client key arrives, a new ADR supersedes this one. Transcripts do not appear on the public deployment until the publication-gate ADR and the owner's "publish".
