---
status: accepted (owner decision of 2026-11-10, ticket #168: schema step 7 approved and built now); amends ADR-0059 (its decision "wording only, no schema step" and the general answer for every cause); extends ADR-0048 (the seventh numbered step) and ADR-0056 (the clock's views)
---

# get_document says what the worker's last attempt found of an unheld document's file

ADR-0059 had `get_document` answer an unheld Testimony with one general sentence ("OLIS may serve it empty or broken, a request for it may have failed, or a pull has not reached it yet"), because the cause of a document left out (`empty_file`, `unreadable_file`, `request_failed`, ticket #116) was only in the build report, which the server does not read. 56 of 2026R1's Testimony files are zero bytes and 1 is not a readable PDF (ADR-0059's correction), and for those the general sentence leaves out the one thing that is known. ADR-0059 named the schema step that would let the server say it as ticket #168, for the owner to approve. The owner approved it on 2026-11-10, to build at once and not to wait for the worker to be turned back on.

## Decision

- **Schema step 7** (ADR-0048) makes `last_fetch_failure`: one row for each document the index holds no file of and that an attempt has failed on, keyed by `document_id`, with the cause, the worker's reason (the build report's `reason`) and `bytes_received` (ADR-0062: the bytes the ending attempt received when it began to answer and stopped; null otherwise). `versionOneSchema` is unchanged.
- **A table of its own, keyed by the document, and not a column.** The documents this is about have no row in `document`, which holds only stored files, so a column there has nothing to hang on; `document_created` holds every linked document but is the creation time the clock reads (ADR-0056), and mixing a worker's attempt into it would make every pull rewrite it. A table of its own also makes "cleared when the file is stored" a delete in the transaction that stores it.
- **The worker writes it at every attempt and clears it when the file is stored.** Each document the pull leaves out (the same ones the build report's `documents_not_fetched` lists; a revised agenda whose fetch fails is still held, ADR-0041, and gets none) replaces its row with this attempt's result. `storeDocument` and `replaceDocument` delete the row in their transaction. A stored Recording Log fetched again to read its links (#179) is held and gets none.
- **The readers' clock views cover it** (ADR-0056): a temp view over the table shows only the rows of documents created by the clock, as for every table that hangs off a document. The reader hands it out as `lastFetchFailureOf(id)`.
- **What get_document says**, for a listed row with no file (no change for a row the feed no longer lists, or an unknown id):
  - `empty_file`: an unheld Testimony is answered `Testimony "<id>" is listed in the <Session> Session. This index does not hold its file: the file OLIS serves for it is empty.`; any other listed kind `The <kind> "<id>" is listed in the <Session> Session, and this index holds no file for it: the file OLIS serves for it is empty.`
  - `unreadable_file`: the same, ending `the file OLIS serves for it is not a readable PDF. The worker's reason: "<reason>"`, with the worker's reason as stored, quoted after a full stop so that the answer has no parenthesis inside a parenthesis and no capital letter run on mid-sentence.
  - `request_failed`, or no record (no attempt yet, or a database upgraded to step 7 that no pull has tried since): ADR-0059's general answers, unchanged. A request that got no file says nothing about the file, so nothing more is said.
- The answer names no pull and promises no fix, as ADR-0059 decided. "Serves" is as of the worker's latest attempt: a file OLIS replaces is seen at the next attempt, which replaces the record or, when the file is stored, clears it.

## Consequences

- A database at version 6 is upgraded by the worker on open; the server refuses it until then (ADR-0048), so the image's version moves to 7 and platform-deploy#45's gate applies. After the upgrade no document has a record until the next pull tries it, so the box's answers stay general until its first pull with step 7.
- The build report keeps its `cause`, so a reader of the report and a caller of the tool see the same cause.
- `testimony`'s `fetched` description no longer says that get_document does not say which cause it was.
