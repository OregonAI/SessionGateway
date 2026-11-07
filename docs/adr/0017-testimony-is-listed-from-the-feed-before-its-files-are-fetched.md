---
status: accepted; the sentence of Consequences that a row OLIS stops listing stays in `total` and on its page "until removals are marked" is superseded by ADR-0031; the sentence that `get_document` says "the next pull fetches it again" is amended by ADR-0059
---

# `testimony` lists every Testimony row of the feed before its file is fetched, and `get_document` says so when it does not hold a listed file

The worker writes a `testimony` table from the feed's rows in the same transaction as the rest of a full pull, before it fetches any file (ADR-0011, "Order of a pull"). The tool lists from that table joined to `document`, so a Testimony whose download failed is listed with `fetched: false` and no text-layer flag, as `meetings` lists a document it does not hold. `get_document` answers such an id with a tool error that names the id, says the index does not hold its file yet, and says the next pull fetches it again. It does not say what it says of an id that is no document's ("Give a document id such as ..."), which would tell the agent that the id the tool just handed out is malformed. An id that no feed row names is still unknown.

So the ticket's box "each item has an id that `get_document` resolves" holds for every item whose file is fetched, and an item whose file is not fetched answers with that error. A Testimony whose text is not held is in no set of identical letters, so a set's count is of the rows whose files are held.

## Considered Options

- **List only the Testimony whose files are fetched.** Every id the tool returned would resolve, but a failed download would remove a person from "who testified" without a word: a 250-letter campaign in which 10 downloads time out would lose 10 people from the answer and 10 from the count.
- **List every row and let `get_document` answer as for an unknown id.** The same listing, with a message that is wrong for an id the tool itself returned.

## Consequences

A database built before this ticket has no `testimony` table, and a server given it does not start (the same position as ADR-0016). The table is only upserted: a row OLIS stops listing stays in `total` and on its page until removals are marked (spec #1, module 2; ticket #18), and `total` says it is the rows the index holds from the feed it last read.
