# Two Testimony letters are identical when the hash of their extracted text is the same, and the worker stores that hash

Ticket #14 (the `testimony` tool) reports a Measure's identical letters once, with a count, so an agent need not find them among thousands of rows. Two files are identical when their extracted text is the same string, not when their bytes are the same: the worker computes the sha256 of each document's extracted text when it fetches the file and stores it (`document.text_hash`) beside the sha256 of the file's bytes (`content_hash`), and the tool compares the stored text hashes. The text is compared as stored, with no normalization, as ADR-0010 serves it. A file with no text layer is never identical to another: SB 921's two photographs (148731 and 148734) both extract to nothing, and that says nothing about what the pictures show. Only the rows of one Measure are compared.

Two files with the same words can differ in bytes. SB 69's -1 was posted three times with PDFs that differ only in their modification date (ADR-0010), and a letter generated from a web form may differ the same way, so a count by bytes would understate how many people sent the same words.

## Considered Options

- **Identical by `content_hash`, the hash of the file's bytes.** It needs no new column, but a re-posted file with a new modification date would count as a different letter.
- **Compare the stored text when the tool is called.** No new column, but SB 210's 14,223 letters (the most of any Measure of the 2025R1 feed, counted over the full local cache on 2026-10-30) would be read from the database in full for every call.

## Consequences

Every stored document has a `text_hash`, in a column the worker's `CREATE TABLE IF NOT EXISTS` makes. A database file built before this ticket lacks it, and a server given that file does not start, because the reader prepares its queries when it opens the file. No database has been deployed (tickets #24 and #25), so the answer is to rebuild it, the position ADR-0014 takes for `legislator_code`. A stored file is unchanging and is not fetched again (ADR-0005, ADR-0011), so changing what counts as the same text later means recomputing the hash of every stored document from its stored text.
