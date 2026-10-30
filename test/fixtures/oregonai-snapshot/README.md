# The OregonAI snapshot fixture

The OregonAI snapshot (ADR-0012) cut down to what the 2025R1 fixture (`../olis-2025R1/`) touches, so a
test can build a database with real agency, section and chapter data and CI needs no checkout of
OregonAI's repository. It is made by the same script that builds the whole snapshot, never edited by hand.

| File | What it holds |
|---|---|
| `snapshot.json` | The snapshot: `version` (the `executive-regulatory-frameworks` commit it was read from and the commit's date), `agencies`, `orsSections` and `chapterAgencies`. |
| `trim.json` | What the trim kept and why: the ORS chapters the fixture cites, those of them the snapshot has no section of, the Agencies the fixture names, the counts kept and in all, and the SHA-256 of `snapshot.json`. |

## What was kept

Taken from the checkout at commit `58e1839d441addf3ac1e1748c91ce3de78d3f342` (2026-09-13, behind
`origin/main`):

- 39 ORS chapters, of 531 with a section: every chapter that a document or a Measure of the 2025R1
  fixture cites in one of the forms listed under "How the list was taken". Each keeps all its sections
  (4,392 of 37,534), so a range can be expanded inside it.
- 114 Agencies, of 190 registry rows: the 28 whose name or alias the fixture's texts contain, and every
  Agency a rule of which implements a section of a kept chapter. The second kind is most of them: chapter
  192 (public records) alone has 57, because many agencies' rules implement it.
- The chapter table's rows for the kept chapters: each of the 39 has one (39 of 439 rows in all).

`snapshot.json` is about 120 KB; the whole snapshot is about 850 KB.

## How the list was taken

From the fixture's own words (`scripts/snapshot/touched.ts`), on purpose loosely, so that the trim keeps
too much rather than too little:

1. **ORS chapters.** The text of every document in `../olis-2025R1/manifest.json` (extracted by the
   `pdf-text` package) and every text value of `feed/Measures.json` is scanned for an ORS citation: `ORS`
   followed by a section number and the sections listed after it ("ORS 409.711 and 418.808", "ORS 418.806 to
   418.816", "ORS 659A.159, as amended by ...") or `ORS chapter(s)` and a chapter ("ORS chapter 657B"), or a
   section number alone in parentheses ("(318.031)"), which is how a table under an "ORS" column header
   writes a second section: exhibit 295037 (SB 121's Tax Credit Report) has "315.154-156 (318.031)", and
   chapter 318 is cited nowhere else. Any other bare number is not a citation: "1,234.567" is not, and nor is
   the "1.425" of a Tax Expenditure Report, and the whole-Session Statutes Affected Table (a document of
   the fixture) lists most chapters of the ORS without writing ORS before any of them, so reading its bare
   numbers would keep nearly everything. A citation written in a table in some other way is missed. This is
   not the Statute Link parser (ticket #6): it does not tell amends from cites. A cited chapter of which ERF holds no section is listed in
   `trim.json` under `orsChaptersNotInSnapshot`; this time there is none.
2. **Agencies.** An Agency is kept when its `name` or one of its `aliases` is written, as whole words and
   without regard to case, in any of those texts or in the `Organization` of a Testimony row, or when the
   chapter table lists it under a kept chapter.

## Regenerating

With Node 26 and a local checkout of `executive-regulatory-frameworks` (only read: git runs with
`GIT_OPTIONAL_LOCKS=0`, and the build stops if `_meta/catalog/agencies.yml`, `_meta/graph.json` or
`statutes/` has uncommitted changes, because the commit would then not describe the data):

```
node scripts/snapshot/build.ts --erf <checkout> --out test/fixtures/oregonai-snapshot/snapshot.json \
  --trim-to test/fixtures/olis-2025R1 --trim-record test/fixtures/oregonai-snapshot/trim.json
node scripts/snapshot/verify.ts
```

The same checkout gives the same bytes. A newer checkout gives a new `version` and perhaps new rows;
commit the result, and the tests that name the version change with it. Adding a Measure to the 2025R1
fixture that cites a chapter this one lacks fails `verify.ts` until the snapshot is rebuilt.

`verify.ts` needs no checkout and runs in `npm run check` (`snapshot:verify`, a step of its own after `fixture:verify`, so that the summary says whether this fixture is sound when the 2025R1 one is not). It checks that
`snapshot.json` is the file `trim.json` hashed, that it parses, that the chapters the 2025R1 fixture cites
are the recorded ones, and that the snapshot holds the sections of exactly those chapters and the
Agencies the fixture names or the table lists. It cannot see whether the trim kept every section ERF has
of a kept chapter; rebuilding from the checkout shows that.

Do not edit the generated files by hand. The hash check would catch it, and the snapshot could no longer
be reproduced.

## License

The snapshot is made of data from `_meta/` in OregonAI's executive-regulatory-frameworks repository
(`_meta/catalog/agencies.yml` and `_meta/graph.json`) and the names of its `statutes/` files. That
repository licenses `_meta/` under the MIT License, "Copyright (c) 2026 the repository contributors", whose
terms are:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction, including
> without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
> following conditions: The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
> LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
> EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
> IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
> USE OR OTHER DEALINGS IN THE SOFTWARE.

This repository's MIT license covers the code. The same notice belongs with any copy of the full snapshot.

