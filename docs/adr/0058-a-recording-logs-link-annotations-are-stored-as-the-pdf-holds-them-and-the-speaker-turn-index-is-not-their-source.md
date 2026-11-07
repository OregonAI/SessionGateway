---
status: accepted (owner-approved 2026-11-06); extends ADR-0052 (the worker reads a log's links when it fetches the file) and ADR-0048 (the sixth numbered step)
---

# A Recording Log's link annotations are stored as the PDF holds them, and the speaker-turn index is not their source

A Recording Log's event ID, and so a turn's player link, is in the PDF's link annotations and nowhere in the stored `document.text` (ADR-0052). The worker read them to build the index and kept only what the index derived from them. An evaluation question that names a player link's event ID therefore had no source that was not the index under test (#83's rule, test/CLAUDE.md "Expected values"), and for stage 1 of spec #123 the owner waived the player check (#129, 2026-11-06). Ticket #160 stores the annotations so a question can name "the stored link annotations of recording-log-…, page N".

## Decision

- **The worker stores each Recording Log's link annotations as `extractPdfLinks` read them: the page (from 1) and the address of each, in the order the file lists them.** `linkAnnotationsOf` (`pdf-text`) is the one place that makes the stored form: it keeps `{ page, url }` and drops the rectangle, which no question needs and the player link does not use. Nothing derived goes in: no event ID, offset or turn.
- **They are stored before anything is derived from them.** `readSpeakerTurnIndex` (`ingest/lib/speaker-turns.ts`) stores the annotations from the read's own links, then hands the same links to `parseRecordingLog`. The two writes are independent: the annotations are keyed by the document alone, so storing, replacing or dropping the log's index (`storeSpeakerTurnIndex`, any outcome, including a log with no event ID or with two) never touches them, and they are stored for a log whose index is a gap. A log whose bytes changed since the stored text (ADR-0052's `bytes_changed`) is not read, so nothing is stored from it, as for the index.
- **Storage is schema step 6 (ADR-0048): one table, `recording_log_link_annotation`**, with `document_id`, `position` (the order in the file), `page` and `url`, created with `CREATE TABLE IF NOT EXISTS`. It adds no column to a table that exists. Steps 1 to 5 and `versionOneSchema` are unchanged. Storing a log's annotations again replaces them, in one transaction.
- **The reader gets one entry point, `linkAnnotationsOf(document)`; no tool shows them.** Nothing in the tools needs to: the annotations are for an evaluation question's expected values, whose sources are SQL over stored columns (scripts/eval/questions/2026R1.yml), so a question names `recording_log_link_annotation` (page, url, by `document_id`) as it names `document.text` or `meeting.committee_code`, and needs no tool. A tool that shows them is a later ticket's decision.
- **A log stored before step 6 has none until the worker fetches it again.** This ticket adds no new fetch: a log is fetched for its annotations when it is new, or has no index (ADR-0052's re-fetch), and not because its annotations are missing. The 2026R1 logs (279) already hold an index, so they have no annotations until a re-fetch the owner approves, and the owner decides how that fetch is triggered. Making it happen is one condition (a log with no stored annotation counts with the logs without an index in `recordingLogsWithoutIndex`, so the same fetch, hash check and report apply).

## Considered Options

- **Store the PDF bytes, or the whole `PdfLink` with its rectangle.** Rejected: the store keeps no bytes (ADR-0005), and a rectangle is layout, not what a question cites.
- **Take the event ID and offsets from the index and store those as the "annotations".** Rejected: that is the derived value under test, the thing the ticket exists to stand apart from.
- **A column on `document` or on `speaker_turn_index`.** Rejected: the index's row is replaced when the log is read again and exists only for a log the parser read; the annotations must not follow it, and a list needs rows.
- **Fetch every log with an index again on this release.** Rejected for now: it is 279 requests to OLIS that the owner has not approved, and the deploy box deploys every merge to main.

## Consequences

A log with no link at all, and a log never read since step 6, both have no rows: the table does not tell them apart. Real logs always carry at least their player links, so "no rows" is the condition for the re-fetch above; if a later ticket needs to tell a zero-link log apart it adds a marker in a new step.

An evaluation question about a player link's event ID can name the stored annotations of the log and the page. Until the owner's re-fetch of 2026R1, that database holds none, so the #129 questions keep their waiver (they change in the ticket that follows the re-fetch).

Seam 1's expected values for the real log are in `test/tools/recording-log-link-annotations.test.ts` (the addresses of 307521, read from its raw PDF), and the seam-2 table is `pdf-text/tests/link-annotations.test.ts`.
