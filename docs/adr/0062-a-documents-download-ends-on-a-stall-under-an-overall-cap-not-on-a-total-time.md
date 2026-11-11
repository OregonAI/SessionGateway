---
status: accepted (owner decision of 2026-11-10, ticket #167); replaces the 60-second total limit on one attempt to fetch a document, which the code set in ticket #5 (`DEFAULT_DOCUMENT_TIMEOUT_MS`, citing olis-odata.md gotcha 15) and no ADR recorded
---

# A document's download ends on a stall, under an overall cap, not on a total time

The worker gave each document three attempts, and each attempt 60 seconds in all. 32 2026R1 documents (27 Testimony and 5 exhibits, `CommitteeMeetingDocument` 313110, 313496, 314559, 314774, 315258) got no file within that at every full pull with a record (runs 2 and 4; run 3 stored none of them), and each pull spent about 96 minutes waiting on them (32 × 3 × 60 s, arithmetic; `docs/research/olis-odata.md` section 9). A total limit cannot tell a large file that is still arriving from a server that has stopped sending: both are cut off at 60 seconds.

## Decision

The owner decided on 2026-11-10 to build option B of ticket #167 now, without first measuring the 32 files:

- **An attempt ends on a stall.** The OLIS client reads a document's body as it comes. An attempt is given up when no answer, or no further byte of the body, arrives for the stall limit: `OLIS_DOCUMENT_STALL_MS`, 60 seconds unless set (the old total, now the longest silence). A file that keeps sending is read to its end however long it takes, up to the cap.
- **An overall cap bounds an attempt.** `OLIS_DOCUMENT_CAP_MS`, 10 minutes unless set, ends an attempt whatever is still coming, so a server that sends a byte now and then (never a stall) cannot hold a pull for ever. Why 10 minutes: the slowest download olis-odata.md measured, the session-bill HTML list, took 66 s for 7.6 MB (gotcha 15, about 115 KB/s), and at that rate 10 minutes carries about 69 MB (inferred: the 32 files' sizes are not known, so the cap is a bound on a hang and not a measured fit). A document that trickles to the cap costs 30 minutes (three attempts) of the full pull's six-hour window; a pull still running at 6 am is stopped there and stores nothing more, as before (ADR-0039), and the next pull fetches the rest.
- **Both are settings of the worker**, whole milliseconds from 1 to 2^31 − 1 (what a Node timer counts); another value stops the start-up, naming the variable and never its value.
- **Three attempts and the transient-status retry are as they were.** A stall or a cap is retried as a timeout was, with the same pauses (2 s, then 10 s); a 408, 429 or 5xx is retried, and any other status is not.
- **The build report says how far a cut-off file got.** A stall or a cap is cause `request_failed` (ticket #116). A `request_failed` entry in `documents_not_fetched`, and in the Recording Log re-fetch list, which shares its type, carries `bytes_received` when the attempt that ended the download was itself cut off after its answer began (a 200) by a stall or the cap: the bytes that attempt received. It is absent when the ending attempt got none of the file (no answer within the stall limit, a 404, a broken connection before the answer), even if an earlier attempt received some, so a report entry never pairs one attempt's status or reason with another attempt's bytes (after a stall at 100 bytes and then a 404, the entry says `OLIS answered 404 …` and has no `bytes_received`). Chosen over naming the earlier attempt in the reason: the reason and the bytes then describe one attempt, and the earlier stall is in the pull's log.

The rule is the document download's, `downloadFrom` in the OLIS client, so it applies to everything fetched through it: the linked documents, the nightly hash sample's re-fetches (ADR-0040) and the Statutes Affected Table (ADR-0034). The hash sample's and the table's reports keep their shapes; their reasons name the stall or the cap. The nightly hash sample shares `downloadFrom`, so its worst case for one document is also three attempts of the cap, 30 minutes at the default, where it was three of 60 s; a sample whose documents all trickled would take far longer than before, and it stops at its own deadline (ADR-0040) as it did. No code in the sample changes. The feed's requests and the server's live lookup (`OLIS_LIVE_TIMEOUT_MS`) are another code path and are unchanged.

- **A document that still fails after the stall rule is answered truthfully for its case**, as ADR-0063 words it, and not with one answer for all (owner decision of 2026-11-10, ticket #167's last box). An empty file says it is empty; a file that is no readable PDF says so; a stall or a timeout (`request_failed`) keeps the general answer, because the request got no file and nothing is known of the file. It is not "the same answer as empty files".

## Considered Options

- **A. A longer total limit per document**, a setting with 60 s for ordinary files. Not chosen: any total limit cuts off a large file that is still moving, only later, and a longer one makes every hung request cost more.
- **Measure first** (a HEAD request for each of the 32, and one document tried at 180 s, 300 s and streamed), as the ticket proposed. Not done before building: the owner chose to build the stall rule without the measurement. The ticket's boxes for the research note and for the count after one full pull stay open until a pull with the change has run.
- **A cap across the three attempts together** rather than on each. Not chosen: each attempt is a new request, and a per-attempt cap keeps the attempts as they were.

## Consequences

- If the 32 hang without an answer, as their reason ("The operation was aborted due to timeout (3 attempts)") allows, each still costs 3 × 60 s and nothing is gained; their entries then have no `bytes_received`. If they are slow, they are stored; if they trickle past the cap, their entries say how many bytes came. The first full pull with the change tells which.
- A stall limit of 60 s means a server that answers and then sends nothing for a minute is cut off. A test sets both limits small (`startSystem`'s `documentTimeoutMs`, now the stall limit, and `documentCapMs`); the fake OLIS sends a file slowly (`documentPacing`) or stops part of the way (`{ stallAfter: n }`), and `test/tools/get-document-stall-pull.test.ts` holds the cases.
