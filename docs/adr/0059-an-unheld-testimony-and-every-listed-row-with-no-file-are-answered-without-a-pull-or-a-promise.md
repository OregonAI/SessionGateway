---
status: accepted; amends ADR-0017 (its sentence that `get_document` says "the next pull fetches it again")
---

# An unheld Testimony is answered with what the last pull did, and the answer promises no later fix

ADR-0017 has `get_document` answer a listed Testimony whose file is not held with an error that says "the index does not hold its file yet" and that "the next pull fetches it again". That is true of an outage and false in the case #116 found: 56 of 2026R1's Testimony files are zero bytes and 1 more is not a readable PDF, and the backfill's runs of 2026-11-03 and 2026-11-07 found the same 58 documents empty or broken again (`docs/research/olis-odata.md`, section 9). For those, "the next pull fetches it again" promises a fix that may never come.

## Decision

The owner decided on 2026-11-07: **wording only, no schema step.**

- The answer for a listed Testimony whose file is not held reads: `Testimony "<id>" is listed in the <Session> Session. This index does not hold its file: the last pull could not store it. OLIS may serve it empty or broken, or the request failed; the build report says which.` It does not say the next pull fetches the file, and it does not say "not yet".
- The cause (an empty file, an unreadable file, or an unanswered request) is in the build report's `documents_not_fetched` as `cause`, and is not stored where the server reads. The server therefore cannot say which it was, and the answer does not guess.
- Everything else of ADR-0017 stands: every Testimony row of the feed is listed before its file is fetched, and an id that no feed row names is unknown.
- A listed Version whose file is not held is answered as a listed row with no file (ticket #116), not as an unknown id.

## Consequences

The exact answer for each cause (the file OLIS serves is empty; it is not a readable PDF; the request got no answer) needs the cause stored per document, which is a schema step (ADR-0048) that the owner approves. That is ticket #168, for when the worker is running again.
