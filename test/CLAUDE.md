# Tests

`/tdd` has the loop and what a good test is. This file has what spec #1 already decided for this repo, and how the harness works.

## The agreed seams

Spec #1 agreed two seams. Test at these; propose any other seam before writing a test at it.

- **Seam 1: the MCP tools as a black box.** A test starts the fake OLIS at a clock time, runs the ingest worker, and calls tools through an MCP client. It then moves the clock, runs an increment, and calls them again. It asserts what an agent would see.
- **Seam 2: parser tables.** Extracted document text goes in; Statute Links or Agency Links come out. There is one row per wording variant (`test.for`), and each row quotes a real document and names it.

Seam-1 tests read state back through the tools, never through tables, SQL or internal types, so storage and ranking can change without touching a test. Seam-2 tests call a parser package's entry point directly: that entry point is the seam.

## Expected values

Expected values are literals from an independent source:

- the spec's worked examples, such as HB 3131's 42 Testimony rows (41 support, 1 oppose), or SB 69-2, adopted by SLB on 2025-01-30;
- the Statutes Affected Table;
- the document itself.

## The harness

- **Fake OLIS.** An in-process `node:http` server on `127.0.0.1:0` replays `test/fixtures/` as the feed stood at the clock time. It reproduces the real feed's quirks: `$inlinecount`, 5,000-row pages with a relative `odata.nextLink`, `/$count` answered only without a JSON `Accept` header, misspelled property names, and decimal keys as strings. Because it fakes OLIS at the wire, the OLIS client's quirk handling runs in every seam-1 test, which a mocked OLIS adapter would skip.
  - **Documents.** The feed is always served whole, rows that link documents included. With `documents: true` it also serves the documents themselves, at the paths of the manifest's `source_url`s (`/liz/2025R1/Downloads/...`) on the same port. The worker is pointed at them with `OLIS_DOCUMENT_ORIGIN` (`olis.origin`), so no test reaches the real OLIS: every test that runs the worker sets it, whether or not the files are served (the entry-script test builds the worker's environment in one helper). The files are off by default, because pulling the fixture's 278 documents takes about four seconds and a test of `get_measure` reads none; the fake then answers each document request 404, and the worker lists the document as not fetched.
  - **Counts and failures.** `olis.documentRequests()` lists every document request, so a test reads how often a file was fetched from the harness and never from the database. `documentFailures` makes a chosen document hang past the worker's timeout, or answer a status, before it is served; `strayRows` and `strayDocuments` add a row the fixture lacks, with a fixture file served for it.
- **Clock.** One injected `Clock` drives the fake OLIS, the worker and the server. Global fake timers freeze `performance` for the whole worker, so seam-1 tests move the injected clock instead.
- **Time zone.** The Vitest config sets `TZ` to a zone other than Pacific before workers start. Code that quietly relies on local time then fails.
- **Database.** A WAL file in a disposable temp directory, because WAL can't run in memory.
  - Read-only acceptance cases share one database built per file.
  - Cases that change state (increments, removals, revised agendas) build their own.
  - Keep the two kinds in separate files.
- **MCP client.** Drive `createMcpHandler` in-process through `handler.fetch`, once with a 2026-07-28 client and once with a legacy client. Call `listTools()` first so the client validates `structuredContent`. One test runs on a real port for the Node adapter, the `Host` and `Origin` guards, and the mount path.
- **One system.** `startSystem` (`test/support/system.ts`) starts the fake OLIS at a simulated time, runs the ingest worker's full pull into a temp database and builds the MCP handler, wiring the packages through their entry points the way `src/bin/` does. It refuses to run under the Pacific zone, so a lost `TZ` setting fails loudly. Its `documents` option turns the documents on (default off), `documentTimeoutMs` shortens the worker's wait for a hung document, and the worker never pauses between attempts. `buildReport()` reads the `build-report.json` the worker wrote beside the database. Its `pullAgain()` runs the full pull again after a test moves the clock or changes the fake (for example `olis.withholdLastRows(1)`, so the pull is refused and the test reads the tools to see the index stayed as it was).
- **The snapshot.** `startSystem` gives the worker the committed snapshot fixture (`test/fixtures/oregonai-snapshot/`, ticket #10) as `SNAPSHOT_PATH`; its `snapshot` option gives another path. A test that needs a snapshot with a version of its own writes a made-up one (`test/support/made-up-snapshot.ts`) and says so.
- **Entry scripts.** One test file runs `src/bin/ingest.ts` and `src/bin/server.ts` as child processes against the fake OLIS, because nothing else executes them.
- **Hermetic.** The suite reaches only localhost. A contract test of the OLIS client against live OLIS is run by hand, outside `npm test`.

## Layout

The layout is the deep-module one in `src/packages/README.md`:

- seam 2 in the parser package's own `tests/` folder, next to the parser it tests;
- seam 1 in `test/tools/`, one file per kind of database use: `get-measure.test.ts` shares one read-only database, `get-measure-feed.test.ts` builds its own for each case, `get-document.test.ts` shares one database of the whole fixture and `get-document-pull.test.ts` builds its own for each case (fetch counts, failures, rows the fixture lacks), `meetings.test.ts` shares one database at the clock of spec #1's case (c), `meetings-past.test.ts` one at a clock after the whole fixture exists, and `meetings-pull.test.ts` builds its own for each case (another clock, a clock moved after the pull, a failed fetch, a made-up row), `get-measure-analysis.test.ts` shares one database of the whole fixture for the digest and the analysis documents and `get-measure-analysis-labels.test.ts` builds its own for the feed labels the fixture lacks (made-up rows) and `get-measure-analysis-pull.test.ts` builds its own for each case of an analysis document or a Version the worker could not fetch, and the real-port and entry-script tests are files of their own;
- the shared harness (fake OLIS, clock, MCP client, snapshot) in `test/support/`;
- fixtures in `test/fixtures/`.

Seam 1 and the harness span packages, so they live at the top. Every test imports packages only through their entry points, and dependency-cruiser checks both `src` and `test` for it.

## Speed and property tests

`npm test` should finish in under a minute, so it runs before every commit. The evaluation run against a full local build (#23) has its own script and never runs in `npm test`.

fast-check (`@fast-check/vitest`) covers invariants that tables can't enumerate:

- an expanded ORS range stays inside the snapshot's section list, sorted, with both ends present;
- a parser never throws on arbitrary text.

The real-text tables stay the oracle. A generator built from the parser's own grammar would be a tautology.
