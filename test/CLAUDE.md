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

- **Fake OLIS.** An in-process `node:http` server on `127.0.0.1:0` replays `test/fixtures/` as the feed stood at the clock time. It reproduces the real feed's quirks: `$inlinecount`, 5,000-row pages with a relative `odata.nextLink`, `/$count` answered only without a JSON `Accept` header, misspelled property names, and decimal keys as strings. Its `$filter` is a conjunction of `eq` and `ge datetime'...'` terms, as the live lookup sends, and anything else is refused. A test changes it after the pull with `behave` (answer, fail with a status, hang, or drop the connection), `amendRows`, `addRows` and `withholdLastRows`, and reads the requests it received with `requests()`. Because it fakes OLIS at the wire, the OLIS client's quirk handling runs in every seam-1 test, which a mocked OLIS adapter would skip.
- **Clock.** One injected `Clock` drives the fake OLIS, the worker and the server. Global fake timers freeze `performance` for the whole worker, so seam-1 tests move the injected clock instead.
- **Time zone.** The Vitest config sets `TZ` to a zone other than Pacific before workers start. Code that quietly relies on local time then fails.
- **Database.** A WAL file in a disposable temp directory, because WAL can't run in memory.
  - Read-only acceptance cases share one database built per file.
  - Cases that change state (increments, removals, revised agendas) build their own.
  - Keep the two kinds in separate files.
- **MCP client.** Drive `createMcpHandler` in-process through `handler.fetch`, once with a 2026-07-28 client and once with a legacy client. Call `listTools()` first so the client validates `structuredContent`. One test runs on a real port for the Node adapter, the `Host` and `Origin` guards, and the mount path.
- **One system.** `startSystem` (`test/support/system.ts`) starts the fake OLIS at a simulated time, runs the ingest worker's full pull into a temp database and builds the MCP handler, wiring the packages through their entry points the way `src/bin/` does. It refuses to run under the Pacific zone, so a lost `TZ` setting fails loudly. Its `legislatorAliasesPath` option gives the worker an alias file of its own (`test/support/alias-file.ts` writes one), where the entry script passes the committed one. Its `pullAgain()` runs the full pull again after a test moves the clock or changes the fake (for example `olis.withholdLastRows(1)`, so the pull is refused and the test reads the tools to see the index stayed as it was).
- **Entry scripts.** One test file runs `src/bin/ingest.ts` and `src/bin/server.ts` as child processes against the fake OLIS, because nothing else executes them.
- **Hermetic.** The suite reaches only localhost. A contract test of the OLIS client against live OLIS is run by hand, outside `npm test`.

## Layout

The layout is the deep-module one in `src/packages/README.md`:
- seam 2 in the parser package's own `tests/` folder, next to the parser it tests;
- seam 1 in `test/tools/`, one file per kind of database use: `get-measure.test.ts` shares one read-only database, `get-measure-feed.test.ts` builds its own for each case, and the real-port and entry-script tests are files of their own; the live status has `get-measure-live.test.ts` (the fixture as it stands, one pull for each describe), `get-measure-live-feed.test.ts` (what OLIS says after the pull changes, one system for each case) and `get-measure-live-requests.test.ts` (what the lookup asks OLIS);
- the shared harness (fake OLIS, clock, MCP client) in `test/support/`;
- fixtures in `test/fixtures/`.

Seam 1 and the harness span packages, so they live at the top. Every test imports packages only through their entry points, and dependency-cruiser checks both `src` and `test` for it.

## Speed and property tests

`npm test` should finish in under a minute, so it runs before every commit. The evaluation run against a full local build (#23) has its own script and never runs in `npm test`.

fast-check (`@fast-check/vitest`) covers invariants that tables can't enumerate:
- an expanded ORS range stays inside the snapshot's section list, sorted, with both ends present;
- a parser never throws on arbitrary text.

The real-text tables stay the oracle. A generator built from the parser's own grammar would be a tautology.
