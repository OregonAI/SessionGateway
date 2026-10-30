# Read PDF text with unpdf, one string per page, and add nothing to it

Every document OLIS links is a PDF, and the service serves its text exactly as published (ADR-0002). The extractor is `unpdf` 1.9.0 (MIT): a pure-JavaScript package that bundles Mozilla's PDF.js 6.4.299 (Apache-2.0) as one file, has no dependencies and no install script, and runs on Node 26 in the server image. It reads each page's text with PDF.js's own line ends, and the `pdf-text` package joins the pages with a form feed (U+000C) and does nothing else to them: no whitespace is collapsed, no line is joined, no hyphen is removed. It does not use unpdf's `mergePages: true`, whose source (`normalizeMergedText`) collapses runs of spaces and blank lines. A file whose pages hold nothing but whitespace is a file with no text layer: its text is empty and `get_document` says so.

Measured on 2026-10-30 under Node 26.13 over the 279 PDFs of the committed fixture, with `pdftotext -raw` (poppler) as a reference and not a dependency:

- All 279 open and extract, in 3.9 s in all: 14 ms on average, 437 ms for the slowest (a 94-page letter).
- Three read as empty, and they are the three scans the fixture README names (Exhibit 288141, Testimony 148731 and 148734). The shortest of the other 276 has 182 characters that are not whitespace, so no threshold is needed: a text layer exists or it does not.
- 272 give the same characters, whitespace aside, as poppler. Of the seven that do not, four differ only in how poppler treats a character (it adds zero-width spaces to three letters and keeps a "ﬁ" ligature that PDF.js writes "fi"); two exhibits differ in runs of mathematical italic letters; one 94-page letter has two control characters where poppler reads "1.". PDF.js normalizes some characters the PDF encodes oddly, and what it reads is what is served.

## Considered Options

- **PDF.js directly (`pdfjs-dist`, Apache-2.0).** The same engine, but it declares `@napi-rs/canvas` as an optional dependency, which npm installs by default: a native module with a platform binary, for a feature (rendering) the service never uses. `.npmrc` cannot be changed to omit optional dependencies, so the package would put a native binary in the lock file and in the licence check. unpdf bundles the engine and lists the same canvas package only as an optional peer, which npm does not install (`npm ls @napi-rs/canvas` is empty).
- **`pdf-parse` 2.4.5 (Apache-2.0).** It depends on `@napi-rs/canvas` outright, for the same reason.
- **`pdf2json` 4.1.0 (Apache-2.0).** Pure JavaScript and no dependencies, but it returns text runs in the order of the file's content stream, not reading order (SB 69's Introduced Version came out in reverse line order), and its plain-text form inserts its own page-break lines. Rebuilding reading order from coordinates would be a text-layout program of our own, and everything it did would be rewriting.
- **`pdftotext` from poppler, as a child process.** The best reader of the four, and the reference above. But it is a system binary (GPL), so the licence check, which reads `npm sbom`, never sees it, and an adopter's own image has to install it. The package that does the same work in npm is preferred.
- **`mupdf` (AGPL-3.0-or-later).** Outside the permitted licences (root `CLAUDE.md`).
- **OCR of the scans.** Out of scope (spec #1): a document with no text layer is flagged and listed in the build report.

## Consequences

- unpdf's `getDocumentProxy` finds PDF.js's standard-font and CJK character-map files only when `pdfjs-dist` is installed beside it, and it is not. None of the 279 fixture files needed them; a PDF whose fonts do would lose those characters without an error.
- The text of two files with the same words but different bytes is the same (SB 69-1's three postings differ only in the PDF's modification date), so the content hash is of the file and not of the text.
- unpdf 2.x was published on 2026-10-28, inside the 14-day window of `.npmrc`; 1.9.0 is the newest version the policy allows. Moving to 2.x is a routine upgrade once it is old enough.
