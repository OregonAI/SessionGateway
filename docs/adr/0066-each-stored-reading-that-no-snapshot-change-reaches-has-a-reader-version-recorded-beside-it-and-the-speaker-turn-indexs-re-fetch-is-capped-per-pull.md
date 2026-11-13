---
status: proposed (ticket #187; schema step 10 awaits the owner's approval); extends ADR-0048 (the tenth numbered step); applies the shape of ADR-0064 and ADR-0065 to five more readings; amends ADR-0052 and ADR-0058 (when a Recording Log is fetched again) and ADR-0055 (when a transcript file is read again)
---

# Each stored reading that no snapshot change reaches has a reader version recorded beside it, and the speaker-turn index's re-fetch is capped per pull

ADR-0064 and ADR-0065 gave Statute Links and the held Statutes Affected Table a version constant that the worker records with each reading and compares at the next pull, so that a fix to the reading code reaches a database that already holds the reading. #187 found five more readings with the same flaw. The table in the issue is verified against `73c651d` below.

| Reading | Stored in | Read again today when | Table correct? |
|---|---|---|---|
| Agency Links | `agency_read` | the snapshot commit differs, or the file's Statute Links are read again (`storeStatuteParse` deletes the row). Fiscal Impact Statements have no `statute_read` row, so only the snapshot commit reaches them. | Yes. |
| Speaker-turn index | `speaker_turn_index` | the log has no row, or has no stored link annotation (`recordingLogsWithoutIndex`), or is fetched new or revised. | Partly: the issue omits the second condition, which is the annotation row's (below). |
| Turn passages | `speaker_turn_index.turns_without_passage` | it is NULL, which only a stored-again index (`storeSpeakerTurnIndex`) makes it. | Yes. |
| Item Measures | `speaker_turn_index.item_measures_read` | it is 0, which only a stored-again index makes it. | Yes. |
| Link annotations | `recording_log_link_annotation` | the log has no annotation row. A log whose PDF holds no link has none, so `recordingLogsWithoutIndex` lists it on **every** pull and it is fetched on every pull (a flaw this ADR ends: the issue says "no row exists" and does not say the zero-link log is fetched forever). | Yes, and worse than stated. |
| Transcript words | `transcript.file_sha256`, `transcript.attached_to` | the file's checksum changes, or the turns and entries (and `ATTACHMENT_VERSION`) change, which re-attach the stored words and never read the file. | Yes. |

Two things the table leaves out and this ADR relies on. The link annotations and the speaker-turn index are read from the same fetched PDF, in one call (`readSpeakerTurnIndex`), though they are stored apart (ADR-0058). The turn passages and the item Measures are both columns of `speaker_turn_index`, and both are read from the stored text with no fetch.

## Decision

- **Every reading has a version constant beside the code that makes it, a bump rule that names what the code imports, and a version recorded with each reading and compared at the next pull**, as ADR-0064 does. A reading made before step 10 counts as version 0, so each constant starts at 1 and every stored reading is made again once, within the bounds below. Nothing detects a missing bump: the reviewer checks it, as ADR-0064 says.
- **No shared column or table.** Each version is a column beside the marker its reading already has, so the readings stay independent and a bump of one makes no other reading again (ADR-0065's rule for the two parsers). A shared `reader_version` table keyed by reading name was rejected: it adds a join and a name list to every "unread" query, and nothing is gained, because each reading already has a row to hold its own version. The one reading with no row of its own is the link annotations, which get a small table (`recording_log_annotation_read`, below).
- **Schema step 10** adds, in one step (the readings ship as one PR, and one step is one swap on the deploy box):
  - `agency_read.reader_version INTEGER NOT NULL DEFAULT 0`;
  - `speaker_turn_index.index_reader_version`, `.turn_passages_reader_version` and `.item_measures_reader_version`, each `INTEGER NOT NULL DEFAULT 0`;
  - `transcript.reader_version INTEGER NOT NULL DEFAULT 0`;
  - a table `recording_log_annotation_read (document_id TEXT PRIMARY KEY, reader_version INTEGER NOT NULL) STRICT`, filled by the step with version 0 for each log that has an annotation row. The table exists because a log with no link has no annotation row to hold a version, and "read once, found no link" has to be told from "never read".
  `versionOneSchema` is unchanged.
- **The constants and what bumps them.** Each comment beside a constant says it, and the rules are:
  - `AGENCY_LINK_READER_VERSION` (`agency-links` package index): the package; `domain/agency-links.ts`; in `domain/oregonai.ts` and `domain/statute-links.ts` what the package calls; `ingest/lib/agency-links.ts` (`agencyReadOf`, which document kind is read how); `database/lib/agency-evidence.ts` (how evidence is stored); and the shape of the registry, the Chapter table and the parents that `oregonai-snapshot` hands it. A change to the Statute Link parser is not a reason: its own bump reads the file again and clears the Agency Links (ADR-0064). Fiscal Impact Statements are covered, since the version is compared for every document `unreadAgencyDocuments` lists.
  - `SPEAKER_TURN_INDEX_READER_VERSION` (`recording-log` package index): the package; `pdf-text`'s `extractPdfLinks`; `ingest/lib/speaker-turns.ts` (`readSpeakerTurnIndex`, which turn gets which speaker, Measure and player link); and `legislators/resolver.ts`'s matching rules. A change to the Legislator or Agenda-item rows that the reading consults is data and is not a bump.
  - `TURN_PASSAGES_READER_VERSION` (`search` package, `passages.ts`): `splitAroundTurns`, `speakerTurnSpans` and what they call in `search/lib/split.ts`, the embedder's passage size, and `replacePassages`.
  - `ITEM_MEASURES_READER_VERSION` (`recording-log` package index): `measuresOfAgendaItem`, `measureOfAgendaItem` and what they call, and the worker's loop that stores them (`ingest/index.ts`).
  - `LINK_ANNOTATIONS_READER_VERSION` (`pdf-text` package index): `extractPdfLinks`, `linkAnnotationsOf` and the stored shape (`storeLinkAnnotations`).
  - `TRANSCRIPT_READER_VERSION` (`transcript-read` package index): `readTranscript` and what it calls (`transcript-read/lib/format.ts`, `attach.ts`'s word, quality and drift rules), and `ingest/lib/transcripts.ts`'s `storedPassagesOf`, `cutToSize` and `qualityOf`. It is apart from `ATTACHMENT_VERSION`, which stays in the hash and covers only how stored words are attached to turns again.
- **How each is made again.**
  - Agency Links: `unreadAgencyDocuments` also lists a document whose `agency_read.reader_version` is not the current one. Nothing is fetched.
  - Turn passages and item Measures: `recordingLogsWithoutTurnPassages` and `recordingLogsWithoutItemMeasures` also list a log whose recorded version is not the current one; `replacePassages` and `storeItemMeasures` record it. Nothing is fetched. Storing the log's index again (`storeSpeakerTurnIndex`) still resets both markers, so the next pull cuts and reads again as before.
  - Transcript words: a transcript is read from its file again when the file's checksum, its attachment hash or its `reader_version` differs. When the file is gone from the folder the stored words stay, as owner decision 2 of 2026-11-05 has it, and are reported as without their file; they keep the old version, and the file's return reads them. Nothing leaves the machine.
  - Link annotations and the speaker-turn index: both need the PDF, so a version difference means a fetch. See the next point.
- **The re-fetch is capped per pull.** A Recording Log whose stored annotation version or index version is not the current one is fetched again only while it is still in the feed's links (the existing loop already walks the feed's links, so a log OLIS has dropped is never asked for), and **at most `RECORDING_LOG_REREAD_LIMIT` (25) logs are fetched for a version in one pull**, taken in document-id order. A pull that has more leaves the rest to the next one, and its build report says how many are left. Logs with no index or no annotation row at all are fetched as before and are not counted against the limit (ADR-0052); the limit bounds only the new, version-triggered fetches. A fetch that fails, or whose bytes differ from the stored file (ADR-0040), stores nothing and counts against the limit, so a log that cannot be fetched cannot make a pull ask OLIS more than 25 times. The fetch itself is the existing one (ADR-0051's client, ADR-0062's stall rule). The 25 is a number the owner can change; it is a constant, not a setting.
- **One fetch makes only what its version asks.** A fetch for a stale annotation version stores the annotations and leaves the index alone; a fetch for a stale index version stores the index and, because it is read from the same PDF, also stores the annotations if theirs are stale, and the index leaves the annotations alone otherwise. A bump of `LINK_ANNOTATIONS_READER_VERSION` therefore does not store the index again (which would reset the turn passages, the item Measures and mark the Meeting's transcripts for attaching, ADR-0053, ADR-0055), and a bump of the index's version re-stores annotations only when theirs differ. A log with no link at all is marked read (`recording_log_annotation_read`) and is no longer listed on every pull.

## Considered Options

- **A shared table of (reading, subject, version).** Rejected, as above.
- **One version for all five.** Rejected: ADR-0065 rejected the same for two, and here a bump to the transcript words would make every Recording Log be fetched again from OLIS.
- **Fold the version into an existing marker** (`item_measures_read` as a version number instead of 0 or 1). Rejected for the reason ADR-0064 gives: one column would hold two facts. It also would make the index's reset to 0 and a version indistinguishable.
- **No cap, and let every stale log be fetched in the first pull.** Rejected: 25 per pull is a pause the box can bear, while every Recording Log of a Session in one pull would ask OLIS for each of them. The index can only be made again inside the OLIS window, and a long run would risk it.
- **Make the speaker-turn index again from the stored text.** Impossible: the links are not in the stored text (ADR-0052).

## Consequences

- Schema step 10 moves the image's version to 10. The box's schema gate (platform-deploy#45, ADR-0048) holds the merged image until a v10 database is swapped in; the server refuses a v9 file until the worker has opened it. The deploy box's worker must be on, and the v10 database swapped in, before the merge reaches it (ADR-0048, the 2026-11-05 outage).
- The first pull after step 10 makes again, from stored text and with no fetch, every Agency Link, every turn passage cut and every item Measures reading; it reads every transcript file in the folder again; and it fetches at most 25 Recording Logs, then 25 more on each following pull, until all are stamped. The results should come out the same until a reader changes.
- A transcript is read again from its file, so its passages are stored again and the search generation moves, as for a changed file.
- A bump that is forgotten does not reach a stored database, as before this ADR.
- The speaker-turn index's re-read exists, bounded. A log whose fetched bytes differ from the stored text's (ADR-0040) is retried every pull and uses one of the 25 until the file is replaced or OLIS stops listing it; the build report names it.
