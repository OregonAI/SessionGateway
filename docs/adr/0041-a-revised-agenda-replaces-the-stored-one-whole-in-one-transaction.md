---
status: accepted; fills in the "replaced files" bullet of ADR-0005, which stands; the reason it gives for rejecting a `revision` column (no migration) is superseded by ADR-0048
---

# A revised agenda replaces the stored one whole, in one transaction

ADR-0005 says a fetched document is treated as unchanging, except agendas, which are fetched again when `AgendaRevisionNumber` changes, so an answer never reports a cancelled item. It does not say how the new file takes the old one's place. Ticket #19 builds it.

- **The revision is read from the Meeting's row** (`CommitteeMeetings.AgendaRevisionNumber`) and carried on the agenda's link. A row that gives none counts as 0.
- **The index keeps the revision each agenda was fetched at**, in a table of its own (`agenda_revision`), not a column on `document`, because the schema is created with `CREATE TABLE IF NOT EXISTS` and has no migration. A stored agenda with no recorded revision (a database made before this ticket) is fetched once more, which records one.
- **A full pull and an increment decide the same way.** After they store the feed's rows, a linked agenda that is stored and whose row's revision differs from the recorded one is fetched again; one whose revision is the same is not requested at all. No other kind of document is fetched again by this rule.
- **The new agenda replaces the old one whole.** Its text, content hash, text hash, page count, relations, filing, passages (the full-text rows too), citations and recorded revision are deleted and written again in one transaction, and the search generation moves, so a reader sees the old agenda or the new one and never neither. No earlier revision is kept: an agenda served is the latest one, and `retrieved_at` is the time of the fetch that read it. Vectors are looked up by the hash of each passage's text, so passages the revision leaves unchanged are not embedded again; the vectors of passages it drops stay in `passage_vector`, shared by hash and never loaded for a document that no passage names.
- **A fetch that fails keeps the old agenda** and the old recorded revision, so the next pull or increment asks again. It is not added to the build report's `documents_not_fetched`, which lists documents the index does not hold.
- **An increment sees a revision only through the row's dates.** `CommitteeMeetings` rows carry `CreatedDate` and `ModifiedDate`, and in the 2025R1 fixture every one of the 22 rows whose `AgendaRevisionNumber` is above 0 has a `ModifiedDate` after its `CreatedDate`, so a revision moves `ModifiedDate` as far as the fixture shows. Whether OLIS always moves it is an assumption: if it did not, the full pull still finds the revision, because it reads every row.

## Considered options

- **A `revision` column on `document`.** Rejected: it needs a migration the schema does not have.
- **Keep every revision as a document of its own.** Rejected: ADR-0005's purpose is that an answer never reports a cancelled item, and the tools serve one agenda for each meeting.
