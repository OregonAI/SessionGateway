---
status: accepted; builds on ADR-0005 (increments read FloorLetters by FloorLetterId) and ADR-0030 (the two-pull rule), and supersedes neither
---

# A Floor Letter is a Document that carries its row's fields, and an increment picks it up by FloorLetterId

ADR-0005 says that increments read FloorLetters by `FloorLetterId`, because the set carries no dates, but until ticket #64 the worker read no FloorLetters at all. 2025R1 has 322 rows (`docs/research/olis-odata.md` section 7), and the one sampled letter is a scan with no text layer. The owner decided (ticket #64, 2026-11-01) what a Floor Letter is in the index and how it is picked up.

## Decision

- **A Floor Letter is a Document that carries its row.** Its file is fetched once from `FloorLetterUrl` and kept with its extracted text, `source_url`, retrieval time and content hash, like every document the feed links (ADR-0002). The row's `LetterDate`, Chamber, `LetterTitle` and `LetterDescription`, and its Measure when `MeasurePrefix` and `MeasureNumber` are set, are kept with it in a `floor_letter` table, written for every row before any file is fetched, as Testimony's are. Its id is `floor-letter-{session}-{FloorLetterId}`, and its date, the one search filters it by, is `LetterDate`: the only date the set has.
- **Which tools show it.** `search` finds it under a new document kind, `floor_letter`, with no special search rule: it is found by its words and its meaning, and its title is its `LetterTitle` (else its description) after the Measure's citation. `get_document` serves it with the no-text-layer flag, its related nodes (the Measure, when it names one) and a `floor_letter` field with its row. `get_measure` lists, under `floor_letters`, the letters whose row names the Measure, whether or not their files are in. A letter that names no Measure is under no Measure: search and `get_document` reach it.
- **Full pull.** The worker reads the whole FloorLetters set of the Session with `/$count` and `$inlinecount`, like every other set: a short read refuses the pull, and `build-report.json` counts and lists the set. Each row is tracked in `feed_row` under `FloorLetters`, so the two-pull rule applies (ADR-0030): a letter two complete full pulls in a row miss is flagged `no_longer_listed`, leaves search, and stays served by `get_document`.
- **Increments.** An increment asks for the letters whose `FloorLetterId` is greater than the highest one the index holds a row of (`SessionKey eq '...' and FloorLetterId gt N`), stores their rows, and fetches each new letter's file once, in the increment (ADR-0005). While the index holds no letter, the increment reads the whole set. As with every row an increment first sees, the new letter has no listing row until the next complete full pull lists it, so it is searchable and unflagged (ADR-0030).

## Considered Options

- **The row only.** `get_measure` would list a letter's title and date, but its text would be in no search and no `get_document`, against ADR-0002's "mirror everything as published".
- **The Document only.** The file would be searchable, but a scan has no text, so a letter with no text layer would carry nothing to say what it is: the title, the Chamber and the date are in the row alone, and so is the Measure that `get_measure` lists it under.
- **An increment that reads the whole set each time.** 322 rows are cheap to read, but ADR-0005 already chose the id, and reading by id is what keeps an increment to the rows it has not seen.

## Consequences

- `FloorLetterId` must grow with each new letter for an increment to see it. The research found it does (`olis-odata.md` section 8, "monotonically increasing"); a letter OLIS gave a lower id than one already held would wait for the next full pull, which reads the whole set.
- A row an increment reads is never read again by an increment, so a letter whose row OLIS changes after it is held (a corrected title) is refreshed by the next full pull, and its file is never fetched again (ADR-0005's "treated as unchanging").
- No OCR is done: a scanned letter is served with `has_text_layer: false` and no text. It has no passages, so search does not find it by its words; `get_measure` lists it under the Measure it names, with its title and date, and `get_document` serves it. Statute Links and Agency Links are not read from floor letters.
- The 2025R1 fixture holds no FloorLetters file, so the tests give the fake OLIS made-up rows and made-up PDFs; real rows wait for an owner-run fixture rebuild.
