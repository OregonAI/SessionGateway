# The 2025R1 fixture

A trimmed slice of the 2025R1 Session, committed because CI cannot see the gitignored cache. It is
public record, mirrored as published (ADR-0002): the repo's MIT license covers the code, not these
documents. Every Measure in `measures.txt` is here with all its feed rows, the rows those rows
point at, and every document they link.

| Path | What it holds |
|---|---|
| `feed/<EntitySet>.json` | The chosen rows of one entity set, as a JSON array. Each row is the feed's own object: property names verbatim (`CommitteCode`, `CommittteCode`, `LegislatoreCode`), decimal keys as strings, in the order of the cache. |
| `documents/` | The exact bytes OLIS served, one file per document, in a folder per kind. |
| `manifest.json` | For each document: `path`, `source_url`, `retrieved_at`, `sha256`, `bytes`, `content_type` and `linked_by` (the feed rows that link it). |
| `unresolved.json` | The references the full cache cannot resolve either (see below). |
| `measures.txt` | The chosen Measures, each with the reason it was chosen. It is the only input a person edits. |

## What is in the slice

- **Rows.** For each chosen Measure, every row about it in every entity set. Then the rows those
  rows point at: committees (and their parents), meetings, agenda items and the Legislators that
  sponsor and vote rows name. The closure runs one way: another Measure's rows are not pulled in
  because they share a meeting, and the build stops if a reference would pull one in.
- **Not in the slice.** `CommitteeMembers`, `CommitteeStaffMembers`, `ConveneTimes` and
  `LegislativeSessions`: no row about a Measure points at them. `verify.ts` still knows what
  refers to what in the first three. Adding `CommitteeMembers` would need a decision first: its
  `LegislatorCode` holds the personal names of non-legislator members (`olis-odata.md` section 8,
  gotcha 5), which no Legislators row matches, and the build stops on a gap that is not documented.
- **Documents.** Versions and Printed Amendments, analysis documents (Fiscal and Revenue Impact
  Statements, staff measure summaries), Proposed Amendments, Exhibits (the feed's
  `CommitteeMeetingDocuments`), agendas, and Testimony from
  `/Downloads/PublicTestimonyDocument/{CommTestId}` (the feed's `DocumentUrl` for Testimony is the
  session root). MeasureDocument URLs are recorded percent-encoded.
- **The Statutes Affected Table** (`documents/reports/artables2025R1.pdf`) is copied from the
  reports cache. No feed row links it, and its manifest entry has an empty `linked_by`. Its
  `source_url` is on `www.oregonlegislature.gov`, not `olis.`: the cache's `.hdr` file holds the
  response headers only, so the URL comes from `docs/research/olis-odata.md` section 5.
- **Documents with no text layer:** `documents/committee-meeting-documents/288141.pdf` (SB 64) and
  the two photographs `documents/testimony/148731.pdf` and `148734.pdf` (SB 921).
- **References the full cache cannot resolve.** `Rep Neron` and `Sen Woods` have no Legislators
  row (`olis-odata.md` section 8, gotcha 4), and a scan of every reference in the full cache found
  no other gap. The build writes each such reference to `unresolved.json` with its reason, and
  stops on any other reference the cache cannot resolve. `verify.ts` accepts only those two
  Legislator Codes with that reason, and fails on any other reference, on an entry with another
  target or reason, and on an entry that matches no reference. A new gap is added to
  `scripts/fixture/schema.ts` by a person, with the evidence.
- **Alias coverage: not met as the ticket words it.** The ticket asks for a Fiscal Impact
  Statement that names an alias ("ODHS"). No Fiscal Impact Statement in the slice spells "ODHS" in
  its "Government Unit(s) Affected:" line, and none of the 19 statements among the cached samples
  does either (`pdftotext` over `documents-sample-1/` and `-2/`), so choosing from the samples,
  as the brief says, could not meet it. What the slice does hold: Staff Measure Summaries 90799
  (SB 64) and 92329 (HB 3795) write "Oregon Department of Human Services (ODHS)"; HB 3795's
  Testimony row 209256 gives the Organization as "ODHS"; HB 3795's statements say "Department of
  Human Services" in the unit line; and SB 921's statement uses "OBDD" for the Agency its unit
  line calls "Oregon Business Development Department". Whether those count as the registry
  aliases the spec means can only be settled against the OregonAI agency registry. Meeting the
  ticket's wording needs one more Measure, found by reading Fiscal Impact Statements outside the
  samples, and so one more download run: that is the owner's call.

## How it was produced

`scripts/fixture/build.ts` read the 2025R1 feed cache (`.cache/olis-2025R1/feed/`) and
`measures.txt`, selected the rows, and downloaded the 278 documents the download cache lacked, in
one run on 2026-10-29 (Pacific) between 23:15 and 23:31: one request at a time, at least a second
apart, none retried, none failed, 65,141,256 bytes. Each download is kept in
`.cache/olis-2025R1/downloads/` with its `source_url` and retrieval time beside it and is never
fetched again. Sample files in `documents-sample-1/` and `-2/` were used only to choose Measures.

## Regenerating

With Node 26 and the cache directory (`.cache/` in a checkout that has pulled the feed):

```
node scripts/fixture/build.ts --cache .cache --offline
node scripts/fixture/verify.ts
```

The build needs the whole feed cache, a file for every entity set, and stops naming the file if
one is missing. `--offline` never fetches: a document missing from the download cache is an error
that names it. Once the cache holds every document, a rebuild produces no diff: row order, JSON
formatting and every timestamp come from the inputs, never from now. Without `--offline` the build
fetches only what the download cache lacks, from `https://olis.oregonlegislature.gov/` and nowhere
else. `--plan` prints what it would fetch and an estimate, and changes nothing. The build refuses
to fetch more than 500 documents, or an estimated 100 MB, and stops a download run that would take
the whole fixture past 100 MB.

`verify.ts` needs no cache. It recomputes every document hash; checks that each manifest file
exists and every file under `documents/` is listed; resolves every key a fixture row refers to
inside the fixture (apart from the documented gaps above); resolves each manifest entry's
`linked_by` to fixture rows that link that document, and requires every document except the
Statutes Affected Table to be linked; and fails on a row that lacks a property the schema reads,
or on an entity set it does not know.

Do not edit the generated files by hand. The hash check would still pass, and the slice could no
longer be reproduced.

## Adding a case

1. Add the Measure to `measures.txt` with a comment saying why.
2. Run `node scripts/fixture/build.ts --cache .cache --plan` and read what it would fetch.
3. Run it without `--plan` to fetch those documents, then `node scripts/fixture/verify.ts`.
4. Commit the changed files. Add a document only when a test needs it: GitHub warns at 50 MiB per
   file.
