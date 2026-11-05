---
status: accepted; builds on ADR-0051 (the audio and the tool that transcribes it), ADR-0052 (the speaker-turn index) and ADR-0048 (versions that only increase)
---

# The transcript file is one Meeting with a version that only increases, and the read attaches words to turns by their seconds

Spec #123 stage 2 has a tool in another repository (`OregonAI/hearing-transcripts`, ADR-0051) write machine transcripts and SessionGateway read them. The two agree on one file format, owned here. Ticket #130 fixes the format and writes the read; storing transcripts is ticket #134 and the publication gate is another ADR.

## Decision

**The format.** One file is one Meeting's transcript, JSON, with snake_case keys. Version 1 holds, and only holds:

- `format_version`: the integer 1.
- `event_id`: the Invintus event ID of the recording (the Recording Log's player link gives it).
- `audio`: `sha256` (64 lower-case hex digits) and `duration_seconds`. The audio itself is never kept (ADR-0051).
- `model`: `id` (names the weights and revision) and `settings`: `model_name`, `device`, `compute_type`, `language`, `beam_size`.
- `made_at`: an ISO 8601 time with its offset.
- `segments`: in audio order, each with `start` and `end` seconds, `text`, `words`, and, when the model gives them, faster-whisper's quality numbers `avg_logprob`, `compression_ratio` (0 or more), `no_speech_prob` (0 to 1) and `temperature` (0 or more). Each word has `start`, `end`, `text` and, if the model gives one, `probability` (0 to 1).

No other key is allowed in version 1 (every object is closed). `format_version` is an integer (`type: integer`, `const: 1`); `beam_size` is an integer of 1 or more with no upper bound. A word's `text` is as the model wrote it, with its leading space and punctuation.

**The mapping from faster-whisper** (read from `faster_whisper/transcribe.py` of faster-whisper 1.2.1, class `Segment` and class `Word`). The format keeps the fields that say how far to trust a segment and drops those that are the model's internals:

| faster-whisper | version 1 file |
| --- | --- |
| `Segment.id` | dropped (internal to the model) |
| `Segment.seek` | dropped (internal to the model) |
| `Segment.start`, `Segment.end` | `start`, `end` |
| `Segment.text` | `text` |
| `Segment.tokens` | dropped (internal to the model) |
| `Segment.avg_logprob` | `avg_logprob` |
| `Segment.compression_ratio` (the text's UTF-8 length over its zlib-compressed length) | `compression_ratio` |
| `Segment.no_speech_prob` | `no_speech_prob` |
| `Segment.temperature` (`Optional`) | `temperature`, the key left out when the model gives `None` |
| `Segment.words` (`Optional`) | `words`, `[]` when the model gives `None` |
| `Word.start`, `Word.end` | `start`, `end` |
| `Word.word` | `text` |
| `Word.probability` | `probability` |

The quality numbers are the segment's, not the word's. When the read splits a segment at a turn change, each piece carries the numbers of the whole segment it was cut from (`segmentQuality`). The read does not judge them; deciding what a high `no_speech_prob` or a low `avg_logprob` means for publishing is the publication gate's.

**The JSON Schema and where it is.** `docs/schemas/transcript-v1.schema.json` (JSON Schema draft 2020-12, `$id` `https://raw.githubusercontent.com/OregonAI/SessionGateway/main/docs/schemas/transcript-v1.schema.json`). `hearing-transcripts` vendors it by copying that file (and records the commit it copied from), so the tool validates what it writes against the same schema this service reads. The schema carries the version as `format_version.const`.

**The version only increases.** A change to the format is a new file `transcript-v<N>.schema.json`, a new `format_version`, and a new reader module here; version 1's schema and reader are never edited after this ticket, so a tool that writes version 1 stays readable. A seam-4 test holds the rule: it carries the SHA-256 of `transcript-v1.schema.json`, byte for byte, so editing the schema and the zod schema together (which the agreement test below would accept) turns it red. A change to version 1 therefore needs a `transcript-v2` file, and the fingerprint is not updated. The read knows the versions in `knownFormatVersions` and refuses any other (the same discipline as the Index's schema versions, ADR-0048).

**The zod schema and the JSON Schema agree.** The read validates with a zod schema (`lib/format.ts`). The JSON Schema file is that schema through `z.toJSONSchema` with the draft marker, `$id` and a title added. A seam-4 test turns the zod schema into JSON Schema again and compares it with the committed file apart from prose (`title`, `description`, `$schema`, `$id`), so the two cannot drift. Two rules JSON Schema cannot state are the read's alone: a segment or a word does not end before it starts. A file that breaks either is refused as not valid.

**The read** (`transcript-read` package, `readTranscript`, pure, no storage). It takes the file's name and text, the Meeting's event ID, the Meeting's speaker turns (or `null` when it has no speaker-turn index) and the log's other entries.

1. **Refusals.** Text that is not JSON, or has no `format_version`, is refused `not_valid`. A `format_version` that is not a known version, whatever the rest of the file holds (a later format may change every field), is refused `unknown_version`, and the message names the file and the version as the file writes it. A known version that breaks the format is refused `not_valid` with the file and each path that failed (`audio.sha256: ...`). A valid file whose `event_id` is not the event ID the caller gave is refused `event_id_mismatch`, and the message names the file and both IDs. The caller supplies the ID (from the Meeting's Recording Log) so that a file cannot vouch for itself: a transcript of another Meeting attached to this one's turns would give every word the wrong speaker.
2. **The timeline.** The turns and the entries the read uses make one timeline, sorted by second. Of the recording-log package's entries it uses the `TimedEntry` kinds `recess`, `reconvene`, `motion`, `motion-result`, `roll-call` and `adjournment`, and the `VoteEntry` kind `vote`; any other kind (`call-to-order`, `agenda-item`) is ignored, so the caller may pass the log's whole entry list. At one second a speaker's turn comes after, and so wins over, an entry; two turns at one second, or two entries, keep the caller's order and the later one wins (the earlier has no words). A Meeting with two Recording Logs is given the caller's merged turns and merged entries (the caller puts them on one media clock; the read does not merge).
3. **Attaching.** A word falls in the last moment of the timeline at or before the word's `start`, so a word that starts before a boundary and ends after it belongs to the earlier moment. What the moment is decides the speaker:
   - a turn: the speaker is that turn. `turnIndex` is the turn's position in the array the caller passed, and `turn` is the caller's own value (never an index into a sorted copy);
   - a motion, a motion result, a vote or a roll call: the words attach to that entry (`kind: "entry"`, `entryIndex` its position in the caller's array, `entry` the caller's value), not to the previous speaker, until the next moment;
   - a recess: speaker not given, marked `during_recess`, until the reconvene (or any later moment);
   - a reconvene: the recess is over and nobody is named, so speaker not given with no mark, until the next turn or entry;
   - an adjournment: speaker not given, marked `after_adjournment`, for everything after it.

   A word before the first moment has no speaker given (no mark). A segment whose words fall in one moment is one passage with the segment's own start, end and trimmed text; a segment whose words fall in more than one is split at each word where the moment changes, and each piece has its first word's start, its last word's end and its words' text joined and trimmed. A segment with no words falls in the moment of its own `start`. Passages come in file order.
4. **Speaker not given.** A Meeting with no speaker-turn index (the caller passes `null`) has every passage's speaker `{ kind: "not_given", label: "speaker not given" }`, the entries are not read, and segments are not split.
5. **Drift** is the turn against the segment start. For each turn the read takes the distance in seconds from the turn's second to the nearest start of any segment of the transcript (a segment's `start`, whether or not it has words). It reports each turn's drift, in the caller's order and with the caller's turn and its position, and over the Meeting the **median** and the **maximum** of the turns' drifts. A turn is **flagged** when its drift is strictly more than 10 seconds (`driftThresholdSeconds`); the **Meeting is flagged** when the median is strictly more than 10 seconds. Exactly 10 is neither. A transcript with no segments has nothing to measure against: every turn has drift `null` and is flagged, the median and maximum are `null`, and a Meeting with turns is flagged. A Meeting with no turns has no median and is not flagged; a Meeting with no speaker-turn index has no drift (`null`). The log's other entries are not measured. The build report and ticket #134 decide what to do with a flag; the read only measures and reports.

**Limits of the drift measure, stated.** A turn is where the log says a speaker began; a segment start is where the model began a stretch of speech after a pause or at the end of its 30-second window. The two are not the same event, so the measure is a rough alarm and nothing more:
- A turn in the middle of a long run of speech can be several seconds from any segment start with a perfect clock, so one turn over 10 seconds is weak evidence by itself. That is why the Meeting is flagged on the median and a single turn is only listed.
- Where speech is continuous, segment starts fall every few seconds, so a constant offset of the log's clock is seen only when it is large enough to move the median over 10 seconds; an offset of a few seconds, or one that happens to land turns near other segment starts, is not seen.
- A turn in a long silence or a recess is far from every segment start and is flagged although the clock may be right.
- It does not look at what was said: whether the logged name matches the words is not checked, and that is left to the bake-off's hand check.

**Package.** `transcript-read`, one entry point (`index.ts`); it imports no other package's code, only the types of the `recording-log` entry point (`TimedEntry` and `VoteEntry`, for the entry kinds it uses), because a turn is any value with `offsetSeconds` and an entry any value with a `kind` and `offsetSeconds`. ADR-0009 has its section.

## Considered Options

- **The tool writes camelCase keys.** Rejected: the tool is Python, and the file is its output; the read maps to camelCase at its edge.
- **An open format that ignores unknown keys.** Rejected: a key this service does not know is a field it would silently drop, and the version is how a tool says it added one.
- **A string version such as `"1.0"` or a semantic version.** Rejected: the format has no compatible changes (a field either is in version 1 or the file is version 2), so one integer says all there is.
- **A JSON Schema validator in the read.** Rejected: it adds a dependency, and the zod schema already types the result; the agreement test holds the two together.
- **Attach a whole segment to the turn at its start.** Rejected by the spec: a segment spanning a turn change would give one speaker's words to the other.
- **Measure drift against the nearest word boundary.** Rejected by the owner (2026-11-05): word boundaries are dense in continuous speech, so any second is within a second or two of one and the measure saw nothing; segment starts are sparser. The owner chose the turn against the segment start, with the median and the maximum over the Meeting.
- **Measure drift only at the turn's own word.** Rejected: it needs a guess about which word is the turn's first.
- **Give words in a recess or a vote to the previous speaker.** Rejected by the owner: the log says nobody of the committee was speaking as a member, and a named speaker for those words would be a false attribution. A recess and an adjournment give 'speaker not given' with the reason; a motion, vote or roll call keeps its own entry.
- **Keep faster-whisper's `id`, `seek` and `tokens`.** Rejected by the owner: they are internal to the model, say nothing about quality, and `tokens` would make every file large.

## Consequences

Ticket #134 stores the passages the read returns. `hearing-transcripts` vendors the schema and writes version 1. A later format version adds a module beside `lib/format.ts` and a number to `knownFormatVersions`.
