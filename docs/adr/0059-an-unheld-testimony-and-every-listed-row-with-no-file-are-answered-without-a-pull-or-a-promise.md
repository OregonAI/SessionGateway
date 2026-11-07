---
status: accepted; amends ADR-0017 (its sentence that `get_document` says "the next pull fetches it again"); reworded by the owner on 2026-11-07 after review
---

# An unheld Testimony, and every listed row with no file, are answered without naming a pull or promising a fix

ADR-0017 has `get_document` answer a listed Testimony whose file is not held with an error that says "the index does not hold its file yet" and that "the next pull fetches it again". That is true of an outage and false in the case #116 found: 56 of 2026R1's Testimony files are zero bytes and 1 more is not a readable PDF, and the backfill's runs of 2026-11-03 and 2026-11-07 found the same 58 documents empty or broken again (`docs/research/olis-odata.md`, section 9). For those, "the next pull fetches it again" promises a fix that may never come.

The first rewording of 2026-11-07 said "the last pull could not store it ... the build report says which". Review found that false too: during a running full pull the row is listed before its file is fetched, so no pull has failed on it; after a stopped or short-read pull the pull never reached it; and a Testimony an Increment first stored was not reached by any full pull. A caller of the tool also cannot read the build report. The answer therefore names no pull, no outcome of a pull, and no report.

## Decision

The owner decided on 2026-11-07: **wording only, no schema step.**

- The answer for a listed Testimony whose file is not held reads: `Testimony "<id>" is listed in the <Session> Session. This index does not hold its file: OLIS may serve it empty or broken, a request for it may have failed, or a pull has not reached it yet.` It names no last pull, makes no promise, and points at no build report. It does not say that the next pull fetches the file.
- The cause (an empty file, an unreadable file, or an unanswered request) is in the build report's `documents_not_fetched` as `cause`, and is not stored where the server reads. The server therefore cannot say which it was, and the answer does not guess.
- Everything else of ADR-0017 stands: every Testimony row of the feed is listed before its file is fetched, and an id that no feed row names is unknown.
- **Every kind the feed lists before its file is fetched** (a Version, a Printed Amendment, an Exhibit, an analysis document, a Recording Log, an Agenda, a Floor Letter, a Proposed Amendment) is answered as a listed row with no file, not as an unknown id: `The <kind> "<id>" is listed in the <Session> Session, and this index holds no file for it, so it holds no text for it.` The kind is the row's, which the reader reports as `UnheldDocument.kind`; the server does not read it from the id. Testimony keeps its own sentence above.
- A row the feed does not name, or one of no kind the index can name, is still an unknown id.

## Consequences

The exact answer for each cause (the file OLIS serves is empty; it is not a readable PDF; the request got no answer) needs the cause stored per document, which is a schema step (ADR-0048) that the owner approves. That is ticket #168, for when the worker is running again.
