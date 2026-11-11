---
status: accepted (owner decision of 2026-11-10, ticket #177); amends ADR-0052 (a fourth outcome of reading a log, and a fourth kind of `recording_log_gaps`) and ADR-0055 (a set-aside copy's transcript is removed); no schema step (ADR-0048)
---

# A Recording Log filed under two Meetings is indexed only under the Meeting its own header names

ADR-0052 takes a Recording Log's Meeting from its feed row and reads the log's turns into that Meeting. A sweep of the 2026R1 index on 2026-11-10 found OLIS had filed one file under two Meetings twice (the same `content_hash`):

- `recording-log-2026r1-316540`, under `meeting-2026r1-secbh-2026-02-03-0800`, titled "HBH Recording Log 2.3.26", whose text begins "HOUSE COMMITTEE ON BEHAVIORAL HEALTH ... 01:00 PM": the same file as `recording-log-2026r1-316511` under `meeting-2026r1-hbh-2026-02-03-1300`;
- `recording-log-2026r1-316512`, under `meeting-2026r1-hed-2026-02-04-0800`, titled "SJUD 02.04.26 (recording log)", whose text begins "SENATE COMMITTEE ON JUDICIARY ... 12:45 PM": the same file as `recording-log-2026r1-316510` under `meeting-2026r1-sjud-2026-02-04-1245`.

Both copies were indexed, so events 2026021027 and 2026021046 each belonged to two Meetings, each transcript was attached twice (270 transcripts stored from 268 files), and `get_measure` listed a "Public Hearing" of HB 4068 at SECBH 2026-02-03 08:00 and of SB 1550 at HED 2026-02-04 08:00, neither of which happened. No build-report list said so.

## Decision

The owner decided on 2026-11-10:

- **Where one file is filed under more than one Meeting, a copy is indexed only under the Meeting its own header names.** The header is the log's first page under the compliance sentence: the committee lines up to the date line ("HOUSE COMMITTEE ON AGRICULTURE, LAND USE, NATURAL" / "RESOURCES, AND WATER"; a subcommittee's log prints its parent first, "JOINT COMMITTEE ON WAYS AND MEANS" / "SUBCOMMITTEE ON GENERAL GOVERNMENT"), and the time on the line after the date ("08:00 AM", "8:30 AM", "3:00pm"). `recordingLogHeaderOf` (`recording-log`, pure) reads it. `headerNamesMeeting` says the header names a Meeting when its first word is the chamber the committee's code begins with (H: HOUSE, S: SENATE, J: JOINT, so HJUD and SJUD, both "Judiciary", are told apart), its committee lines end with "ON " and the committee's name as the feed gives it (`committee.name`; case, spacing and dashes aside), and its time is the Meeting's start in Pacific time.
- **The other copies get no turns and no transcript.** Each gets the outcome `log_of_another_meeting` in `speaker_turn_index.outcome`, which is free text, so no schema step is needed. Like `no_event_id`, it has no turns, so it gives no hearing in `get_measure`, no turn in `search`, and is no target for a transcript. `get_document` shows it as `speaker_turns.gap: "log_of_another_meeting"`. The log's text stays stored and searchable as the document OLIS posted (ADR-0002).
- **When no copy's header names its Meeting, none is indexed**, and each is reported.
- **The build report names each copy** in `recording_log_gaps`, as kind `log_of_another_meeting` with the Meeting it is filed under (`meeting_id`), its header as printed (`header`, the committee lines and the time joined by spaces) and the other logs of the same file with their Meetings (`same_file_as`). Whether one of those was indexed is seen from whether it is itself a gap.
- **The rule runs after the run's logs are read**, in the documents step of a full pull and of an increment alike (`setAsideCopiesOfOtherMeetings`, `ingest`), before the logs are cut around their turns and before transcripts are read. So the order the copies arrive in does not matter: a copy indexed alone by an earlier pull is set aside by the pull that stores the copy its header names.
- **A set-aside copy takes its transcript with it (amending ADR-0055).** Storing the outcome for a log that was indexed removes the transcript its Meeting holds for the event the log named, unless another indexed log of that Meeting names the event, in the same transaction. The transcript file itself is read again against the copy the header names, which is then its only target. ADR-0055's rule that a transcript stays stored when its *file* has gone is unchanged: here it is the Meeting's log that is not the Meeting's.

## Considered Options

- **Check every log's header against its Meeting, a copy or not.** Rejected for now: three of 2026R1's 279 logs that OLIS filed under one Meeting only do not match it by the rule above, and all three look like the right log for the Meeting: `recording-log-2026r1-315880` (SLB 2026-02-23, Meeting 14:30, header "03:00 PM"), `recording-log-2026r1-316224` (JWMGG 2026-02-23, Meeting 14:30, header "01:00 PM"), and `recording-log-2026r1-316110` (SFR 2026-02-27, whose first page has no header the reader finds). A Meeting whose start OLIS moved, or a log that prints the time it was scheduled for, would lose its turns. The rule is for the case where the header must choose between Meetings. A lone log is read as before, whatever its header says.
- **Keep the copy whose document id is lower, or the one created first.** Rejected: 316511 and 316540 were posted the same day, and neither the id nor the time says which Meeting the file is the log of. The header does.
- **Store which copy a set-aside log is a copy of.** Not needed: the build report works it out from the `content_hash` the store already holds, so no column is added (no schema step).
- **Leave a set-aside copy's transcript stored but unattached.** Rejected: it would count among the stored transcripts (270 for 268 files) and stay in the store with nothing to read it against.

## Consequences

After the next 2026R1 pull, HB 4068 has no hearing at SECBH and SB 1550 none at HED, and the 268 transcripts are stored as 268 (the acceptance boxes of #177).

A set-aside copy is not read again when its file's other copies go away, because its index row exists and `recordingLogsWithoutIndex` does not list it. Nothing removes a stored log today, so that does not happen; a ticket that removes logs decides it.

Two copies whose headers both name their Meetings (one file filed twice under the same committee and time) are both indexed, as before.

Seam 1's cases are in `test/tools/recording-log-copies.test.ts` (copies that arrive together, and copies no Meeting of which matches) and `test/tools/recording-log-copies-pull.test.ts` (a copy indexed alone, then set aside with its transcript), each with made-up Meetings carrying the fixture's real log 288741, labelled so.
