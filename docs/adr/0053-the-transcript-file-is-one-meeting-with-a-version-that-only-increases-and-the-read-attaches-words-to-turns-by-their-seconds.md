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
- `segments`: in audio order, each with `start` and `end` seconds, `text`, and `words`, each with `start`, `end`, `text` and, if the model gives one, `probability` (0 to 1).

No other key is allowed in version 1 (every object is closed). A word's `text` is as the model wrote it, with its leading space and punctuation.

**The JSON Schema and where it is.** `docs/schemas/transcript-v1.schema.json` (JSON Schema draft 2020-12, `$id` `https://raw.githubusercontent.com/OregonAI/SessionGateway/main/docs/schemas/transcript-v1.schema.json`). `hearing-transcripts` vendors it by copying that file (and records the commit it copied from), so the tool validates what it writes against the same schema this service reads. The schema carries the version as `format_version.const`.

**The version only increases.** A change to the format is a new file `transcript-v<N>.schema.json`, a new `format_version`, and a new reader module here; version 1's schema and reader are never edited after this ticket, so a tool that writes version 1 stays readable. The read knows the versions in `knownFormatVersions` and refuses any other (the same discipline as the Index's schema versions, ADR-0048).

**The zod schema and the JSON Schema agree.** The read validates with a zod schema (`lib/format.ts`). The JSON Schema file is that schema through `z.toJSONSchema` with the draft marker, `$id` and a title added. A seam-4 test turns the zod schema into JSON Schema again and compares it with the committed file apart from prose (`title`, `description`, `$schema`, `$id`), so the two cannot drift. Two rules JSON Schema cannot state are the read's alone: a segment or a word does not end before it starts. A file that breaks either is refused as not valid.

**The read** (`transcript-read` package, `readTranscript`, pure, no storage):

1. **Refusals.** Text that is not JSON, or has no `format_version`, is refused `not_valid`. A `format_version` that is not a known version, whatever the rest of the file holds (a later format may change every field), is refused `unknown_version`, and the message names the file and the version as the file writes it. A known version that breaks the format is refused `not_valid` with the file and each path that failed (`audio.sha256: ...`).
2. **Attaching.** The Meeting's speaker turns (any value with `offsetSeconds`, in practice the stored turns of the speaker-turn index, which for a Meeting with two Recording Logs the caller merges in media-clock order) are sorted by second. A word falls in the last turn whose second is at or before the word's `start`. A word before the first turn has no speaker given. A segment whose words fall in one turn is one passage with the segment's own start, end and trimmed text; a segment whose words fall in more than one is split at each word where the turn changes, and each piece has its first word's start, its last word's end and its words' text joined and trimmed. A segment with no words falls in the turn of its own `start`. Passages come in file order.
3. **Speaker not given.** A Meeting with no speaker-turn index (the caller passes `null`) has every passage's speaker `{ kind: "not_given", label: "speaker not given" }`, and segments are not split.
4. **Drift.** For each turn, the drift is the distance in seconds from the turn's second to the nearest word boundary of the whole transcript: any word's `start` or `end`, the first word's start being the speech start. A turn is **flagged** when its drift is strictly more than 10 seconds (`driftThresholdSeconds`; exactly 10 is not flagged). A transcript with no words has no boundary, so every turn has drift `null` and is flagged. A turn after the end of the audio, or in a long silence, is flagged by the same rule. A Meeting with no index has no drift (`null`). The build report and ticket #134 decide what to do with a flag; the read only measures and reports.

**Limits of the drift measure, stated.** It catches a log whose clock is off by more than 10 seconds only where speech is sparse near the turn: in continuous speech some word boundary is always within a second or two of any second, so a constant offset is not seen by this measure alone. The spec asks for this measure ("more than about 10 s from the nearest word boundary or speech start"), and it is what the read does; checking the offset against turn *content* (the logged name against the words said) is left to the bake-off's hand check.

**Package.** `transcript-read`, one entry point (`index.ts`); it imports no other package, because a turn is any value with `offsetSeconds`. ADR-0009 has its section.

## Considered Options

- **The tool writes camelCase keys.** Rejected: the tool is Python, and the file is its output; the read maps to camelCase at its edge.
- **An open format that ignores unknown keys.** Rejected: a key this service does not know is a field it would silently drop, and the version is how a tool says it added one.
- **A string version such as `"1.0"` or a semantic version.** Rejected: the format has no compatible changes (a field either is in version 1 or the file is version 2), so one integer says all there is.
- **A JSON Schema validator in the read.** Rejected: it adds a dependency, and the zod schema already types the result; the agreement test holds the two together.
- **Attach a whole segment to the turn at its start.** Rejected by the spec: a segment spanning a turn change would give one speaker's words to the other.
- **Measure drift only at the turn's own word.** Rejected: nearest word boundary is the spec's measure and needs no guess about which word is the turn's first.

## Consequences

Ticket #134 stores the passages the read returns. `hearing-transcripts` vendors the schema and writes version 1. A later format version adds a module beside `lib/format.ts` and a number to `knownFormatVersions`.
