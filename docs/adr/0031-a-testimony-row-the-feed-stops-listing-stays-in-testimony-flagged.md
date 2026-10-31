---
status: accepted
supersedes: ADR-0017 in part (what happens to a Testimony row OLIS stops listing once removals are marked)
---

# A Testimony row the feed stops listing stays in `testimony`, in its total and on its page, flagged

ADR-0017 listed Testimony from the feed before its files were fetched, and said that a row OLIS stops listing "stays in `total` and on its page until removals are marked (spec #1, module 2; ticket #18)". Read plainly, that says the row leaves once ticket #18 marks removals. Ticket #18 marks them (ADR-0030: a row two complete full pulls in a row have not listed is no longer listed), and this ADR decides what that does to `testimony`: nothing leaves. A row that is no longer listed stays in the list, in `total`, in the position counts and in its identical-letter set, with `no_longer_listed: true` on the item and `last_listed_at` where `get_document` serves it. The flag is left out of every item the feed lists, so a list that nothing has left is the list it was.

Spec #1 (story 47) and ADR-0005 say only that a removed row leaves search results and stays fetchable by id; neither says it leaves the tools that list rows. A withdrawn letter that vanishes from "who testified" is a loss an agent cannot see, and an agent that was told yesterday of 42 Testimony rows would be told of 41 today with no reason. Search is the only place that leaves the row out. ADR-0017's other decisions stand: the table is only upserted, `total` is the rows the index holds from the feed it last read, and a Testimony whose file was never fetched answers `get_document` with an error (ADR-0030 says which one).

## Considered Options

- **Drop the row from `testimony` once it is no longer listed.** It would read ADR-0017 as written, and the count would follow the feed. It hides a change an agent cannot otherwise see, and a letter that a citation already gave would stop appearing in the Measure's list while `get_document` still serves it.
- **Keep it, unflagged.** The count would be the feed's last and the list would show a letter the feed no longer lists as if it were listed. The flag costs nothing when the feed lists the row.
