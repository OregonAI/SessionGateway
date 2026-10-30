# Testing, TDD and CI quality gates for SessionGateway

Researched 2026-10-29. Package versions are npm `latest` on 2026-10-29 unless another date is given.

> **What was decided (2026-10-29).** The test conventions in `test/CLAUDE.md` follow §8, with three changes. Lint is ESLint with typescript-eslint on the TypeScript team's TypeScript 6 alias, not oxlint (ADR-0008). That alias also fixes the dependency-cruiser finding in §1.1: with `typescript` resolving to 6.0.3, dependency-cruiser 18.7.0 cruised 3 modules and caught a planted deep import, with no swc parser. CI runs Node 26, not Node 24, because Node 26 became LTS on 2026-10-28 (ADR-0008). The husky pre-commit hook is not adopted; CI's `npm run check` is the gate.

Labels used below:
- **verified**: I read the fact at the cited URL, file or command output.
- **inferred**: my reading or arithmetic on verified evidence, not stated by the source.
- **local measurement**: I ran it on this machine (Node v24.19.0, npm 11.17.0, WSL2). The bench is `<scratch>/b-bench`, with raw output in `b-bench/results/` (see the appendix). Nothing was installed in, or written to, the SessionGateway repo.

Sources read from shallow clones (read only, under `<scratch>/b-src/repos`): `modelcontextprotocol/typescript-sdk` `main` at 39ae8e6 (2026-10-27) and `v1.x` at 3b73021 (2026-10-23); `modelcontextprotocol/modelcontextprotocol` (the spec) at 84d8457 (2026-10-29); `vitest-dev/vitest` `docs/` at 54a2bdb (2026-10-29). They are cited below as `sdk@main:path`, `sdk@v1.x:path`, `spec:path` and `vitest:docs/path`. Each path also resolves under `https://github.com/<owner>/<repo>/blob/<branch>/`.

Scope: facts and trade-offs for the test runner, TDD sources, test doubles, property-based and mutation testing, the MCP TypeScript SDK and spec, and CI gates. Unlike the sibling research files, §8 picks one option per choice, as the brief asked.

---

## 0. What the spec and tickets already fix

These come from the spec and tickets and need no further research. Everything below is measured against them.

| Fixed by the spec or a ticket | Source |
|---|---|
| A good test calls the MCP tools and checks what an agent would see. It never asserts on tables, SQL or internal types. | spec #1, "Testing Decisions" (`gh issue view 1 --repo OregonAI/SessionGateway`) |
| Seam 1: the tools as a black box, with a fake OLIS replaying the cached 2025R1 feed at a simulated time (rows with `CreatedDate` up to it, plus their documents), a clock, and the OregonAI snapshot as a fixture. A test runs the ingest worker, calls tools, moves the clock, runs an increment, and calls again. | spec #1, "Testing Decisions" |
| Seam 2: table-driven cases, extracted text in, Statute Links and Agency Links out. | spec #1, "Testing Decisions" |
| Tool errors are reported as MCP errors (`isError`), not as normal results. | spec #1, "MCP tool contract" |
| The server speaks stateless Streamable HTTP, is public and has no login. | spec #1, "Sessions, deployment and data" |
| A committed fixture holds feed rows in the feed's own JSON shape, the linked documents, and a manifest with `source_url`, retrieval time and sha256. A CI check confirms referential consistency, and a note records how to regenerate it. | ticket #3 |
| The tracer bullet sets up the TypeScript project and CI. CI runs the tests on every PR. An unknown Measure returns `isError`. | ticket #4 |
| The evaluation runner reports (a)–(f) as pass or fail with reasons, in CI against the fixture and by command against any built database. | ticket #23 |
| One PR per ticket off `main`. The repo squash-merges, so tickets never stack. | tickets #3, #4, #23 "Delivery" |

---

## 1. What mattpocock-skills 1.3.1 already prescribes

The project's agents load these skills, so the project docs can point at them instead of restating them. Paths are under `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/skills/`. All rows are **verified** (file read).

| Skill | What it prescribes | Where |
|---|---|---|
| `tdd` | Tests verify behaviour through public interfaces: "Code can change entirely; tests shouldn't." | `engineering/tdd/SKILL.md:14` |
| `tdd` | "Test only at pre-agreed seams." Seams are written down and confirmed before any test is written. | `SKILL.md:22-24` |
| `tdd` | Three anti-patterns: implementation-coupled tests (including "querying the database instead of using the interface"); tautological tests, where expected values must come from "an independent source of truth: a known-good literal, a worked example, the spec"; and horizontal slicing (all tests first). | `SKILL.md:30-32` |
| `tdd` | Loop rules: red before green; one seam, one test and one minimal implementation per cycle; "Refactoring is not part of the loop", because it belongs to the `code-review` stage. | `SKILL.md:36-38` |
| `tdd/tests.md` | Integration-style tests through real interfaces. Red flags: mocking internal collaborators, asserting call counts or order, verifying "through external means instead of interface". "One logical assertion per test". | `tests.md:5-61` |
| `tdd/mocking.md` | Mock only at system boundaries: external APIs, databases ("sometimes - prefer test DB"), time and randomness, the file system ("sometimes"). Never mock your own modules. Inject dependencies, and prefer SDK-style interfaces over a generic fetcher. | `mocking.md:3-59` |
| `codebase-design` | Deep modules; "The interface is the test surface"; "One adapter means a hypothetical seam. Two adapters means a real one." | `engineering/codebase-design/SKILL.md:62-65` |
| `codebase-design/DEEPENING.md` | Four dependency categories: in-process; local-substitutable (a test stand-in runs in the suite); remote but owned (a port with an in-memory adapter); true external (an injected port with a mock adapter). "Replace, don't layer": delete shallow tests once interface tests exist. | `DEEPENING.md:9-37` |
| `implement` | Use `tdd` at pre-agreed seams. Typecheck regularly, run single test files regularly and the full suite once at the end. Then run `code-review` and commit to the current branch. | `engineering/implement/SKILL.md:11-17` |
| `setup-ts-deep-modules` (in `in-progress/`, user-invoked) | Uses dependency-cruiser. Each `src/packages/<name>/` exposes its root files as entry points, with `lib/` and `tests/` private. Four `error` rules: entry-point boundary, intra-package freedom, tests only through entry points ("Integration tests across packages are fine; deep imports are not"), and no cycles. A `lint:boundaries` script folds into the typecheck command. Done only after observing pass, fail, pass on a deliberate deep import. | `in-progress/setup-ts-deep-modules/SKILL.md:26-31, 59-87` |
| `setup-pre-commit` | Husky with lint-staged running `prettier --ignore-unknown --write` on staged files. `.husky/pre-commit` runs `npx lint-staged`, then `npm run typecheck` and `npm run test`. It adds a Prettier config if one is missing. | `misc/setup-pre-commit/SKILL.md:10-13, 39-71` |

### 1.1 Where the skills and the spec or the primary sources diverge

All **inferred** from the rows above and the spec.

1. **The fake OLIS sits at the wire, not at a port.** `DEEPENING.md:23-25` says true externals get "an injected port; tests provide a mock adapter". The spec instead fakes OLIS as a server, so the OLIS client's quirk handling (`$inlinecount`, relative `nextLink`, `/$count` Accept rules, percent-encoding) runs in every seam-1 test. That is a fake in Fowler's and the SWE book's sense (§3), not a mock adapter. The project docs should say so, so that agents don't add an `OlisPort` mock.
2. **Shared test support has no home under `setup-ts-deep-modules`.** Its rules let a package's `tests/` import only that package's own `tests/` fixtures (`dependency-cruiser.config.cjs:50-59`). The fake OLIS, the fixture loader and the seam-1 harness serve every package and the evaluation runner, so they must be a package of their own (reachable through an entry point) or live in a top-level `test/` tree. The skill is also still in `in-progress/`.
3. **dependency-cruiser cruises nothing under TypeScript 7.** With only `typescript@7.0.2` installed, `depcruise src` printed "✔ no dependency violations found (0 modules, 0 dependencies cruised)" and warned `missing-typescript-transpiler` (supported: "typescript: >=2.0.0 <7.0.0", "swc: >=1.0.0 <2.0.0"). With `@swc/core` 1.16.20 and `parser: "swc"`, the same tree reported the deliberate violation (**local measurement**, `results/depcruise-ts7-only.txt`, `results/depcruise-swc.txt`). The skill's pass-fail-pass step would catch this, but only if it is run.
4. **Refactoring.** Beck's Canon TDD makes step 4 "Optionally refactor" part of the loop (§3.1). The `tdd` skill moves it out of the loop into code review. That diverges from Beck, not from the spec. Agents follow the skill.
5. **One logical assertion per test, against contract checks.** The spec's contract checks say "every result carries `source_url`, the 'as of' time and the non-official notice". That fits if each contract is one logical assertion. `expect.soft` (§2.1) can report every missing field in one run.
6. **The pre-commit hook runs the full suite.** That is fine while `npm test` stays fast. The evaluation runner against a full local build (#23) must therefore sit outside the `test` script.
7. **No conflict on the database.** `mocking.md` says "prefer test DB", and the spec uses the real SQLite file. Both forbid verifying through SQL.

---

## 2. Test runner

### 2.1 Vitest

| Fact | Status | Source |
|---|---|---|
| `vitest` 5.0.5 is `latest` (MIT, published 2026-10-15). Other dist-tags: `V4` 4.1.12 (also 2026-10-15), `beta` 5.1.0-beta.1. `@vitest/coverage-v8` 5.0.5 peers exactly on `vitest` 5.0.5. | verified | `npm view vitest`, `npm view @vitest/coverage-v8 peerDependencies` |
| 5.0 was released 2026-09-03. It "requires Vite >= 6.4.0 and Node.js >= 22.12.0". Engines: `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`. `vite` is a non-optional peer (8.3.5 is current). | verified | `vitest:docs/blog/vitest-5.md`; `npm view vitest@5.0.5 engines peerDependencies`; `npm view vite version` |
| v5 changes that matter here: `clearMocks` defaults to `true`; unawaited `resolves`/`rejects` now fail the test; `expect.poll` rejects on timeout; fake timers and `setSystemTime` also mock `Temporal`; `test.sequential` is removed (use `{ concurrent: false }`); inline projects inherit the root config and share its Vite server; `--repeats`; reports go to `.vitest/`; `vi.when`; `vitest doctor`. | verified | `vitest:docs/blog/vitest-5.md`; `vitest:docs/guide/migration/index.md` |
| v4 (2025-10-22) changes still in force: V8 coverage uses AST-based remapping, "as accurate as `@vitest/coverage-istanbul`"; `coverage.all` is removed, so only loaded files are reported unless `coverage.include` is set; `workspace` became `projects`; the pool rewrite replaced `maxThreads`/`maxForks` with `maxWorkers` and removed `poolOptions`; `vite-node` was replaced by Vite's module runner. | verified | https://raw.githubusercontent.com/vitest-dev/vitest/v4.0.0/docs/guide/migration.md |
| 4.1 added test tags, an `agent` reporter that "only displays failed tests and their errors" (enabled automatically inside AI coding agents), a GitHub Actions job summary, and `retry: { count, delay, condition }`. | verified | `vitest:docs/blog/vitest-4-1.md` |
| **Fake timers.** `vi.useFakeTimers()` fakes "everything available globally except `nextTick` and `queueMicrotask`": timers, `Date`, `hrtime`, `performance`, `Intl` and `Temporal`. Timer APIs imported from `node:timers` are faked only with `fakeTimers.fakeNodeBuiltins` (new in 5.0, default `false`). Mocking `nextTick` hangs under `pool: 'forks'`. | verified | `vitest:docs/config/faketimers.md`; `vitest:docs/api/vi.md` (`vi.useFakeTimers`) |
| `vi.setSystemTime(date)`: with fake timers it simulates a clock change without firing timers. Without fake timers it mocks "only `Date.*` and `Temporal.Now.*` calls". | verified | `vitest:docs/api/vi.md` (`vi.setSystemTime`) |
| Under `vi.useFakeTimers()`, a real MCP connect over TCP to an ephemeral-port server still completed, and `performance.now()` read 0.0 ms across it, because `performance` was faked. | local measurement | `b-bench/test/seam.test.ts`, `results/vitest-run.txt` |
| `Temporal` is native "Node.js >= 26 by default, behind `--harmony-temporal` on older versions". | verified | `vitest:docs/config/faketimers.md` |
| Setting `process.env.TZ` inside a test has no effect on `Date` in `threads`/`vmThreads` pools. Set it "before workers start" (shell, config file or `globalSetup`). | verified | `vitest:docs/guide/common-errors.md` ("Time Zone Does Not Change in Worker Threads") |
| **Table-driven tests.** `test.each` uses printf placeholders (`%s`, `%j`, `%#` 0-based index, `%$` 1-based). `test.for` doesn't spread array rows and gets the `TestContext`. `describe.each` and `describe.for` exist. | verified | `vitest:docs/api/test.md` (`test.each`, `test.for`); `vitest:docs/api/describe.md` |
| `expect.soft` keeps running after a failed assertion and fails the test at the end. It works only inside `test`. | verified | `vitest:docs/api/expect.md` (`soft`) |
| **Fixtures.** `test.extend` fixtures take `scope: 'test' \| 'file' \| 'worker'` (since 3.2) and an `onCleanup` callback. | verified | `vitest:docs/guide/test-context.md` ("Fixture Scopes") |
| **Projects.** `test.projects` defines named projects, filtered with `--project`/`-p`. `sequence.groupOrder` orders project groups. | verified | `vitest:docs/guide/projects.md`; `vitest:docs/config/sequence.md` |
| **Coverage.** `coverage.provider` defaults to `'v8'`. `coverage.include` defaults to "Files that were imported during test run". `coverage.thresholds` takes `lines`/`functions`/`branches`/`statements`, where a negative value means "maximum number of uncovered items". Also `perFile`, `autoUpdate`, `100`, and per-glob thresholds (globbed files still count toward the global thresholds). | verified | `vitest:docs/config/coverage.md` |
| **`--typecheck`** is marked experimental. It runs `tsc` over `*.test-d.ts` files and also reports source errors. | verified | `vitest:docs/config/typecheck.md`; `vitest:docs/guide/testing-types.md` |
| `vitest --typecheck.only` with `typescript@7.0.2` parsed TS 7 `tsc` output correctly: it reported real source errors, then "no errors" once they were fixed. | local measurement | `results/vitest-typecheck-ts7.txt` |
| **Defaults.** `pool: 'forks'`, `isolate: true`, `fileParallelism: true`, `maxWorkers` = all available parallelism (half in watch mode). Tests inside a file run sequentially unless `sequence.concurrent` or `describe.concurrent` is set. | verified | `vitest:docs/config/{pool,isolate,fileparallelism,maxworkers,sequence}.md` |
| **Flaky-test controls.** `retry` (number or `{count, delay, condition}`); `sequence.shuffle` (`{files, tests}`, default `false`) with `sequence.seed` (default `Date.now()`); `repeats` (5.0) "regardless of the result". | verified | `vitest:docs/config/{retry,sequence,repeats}.md` |
| Vitest's own docs recommend Mock Service Worker for mocking requests. | verified | `vitest:docs/guide/mocking/requests.md` |
| The MCP SDK repo itself tests with Vitest (`vitest: ^4.0.15` in its catalog). | verified | `sdk@main:pnpm-workspace.yaml` |
| 22 tests (SDK v2 in-process and ephemeral-port, plus fast-check) ran in 337–357 ms wall on Vitest 5.0.5. | local measurement | `results/vitest-run.txt` |

### 2.2 Node's built-in `node:test` (v24 docs)

| Fact | Status | Source |
|---|---|---|
| The module is "Stability: 2 - Stable". | verified | https://nodejs.org/docs/latest-v24.x/api/test.md (line 15) |
| Each test file runs in its own child process by default (`--test-isolation=process`). `--test-concurrency` defaults to `os.availableParallelism() - 1`. Tests within a file run "within a single application thread". | verified | same page, "Test runner execution model"; https://nodejs.org/docs/latest-v24.x/api/cli.md (`--test-concurrency`, `--test-isolation`) |
| `MockTimers` became stable in v23.1.0 and can mock `Date`. Destructured imports such as `import { setTimeout } from 'node:timers'` are "currently not supported". | verified | test.md, "Class: MockTimers" and "Timers" |
| Coverage (`--experimental-test-coverage`) is "Stability: 1 - Experimental". So are the thresholds `--test-coverage-lines`/`-branches`/`-functions` (v22.8.0). An `lcov` reporter exists. | verified | test.md, "Collecting code coverage"; cli.md |
| Snapshot testing has not been experimental since v23.4.0. | verified | test.md, "Snapshot testing" |
| These are "1.0 - Early development": randomized order (v24.16.0), test tags (v24.19.0), global setup/teardown (v24.0.0) and `mock.module`. Watch mode is "1 - Experimental". | verified | test.md stability markers |
| `test()` options are `concurrency`, `expectFailure`, `only`, `signal`, `skip`, `tags`, `todo`, `timeout` and `plan`. There is no per-test retry. `--test-rerun-failures` persists run state so that failures can be rerun. | verified | test.md, "`test([name][, options][, fn])`", "Rerunning failed tests" |
| TypeScript type stripping has been stable since v24.12.0. It covers erasable syntax only, does no type checking, ignores `tsconfig.json` (so no `paths`), and requires file extensions in imports. | verified | https://nodejs.org/docs/latest-v24.x/api/typescript.md |
| The v24 test runner docs have no `expect.soft` equivalent, no table helper, no projects and no type tests. | verified (absent from the page's headings) | test.md headings |

### 2.3 Fit for this service

| Need from the spec | Vitest 5 | `node:test` (Node 24) |
|---|---|---|
| Seam-2 tables | `test.for` / `test.each` with readable titles | a loop around `test()` |
| Per-file built database reused by read-only cases | `test.extend` with `scope: 'file'` and `onCleanup` | `before`/`after` hooks |
| Separate seam-2, seam-1 and evaluation runs | `projects` with `-p` | separate globs or scripts |
| Coverage gate | stable thresholds, globals and per-glob | thresholds are experimental |
| Property-based integration | `@fast-check/vitest` 0.5.0 (peer `vitest ^4.1.0 \|\| ^5.0.0`) | plain `fast-check` |
| Mutation runner | `@stryker-mutator/vitest-runner` 10.1.1 | not checked |
| Dependencies | about 67 packages for SDK v2 + Vitest + fast-check (local `npm install`) | none |

**Inferred verdict:** Vitest fits better. Its stable coverage thresholds, file-scoped fixtures, projects, `test.for` and the PBT and mutation integrations each answer a need the spec names. `node:test`'s advantage is zero dependencies, and its gaps (experimental coverage, no retry, no projects) land exactly on those needs. Vitest also matches the skills' examples (`test`/`expect`) and the MCP SDK's own test setup.

---

## 3. TDD discipline: primary statements

### 3.1 Kent Beck, "Canon TDD" (2023-12-11), https://tidyfirst.substack.com/p/canon-tdd

**verified**, quoted exactly:
1. "Write a list of the test scenarios you want to cover"
2. "Turn exactly one item on the list into an actual, concrete, runnable test"
3. "Change the code to make the test (& all previous tests) pass (adding items to the list as you discover them)"
4. "Optionally refactor to improve the implementation design"
5. "Until the list is empty, go back to #2"

The mistakes he names:
- "convert all the items on the Test List into concrete tests, then make them pass one at a time"
- "copying actual, computed values & pasting them into the expected values of the test. That defeats double checking, which creates much of the validation value of TDD."
- "mixing refactoring into making the test pass"
- "write tests without assertions just to get code coverage"
- "Duplication is a hint, not a command."

On design, writing the test is where "you'll begin making design decisions, but they are primarily interface decisions."

*Test-Driven Development: By Example* (2002) was **not read** for this file. The post says of the book, "I made it as clear as possible in my book", and restates its workflow.

### 3.2 Martin Fowler

- **TestDouble** (2006-01-17), https://martinfowler.com/bliki/TestDouble.html (**verified**): "Test Double is a generic term for any case where you replace a production object for testing purposes." "Fake objects actually have working implementations, but usually take some shortcut which makes them not suitable for production (an InMemoryTestDatabase is a good example)." "Stubs provide canned answers to calls made during the test". "Mocks are pre-programmed with expectations which form a specification of the calls they are expected to receive."
- **Mocks Aren't Stubs** (2007-01-02), https://martinfowler.com/articles/mocksArentStubs.html (**verified**): "only mocks insist upon behavior verification." "The classical TDD style is to use real objects if possible and a double if it's awkward to use the real thing." "A classic test only cares about the final state - not how that state was derived. Mockist tests are thus more coupled to the implementation of a method."
- **UnitTest** (2014-05-05, revised 2017-03-09), https://martinfowler.com/bliki/UnitTest.html (**verified**): "the team decides what makes sense to be a unit". The terms "solitary" and "sociable" are credited to Jay Fields. "mockists insist upon solitary unit tests, while classicists prefer sociable tests." "Even a classic tester like myself uses test doubles when there's an awkward collaboration. They are invaluable to remove non-determinism when talking to remote services." "If talking to the resource is stable and fast enough for you then there's no reason not to do it in your unit tests."

### 3.3 *Software Engineering at Google*, https://abseil.io/resources/swe-book

All **verified**:
- **Ch. 12, Unit Testing** (`/html/ch12.html`). TL;DRs: "Strive for unchanging tests. Test via public APIs. Test state, not interactions. Make your tests complete and concise. Test behaviors, not methods. Structure tests to emphasize behaviors. Name tests after the behavior being tested. Don't put logic in tests. Write clear failure messages. Follow DAMP over DRY when sharing code for tests." Also: "the ideal test is unchanging: after it's written, it never needs to change unless the requirements of the system under test change." Testing via public APIs is footnoted as the "Use the front door first principle." "interaction tests check how a system arrived at its result, whereas usually you should care only what the result is." "A little bit of duplication is OK in tests so long as that duplication makes the test simpler and clearer."
- **Ch. 13, Test Doubles** (`/html/ch13.html`). TL;DRs: "A real implementation should be preferred over a test double. A fake is often the ideal solution if a real implementation can't be used in a test. Overuse of stubbing leads to tests that are unclear and brittle. Interaction testing should be avoided when possible". Also: "A real implementation is preferred if it is fast, deterministic, and has simple dependencies." "a fake should maintain fidelity to the API contracts of the real implementation"; "the fake must have perfect fidelity to the real implementation, but only from the perspective of the test." On "Fakes Should Be Tested": run the same public-interface tests "against both the real implementation and the fake (these are known as contract tests)." On the clock: "Instead of relying on the system clock, a test can use a test double that hardcodes a specific time."
- **Ch. 11, Testing Overview** (`/html/ch11.html`): "All tests should strive to be hermetic: a test should contain all of the information necessary to set up, execute, and tear down its environment … they should not rely on a shared database." Medium tests "can make blocking calls, including network calls, to localhost." On flakiness: "as you approach 1% flakiness, the tests begin to lose value", and "rerunning a test is only delaying the need to address the root cause of flakiness." On coverage: "instead of treating 80% like a floor, engineers treat it like a ceiling", and "We recommend only measuring coverage from small tests to avoid coverage inflation that occurs when executing larger tests."
- **Ch. 14, Larger Testing** (`/html/ch14.html`). Record/replay: "use a larger test to generate a smaller one by recording the traffic to those external services when running the larger test and replaying it when running smaller tests", and "it is important to make running Record tests easy, fast, and stable." "Seeded data" is "Data preinitialized into the system under test reflecting the state of the SUT at the inception of the test".

### 3.4 How they map onto the spec (inferred)

- Seam 1 is the "front door" (the MCP tools). In SWE terms it is a medium-size test (localhost network, temp files) of broad scope. It is "Test via public APIs" and "Test state, not interactions" with the state read back through the tools, never through SQL. The SWE book's own state-testing example queries the database, but the spec's stricter rule matches its front-door principle.
- The fake OLIS is a fake (Fowler; SWE ch. 13) built from recorded traffic (SWE ch. 14 record/replay). Its fidelity obligation is OLIS's contract "from the perspective of the test": paging, `$inlinecount`, `/$count`, verbatim misspellings, string decimals. A contract test of the OLIS client against live OLIS, run by hand and never in CI, is what the SWE book prescribes for keeping a fake honest.
- Seam 2 is a sociable unit test of the parsers. Tables follow DAMP: each row carries its own text and its expected links.
- Expected values must be independent literals: the counts and ids written in the spec (HB 3131: 42 rows, 41 support, 1 oppose; SB 69-2 adopted 2025-01-30). Computing them in the test from the fixture JSON would be the tautology that both Beck and the `tdd` skill reject.

---

## 4. Test doubles in this design

### 4.1 The clock

| Option | Facts | Status |
|---|---|---|
| Injected `Clock` (for example `{ now(): Date }`), passed to the fake OLIS, the worker and the server | Recommended by SWE ch. 13 for clock-dependent code. `mocking.md` puts time at the system boundary and prescribes dependency injection. A system clock plus a simulated clock make two adapters, so by `codebase-design` it is a real seam. | verified (sources); fit inferred |
| `vi.setSystemTime` without fake timers | Mocks only `Date.*` and `Temporal.Now.*`, for the whole worker process. | verified |
| `vi.useFakeTimers()` | Also fakes `performance`, `Intl`, `setTimeout` and the rest. `performance.now()` froze across a real HTTP round trip. Process-global. | verified; local measurement |
| `node:test` `mock.timers` | Stable. Destructured `node:timers` imports are unsupported. | verified |

Why an injected clock fits this design (**inferred**):
- One simulated time drives three components. The fake OLIS filters rows by `CreatedDate`. The worker computes increment windows with the two-hour overlap and the "days the Session meets" rule. The server computes "as of", "since yesterday" and the staleness warning during working hours. A single object passed to all three keeps them in step without global patching.
- The worker's 15-minute schedule is tested by calling the increment directly, so no timer needs faking.
- Global faking would also freeze `performance.now()` timings and make concurrent tests at different simulated times impossible in one worker.
- Pacific-time parsing must not depend on the process time zone. Node 24 has no native `Temporal` (it needs a flag before Node 26, per the Vitest doc above), so time-zone conversion is explicit code. Running the suite under a non-Pacific `TZ`, set before workers start, would catch hidden reliance on local time.

### 4.2 The fake OLIS (an external OData API over HTTP)

| Option | Version and facts | What it intercepts | Status |
|---|---|---|---|
| In-process `node:http` server on `127.0.0.1:0`, with the base URL injected through configuration | Built in. A per-test server started, served and closed in 2–20 ms per test in the MCP bench. | Nothing is intercepted. The OLIS client makes real HTTP requests (encoding, `Accept` headers, timeouts), so the fake also serves a worker in a child process, the evaluation runner and local development. | local measurement (timings); fit inferred |
| `msw` 3.0.3 | 3.0.0 (2026-09-28) is "ESM-only", has a minimum of Node 22, "Supports Node.js v24 and v26" and "TypeScript v6.0 and v7.0", and "no longer patches `setTimeout` to circumvent fake timers". In Node it uses `@mswjs/interceptors`. Vitest's docs recommend it. | Requests made in this process, through `@mswjs/interceptors` (the exact module list was not checked) | verified: `gh api repos/mswjs/msw/releases/tags/v3.0.0`; https://raw.githubusercontent.com/mswjs/msw/main/README.md |
| `undici` `MockAgent` | `undici` 8.12.3 (2026-10-19). Node 24.19.0 bundles undici 7.29.0, and the README's support table lists 8.x as "Bundled in Node.js 26.x". `setGlobalDispatcher()` is "shared among compatible undici modules, including undici that is bundled internally with node.js", mirroring to `Symbol.for('undici.globalDispatcher.1')` "so Node.js built-in `fetch`" uses it. It offers `disableNetConnect()`, `enableNetConnect(matcher)` and `assertNoPendingInterceptors()`. | `fetch` and undici calls only, not `node:http` clients. Process-global unless a dispatcher is passed per call. | verified: `node -p process.versions.undici`; https://raw.githubusercontent.com/nodejs/undici/main/README.md; `docs/docs/api/MockAgent.md` |

**Inferred:** the spec's fake is a server that replays a recorded feed at a simulated time and emulates OData's quirks. A real HTTP server is the most faithful form, needs no global state (so test files stay parallel), and works across processes, which matters if the two-container design is ever exercised in a test. msw and MockAgent intercept per route in-process. That suits stubbing a few endpoints, not emulating a feed's paging and `$filter`.

### 4.3 A SQLite database per test

| Fact | Status | Source |
|---|---|---|
| "the journal_mode for an in-memory database is either MEMORY or OFF and can not be changed". So WAL, which the spec requires, needs a file. | verified | https://sqlite.org/pragma.html#pragma_journal_mode |
| WAL needs every process on one host ("WAL does not work over a network filesystem") and keeps `-wal` and `-shm` files beside the database. | verified | https://sqlite.org/wal.html |
| `fs.mkdtempDisposableSync(prefix)` (added v24.4.0) returns `{ path, remove, [Symbol.dispose] }`. Disposal removes the directory and its contents. | verified | https://nodejs.org/docs/latest-v24.x/api/fs.md |
| A `using` block with `mkdtempDisposableSync` worked in Node 24.19.0: a file database switched to `wal`, `:memory:` stayed `memory`, and the directory was gone afterwards. | local measurement | command in the appendix |

**Inferred:** use a file database in a per-test temporary directory, with `test.extend` fixtures and `onCleanup`. Acceptance cases (a)–(f) only read, so they can share one database built once per file (`scope: 'file'`). Live-behaviour cases (increments, removals, revised agendas) change state, so each gets its own (the default `scope: 'test'`). That keeps tests hermetic in the SWE sense without paying for a full ingest per test.

### 4.4 Committed real-world fixtures

| Fact | Status | Source |
|---|---|---|
| Ticket #3 requires: rows in the feed's own JSON shape, every linked document, a manifest with `source_url`, retrieval time and sha256, a CI consistency check, and a note on regeneration. | verified | ticket #3 |
| GitHub "blocks files larger than 100 MiB", warns above 50 MiB, and recommends repositories "ideally less than 1 GB". | verified | https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github |
| `linguist-generated` in `.gitattributes`: "Excluded from stats, hidden in diffs". | verified | https://github.com/github-linguist/linguist/blob/main/docs/overrides.md |
| One Session is about 132,000 documents and about 14 GB of PDFs, a mean of about 106 KB per document. | verified (spec); mean inferred | spec #1, "Size" |
| A fixture of 200–600 documents would be about 20–65 MB. | inferred, to be measured when #3 lands | arithmetic |

Practice (**inferred** from ticket #3 and SWE ch. 14 record/replay):
- **Layout.** Feed rows per entity set as verbatim JSON, one file per document named by a stable id, and one manifest listing `source_url`, `retrieved_at`, `sha256`, `bytes`, `content_type` and the producing script version.
- **`fixture:build`** reads the gitignored cache plus a committed list of chosen Measures, and writes deterministic output (sorted keys, stable names). Re-running it locally must produce no diff.
- **`fixture:verify`** runs in CI. It recomputes every sha256 against the manifest, rejects unlisted or missing files, and resolves every referenced key inside the fixture.
- Mark the tree `linguist-generated` so PR diffs collapse.
- **Limitation:** CI cannot prove the files weren't hand-edited, because an edit with an updated manifest passes. Only the deterministic local rebuild shows that, which is why the regeneration note matters.

---

## 5. Property-based and mutation testing

### 5.1 fast-check

| Fact | Status | Source |
|---|---|---|
| `fast-check` 4.10.2 (MIT, 2026-09-19). `@fast-check/vitest` 0.5.0 (2026-09-11) peers on `vitest ^4.1.0 \|\| ^5.0.0` and depends on `fast-check ^3 \|\| ^4`. | verified | `npm view` |
| `@fast-check/vitest` has two modes: `test.prop([...arbs])` for full property tests, and a "one-time random mode" (`g(fc.string)`) that is reproducible but has no shrinking. Vitest `beforeEach`/`afterEach` run around every predicate execution. | verified | https://raw.githubusercontent.com/dubzzz/fast-check/main/packages/vitest/README.md |
| "fast-check will sample 100 inputs per test by default". Failures shrink: "fast-check will attempt to make sure this counterexample is as small as possible". A report carries `seed` and `path`, and `{ seed, path }` replays "directly on the reduced counterexample". Generation is "biased by default". | verified | https://fast-check.dev/docs/introduction/what-is-property-based-testing/; https://raw.githubusercontent.com/dubzzz/fast-check/main/packages/fast-check/README.md; `website/docs/tutorials/quick-start/read-test-reports.md` |
| A `test.prop` over a toy range expander ran under Vitest 5.0.5 next to the spec's example-based case. | local measurement | `b-bench/test/range.test.ts` |

Where it pays in seam 2 (**inferred**):
- **ORS range expansion**, with the endpoints drawn from the snapshot's section list. Properties: the output is a subset of the snapshot; it is sorted with no duplicates; both endpoints are present when they exist and are ordered; reversed or unknown endpoints produce no silent partial range. The spec's example "ORS 418.806 to 418.816" stays as a literal case, because it is the bug OregonAI has.
- **Citation and Statute Link parsing.** It never throws on arbitrary text. Every emitted id is either in the snapshot or a chapter id marked not resolvable. The result doesn't change when PDF line breaks or extra whitespace are inserted into a known sentence (a metamorphic property).
- **Risk:** a generator that renders Legislative Counsel's wording from the same grammar the parser uses is a tautology. Keep the real-text tables as the primary oracle and use properties for invariants and robustness.

### 5.2 StrykerJS

| Fact | Status | Source |
|---|---|---|
| `@stryker-mutator/core`, `vitest-runner` and `typescript-checker` are all 10.1.1 (Apache-2.0, 2026-10-23, "a re-release of v10.1.0" over a provenance issue). 10.0.0 came out 2026-08-14. Core needs Node `>=22.0.0`. The Vitest runner peers on `vitest >=2.0.0`. | verified | `npm view`; `gh api repos/stryker-mutator/stryker-js/releases` |
| The Vitest runner forces `coverage: { enabled: false }`, `maxWorkers: 1` and `bail: 1`, because Stryker runs its own parallel workers. `vitest.related` (default `true`) runs only tests related to mutated files. Browser Mode is unsupported. | verified | https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/docs/vitest-runner.md |
| `--incremental` stores results in `reports/stryker-incremental.json` and reuses a result when neither the mutant nor its covering tests changed. "The dry run remains required". It does not detect changes outside mutated and test files. | verified | `docs/incremental.md` |
| Defaults: `coverageAnalysis: perTest`, `concurrency` = cores−1 when there are more than 4 cores, `thresholds { high: 80, low: 60, break: null }`. With `break: null` the build never fails. `mutate` globs select production files. | verified | `docs/configuration.md` |
| GitHub-hosted Linux runners have 4 CPUs and 16 GB for public repositories and 2 CPUs and 8 GB for private ones. SessionGateway is private. | verified | https://docs.github.com/en/actions/reference/runners/github-hosted-runners; `gh repo view OregonAI/SessionGateway --json visibility` |
| The checker plugin needs the TypeScript compiler API. TS 7.0 "does not ship with an API" (§7.1), so the TypeScript checker would need the TS 6 alias. | inferred | `docs/typescript-checker.md` (peer `typescript >=3.6`); TS 7 announcement |
| CI cost was **not measured**. It scales with mutants × covering tests. With `mutate` limited to the parser modules, each mutant runs only seam-2 tables (milliseconds). Mutating seam-1 code would rerun ingest-plus-MCP tests per mutant. | inferred | arithmetic |

---

## 6. MCP TypeScript SDK and spec

### 6.1 SDK versions and status on 2026-10-29

| Fact | Status | Source |
|---|---|---|
| **v2 is the stable line.** "This is the `main` branch: v2 of the SDK (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`), the stable release line, implementing the 2026-07-28 MCP spec." | verified | `sdk@main:README.md` |
| `@modelcontextprotocol/server`, `client` and `core` are 2.4.0 (Apache-2.0, 2026-10-23). 2.0.0 was released 2026-07-27, followed by 2.1.0 (09-23), 2.2.0 (09-28), 2.3.0 (10-02), 2.3.1 (10-05) and 2.4.0 (10-23). `@modelcontextprotocol/node` is 2.1.2. `@modelcontextprotocol/inspector` is 2.13.0 (2026-10-28). | verified | `npm view … time` |
| v2 is nine packages. `core`, `client`, `server`, `server-legacy` and `codemod` form "a fixed group and always release together". `node`, `express`, `hono` and `fastify` are "thin layers over `createMcpHandler`". Semver applies, and dropping a negotiated protocol revision counts as breaking. | verified | `sdk@main:docs/get-started/packages.md`; `sdk@main:VERSIONING.md` |
| v2 requires Node.js 20+ and ships ESM and CJS. `server` depends on `zod ^4.2.0`, and "Zod v3 is no longer supported". Raw-shape `inputSchema` (the spike's `inputSchema: { id: z.string() }`) is accepted only through `@deprecated` overloads. Wrap schemas in `z.object()`. | verified | `sdk@main:skills/mcp-typescript-sdk-upgrade-to-v2/references/packaging-runtime.md`, `…/server-registration.md`; `npm view @modelcontextprotocol/server@2.4.0 dependencies` |
| **v1** `@modelcontextprotocol/sdk` 1.32.2 (MIT, 2026-10-23) is "the maintenance line. It implements the MCP spec up to 2025-11-25. Support for the 2026-07-28 spec is not planned for v1.x". It gets "bug fixes and security updates for at least six months after the v2 release (2026-07-27)". | verified | `sdk@v1.x:README.md` |
| Six months from 2026-07-27 is 2027-01-27, near the start of 2027R1, the first Live Session. | inferred | arithmetic; spec #1 |
| 2.3.0 changed behaviour: "A `Server` or `McpServer` now serves one connection at a time". `createMcpHandler(buildServer)`, where the factory returns a new server per call, keeps working. A server built once outside the handler fails from the second request. The spike's per-request pattern was already safe. | verified | `sdk@main:packages/server/CHANGELOG.md` (2.3.0) |

### 6.2 The spec revision

| Fact | Status | Source |
|---|---|---|
| The current revision is **2026-07-28**. `https://modelcontextprotocol.io/specification/latest` answers 307 to `/specification/2026-07-28`, and the docs nav lists "Version 2026-07-28 (latest)". | verified | `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}'`; `spec:docs/docs.json` |
| Major changes from 2025-11-25: no protocol sessions and no `Mcp-Session-Id`; no `initialize` handshake, with protocol version and capabilities carried in each request's `_meta`; `server/discover` is required; `subscriptions/listen` replaces GET and resource subscribe; `ping` and `logging/setLevel` are removed; results carry a required `resultType`; SSE resumability is removed. Minor changes: `tools/list` "SHOULD" be deterministically ordered, and list results carry `ttlMs` and `cacheScope`. | verified | `spec:docs/specification/2026-07-28/changelog.mdx` |
| **Errors.** Protocol errors (unknown tool, malformed requests, server errors) "are returned as standard JSON-RPC errors". Tool execution errors (API failures, input validation, business logic) "are reported in tool results with `isError: true`". Clients "SHOULD provide tool execution errors to language models". | verified | `spec:docs/specification/2026-07-28/server/tools.mdx` ("Error Handling") |
| **Structured output.** If `outputSchema` is given, "Servers MUST provide structured results that conform to this schema" and "Clients SHOULD validate". A tool that returns structured content "SHOULD also return the serialized JSON in a TextContent block". | verified | same file ("Structured Content", "Output Schema") |
| **Annotations** are hints with these defaults: `readOnlyHint` false, `destructiveHint` true and `idempotentHint` false (both meaningful only when not read-only), `openWorldHint` true. "Clients MUST consider tool annotations to be untrusted unless they come from trusted servers." | verified | `spec:schema/2026-07-28/schema.ts` (`ToolAnnotations`); tools.mdx |
| **Transport security.** "Servers MUST validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks". A present but invalid `Origin` gets 403. Local servers "SHOULD bind only to localhost". Servers "SHOULD implement proper authentication". | verified | `spec:docs/specification/2026-07-28/basic/transports/streamable-http.mdx` ("Security & Endpoint") |
| Servers "MUST: Validate all tool inputs; Implement proper access controls; Rate limit tool invocations; Sanitize tool outputs". | verified | tools.mdx ("Security Considerations") |

### 6.3 Server features in v2, against this spec's needs

| Need | v2 API and behaviour | Status | Source |
|---|---|---|---|
| Register a tool with input and output schemas | `server.registerTool(name, { title, description, inputSchema: z.object(…), outputSchema, annotations }, handler)`. One zod schema produces the advertised JSON Schema, argument validation and handler types. | verified | `sdk@main:docs/servers/tools.md` |
| Bad arguments | Rejected before the handler as an `isError: true` result: "Input validation error: …". | verified; local measurement | tools.md; `results/vitest-run.txt` |
| Structured results | The SDK validates `structuredContent` against `outputSchema` before sending, and skips validation on `isError` results. A violation came back as `isError: true` "Output validation error: Invalid structured content …" in both eras. | verified; local measurement | tools.md; `docs/servers/errors.md`; bench |
| Client-side validation | "When an earlier `listTools()` gave the client the tool's `outputSchema`, `callTool` validates `structuredContent` against it". | verified | `sdk@main:docs/clients/calling.md` |
| Unknown Measure (business error) | Return `{ isError: true, content: [...] }`, or throw: "the SDK catches anything a tool handler throws and converts it to the same `isError: true` shape". Every exception becomes a tool error, including a thrown `ProtocolError`, except `UrlElicitationRequiredError`. | verified | `sdk@main:docs/servers/errors.md` |
| Unknown tool | Came back as a thrown JSON-RPC error with code -32602, in both eras, matching the spec's example. | local measurement | bench |
| Stateless Streamable HTTP | `createMcpHandler(factory)` builds a fresh server per request and holds nothing between requests. By default (`legacy: 'stateless'`) it also serves 2025-era clients per request. Legacy `GET`/`DELETE` get 405, and the bench saw `Allow: POST`. `responseMode: 'json'` pins single JSON responses. | verified; local measurement | `sdk@main:docs/serving/http.md`, `docs/serving/legacy-clients.md`; bench |
| `sessionIdGenerator: undefined` | Still the stateless switch on the hand-wired 2025-era `NodeStreamableHTTPServerTransport`. The 2026-07-28 revision "is per-request and has no `Mcp-Session-Id`". | verified | `sdk@main:docs/serving/sessions-state-scaling.md` |
| Host and Origin checks | "The handler trusts its caller: it validates no `Host` header, no `Origin` header, and no token." On plain `node:http`, put `hostHeaderValidation(list)`/`originValidation(list)` (or the `localhost*` variants) from `@modelcontextprotocol/node` in front of `toNodeHandler(handler)`. The transport options `allowedHosts`, `allowedOrigins` and `enableDnsRebindingProtection` are `@deprecated` in v2 ("Use external middleware"). A foreign `Host` and a foreign `Origin` each got 403 in the bench. | verified; local measurement | http.md; `sdk@main:packages/server/src/server/streamableHttp.ts:128-147`; `packages/middleware/node/src/middleware/*.ts`; bench |
| Request size limits | Transport `maxRequestBodySize` defaults to 4 MiB. `maxToolInputElements` is off by default. | verified | tools.md |

On annotations for the eight tools (**inferred**): all are `readOnlyHint: true`. `openWorldHint` is `false` for tools that read only the local copy. `get_measure` reads OLIS live, which arguably makes it `true`. Clients treat annotations as untrusted hints either way.

### 6.4 Testing a server end to end in-process

| Fact | Status | Source |
|---|---|---|
| The SDK's own guide: "Drive your server through a real `Client`, in-process — no port, no socket, no mock transport." Pass `handler.fetch` as `StreamableHTTPClientTransport`'s `fetch` option. "One `Client` plus one `createMcpHandler` is a complete no-socket integration test of the server you deploy." Teardown: close the client, then the handler. | verified | `sdk@main:docs/testing.md` |
| "`createLinkedPair` connects 2025-era instances only; `handler.fetch` is the in-process entry for 2026-07-28 coverage". Stdio needs a spawned process. | verified | same |
| A client is `legacy` by default. `versionNegotiation: { mode: 'auto' }` probes with `server/discover` and falls back. `{ pin: '2026-07-28' }` never falls back. `getProtocolEra()` reports the result. | verified | `sdk@main:docs/protocol-versions.md` |
| The bench drove `createMcpHandler` through `handler.fetch` with a modern client (`mode: 'auto'`, which reported `modern`) and a default client (`legacy`). It covered structured results, `isError` on an unknown Measure and on bad arguments, the unknown tool, output-schema violations and annotations in `tools/list`. It also ran `InMemoryTransport.createLinkedPair()` and one real ephemeral-port path (`toNodeHandler` with Host and Origin guards). All passed, at 1–36 ms per test. | local measurement | `results/vitest-run.txt` |

### 6.5 MCP Inspector and conformance

| Fact | Status | Source |
|---|---|---|
| Inspector 2.13.0: web UI, CLI (`--cli`) and TUI. It requires Node `>=22.19.0`. The npm licence field is "SEE LICENSE IN LICENSE". | verified | https://raw.githubusercontent.com/modelcontextprotocol/inspector/main/README.md; `npm view` |
| The CLI is built for smoke tests: `--transport http --server-url …`, `--method tools/list \| tools/call`, `--format json`, stable exit codes, and `--strict` schema findings that fail on error-severity issues ("Worth running in CI on any server whose tool schemas are generated"). In CI, "pin an exact version", for example `npx --yes @modelcontextprotocol/inspector@<x.y.z> --cli`. | verified | `docs/cli-smoke-testing.md` in the inspector repo |
| Without an OS keychain, secrets are saved to `~/.mcp-inspector/secrets.json`, "unencrypted unless you supply a key". | verified | inspector README |
| `@modelcontextprotocol/conformance` 0.1.16 is "A framework for testing MCP … implementations against the specification". The SDK repo runs it in CI against its own `everythingServer`. Its fit for an eight-tool domain server was not evaluated. | verified (existence and use); fit unverified | `npm view @modelcontextprotocol/conformance`; `sdk@main:.github/workflows/conformance.yml`, `test/conformance/package.json` |

---

## 7. CI quality gates and pre-commit hooks

### 7.1 Toolchain facts that constrain the gates

| Fact | Status | Source |
|---|---|---|
| `typescript` 7.0.2 is `latest`, with 7.1.0-beta tagged `beta`. TypeScript 7.0 was announced 2026-07-08: "While TypeScript 7.0 is here, it does not ship with an API." "We expect TypeScript 7.1 to ship with a new (and different) API". For tools such as typescript-eslint, "we recommend achieving this via npm aliases": `"typescript": "npm:@typescript/typescript6@^6.0.2"` alongside `"@typescript/native": "npm:typescript@^7.0.2"`. Doing so "will leave you only with a `tsc6` executable". | verified | `npm view typescript dist-tags`; https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ |
| `typescript-eslint` 8.72.1 (2026-10-26) peers on `typescript >=4.8.4 <6.1.0`. `npm install` next to `typescript@7.0.2` fails with `ERESOLVE`. | verified; local measurement | `npm view typescript-eslint peerDependencies`; `results/typescript-eslint-ts7-eresolve.txt` |
| `tsc --noEmit` (TS 7.0.2) over the bench (SDK v2, Vitest, `@types/node`) took 0.13 s wall. | local measurement | bench |
| `oxlint` 1.90.0 (2026-10-27). Its type-aware mode ("powered by typescript-go", package `oxlint-tsgolint` 7.0.2005) states "TypeScript 7.0+ is required" and "supports 59 out of 61 type-aware rules from typescript-eslint". Its rule coverage is "incomplete (but very close)". | verified | `npm view oxlint`; https://oxc.rs/docs/guide/usage/linter/type-aware.html |
| Other current versions: `prettier` 3.9.10 (2026-10-10), `eslint` 10.13.0 (2026-10-16), `@biomejs/biome` 2.6.4 (2026-10-28; features not reviewed), `dependency-cruiser` 18.7.0 (needs swc or TS <7, §1.1). | verified | `npm view` |
| The MCP SDK repo typechecks with `tsgo` (`@typescript/native-preview`) and lints with ESLint, typescript-eslint and `typescript ^5.9.3`, the two-compiler pattern. | verified | `sdk@main:pnpm-workspace.yaml`; `test/conformance/package.json` |

### 7.2 GitHub Actions facts

| Fact | Status | Source |
|---|---|---|
| Latest majors: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2, `actions/dependency-review-action` v5.0.0. | verified | `gh api repos/actions/<name>/releases/latest` |
| `setup-node` v6+ enables npm caching automatically when `packageManager` or `devEngines.packageManager` names npm. v7 moved its internals to ESM and removed the dummy `NODE_AUTH_TOKEN`. It supports `node-version-file`. | verified | https://raw.githubusercontent.com/actions/setup-node/main/README.md |
| Dependency review runs on "Public repositories" and "Private repositories with a GitHub Advanced Security license". SessionGateway is `PRIVATE`. | verified | https://raw.githubusercontent.com/actions/dependency-review-action/main/README.md; `gh repo view` |
| `npm audit --audit-level=<level>` sets the minimum severity that fails the command. `npm audit signatures` verifies registry signatures and provenance attestations. | verified | npm 11.17 `docs/content/commands/npm-audit.md` |
| Private repositories get included Actions usage as money: "$12 USD per month for GitHub Free and GitHub Free for organizations, and $18 USD per month for GitHub Team". A Linux 2-core minute costs $0.006, so $12 buys about 2,000 minutes. Public repositories' standard runners are free. | verified; minutes inferred | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| The SDK's CI uses `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }` and `permissions: contents: read`. | verified | `sdk@main:.github/workflows/main.yml`, `conformance.yml` |
| Node 24 entered maintenance on 2026-10-20. Node 26 became LTS on 2026-10-28. | verified | https://raw.githubusercontent.com/nodejs/Release/main/schedule.json |

### 7.3 Pre-commit hook managers

| Tool | Version and last release | How hooks get installed | Status | Source |
|---|---|---|---|---|
| husky | 9.1.7, published 2024-11-18 (repo last pushed 2026-03-19). 4 KB unpacked, no dependencies. | The project's own `prepare: "husky"` script. | verified | `npm view husky`; `gh api repos/typicode/husky` |
| lint-staged | 17.6.0 (2026-09-26). Node `>=22.22.1`. | Runs commands on staged files. | verified | `npm view lint-staged` |
| simple-git-hooks | 2.14.0 (2026-08-28) | A dependency `postinstall` script | verified | `npm view simple-git-hooks scripts` |
| lefthook | 2.2.2 (2026-10-13). Go binaries through per-platform optional dependencies. Runs jobs in parallel. Used by the MCP SDK repo for a parallel pre-push typecheck, lint and build. | A dependency `postinstall` script | verified | `npm view lefthook`; `sdk@main:lefthook.yml` |
| npm 11.17 `allowScripts` | Dependency install scripts are listed for review: "In the current release, this field is advisory … A future release will block unreviewed install scripts." | n/a | verified | npm 11.17 `docs/content/commands/npm-approve-scripts.md`, `npm-ci.md` |

**Inferred:** husky installs through the root project's own `prepare` script, not a dependency's install script, so npm's coming block on unreviewed scripts doesn't touch it. simple-git-hooks and lefthook each need an `allowScripts` approval, or an explicit `npx lefthook install`. Husky's lack of a release in two years reflects a finished tool (4 KB, no dependencies), not abandonment, but that is a judgement.

### 7.4 Gate order (inferred)

Cheapest and most-failing checks first, in one job (`npm ci` dominates a small repo, so splitting into jobs repeats it). Use `permissions: contents: read` and cancel superseded runs.

| # | Step | Command (illustrative) | Why here |
|---|---|---|---|
| 1 | Install | `npm ci` (setup-node with `node-version-file: .nvmrc`, npm cache) | Lockfile fidelity |
| 2 | Format | `prettier --check .` | Seconds; the most common failure |
| 3 | Lint | `oxlint` (or ESLint on the TS 6 alias) | Fast; no type info needed for the defaults |
| 4 | Typecheck | `tsc --noEmit` | 0.13 s on the bench under TS 7 |
| 5 | Boundaries | `depcruise src` with `parser: "swc"` | Only if `setup-ts-deep-modules` is adopted (§1.1 item 3) |
| 6 | Fixture | `npm run fixture:verify` | Ticket #3 |
| 7 | Tests | `vitest run --coverage` (projects: seam2, seam1, eval-on-fixture) | Tickets #4 and #23 |
| 8 | Build | `tsc -p tsconfig.build.json` | Proves the image's code compiles |
| 9 | Smoke (optional) | Start the built server, then pinned Inspector CLI `tools/list --strict --format json` | Catches generated-schema drift |
| 10 | Audit | `npm audit --audit-level=high` (separate, scheduled or non-blocking job) | The advisory database changes without a code change |

---

## 8. Recommendations for SessionGateway

| Choice | Pick | Reason | Risk |
|---|---|---|---|
| MCP SDK | **v2: `@modelcontextprotocol/server` 2.4.0 + `@modelcontextprotocol/node` 2.1.2, with `@modelcontextprotocol/client` 2.4.0 as a dev dependency. Pin exact versions.** `zod ^4.2` (4.6.7). | v2 is the stable line and serves both 2026-07-28 and 2025-era clients from one stateless `createMcpHandler`. v1 implements only up to 2025-11-25 and its support promise runs out around 2027-01-27, when 2027R1 goes live (§6.1). | Fast-moving: four minors in a month, and 2.3.0 changed connection semantics. Read each changelog before bumping. The spike's v1 code (deep imports, raw-shape schemas, hand-wired transport) needs rewriting, not copying. |
| Test runner | **Vitest 5.0.x with `@vitest/coverage-v8`** | Answers every spec need (§2.3). The SDK and the skills use it. 22 tests in about 0.35 s. | Adds about 67 packages with a Vite peer. 5.x is two months old; the 4.1 line is still patched as a fallback. |
| In-process MCP harness | **`createMcpHandler` through `handler.fetch`, run once with a modern client (`versionNegotiation: { mode: 'auto' }`) and once with a default (legacy) client. Plus one ephemeral-port test of `toNodeHandler`, the Host and Origin guards, the mount path and 405 on GET.** Call `listTools()` first so the client validates `structuredContent`. | It is the SDK's documented test path and covers both eras the server answers (measured, §6.4). `InMemoryTransport` covers only the 2025 era. | Doesn't exercise the Cloudflare tunnel. The final Host and Origin allowlists are open (§9). |
| Tool results | **`outputSchema` plus `structuredContent` (with JSON text alongside) on every tool. `isError: true` for unknown ids. `readOnlyHint: true` on all tools.** | Contract checks can assert on validated structure. The spec and SDK error channels match the spec's "Errors are reported as MCP errors". | Output schemas become a contract that clients cache. Changing them is visible. |
| Clock | **An injected `Clock` passed to the fake OLIS, the worker and the server. No global fake timers in seam 1. Run tests with a non-Pacific `TZ` set before workers start.** | One simulated time drives three components. It needs no global patching and allows concurrency (§4.1). | Every time read must go through the clock. A stray `new Date()` slips past. Grep for it in review. |
| Fake OLIS | **An in-process `node:http` server on `127.0.0.1:0` replaying the committed fixture at clock time, with the feed's quirks. A manual, never-CI contract test of the OLIS client against live OLIS.** | The highest-fidelity fake. The worker, the evaluation runner and local development reuse it. No global interception (§4.2). | Writing the OData emulation (paging, `$filter`, `$inlinecount`, `/$count`) is real work. Its fidelity is only as good as the contract test run against real OLIS. |
| Database in tests | **A file database (WAL) in a `mkdtempDisposable` directory through Vitest fixtures. `scope: 'file'` for read-only acceptance cases, `scope: 'test'` for live-behaviour cases.** | WAL needs a file. Hermetic without a full ingest per test (§4.3). | File-scoped sharing breaks if a "read-only" test ever writes. Keep the two kinds in separate files. |
| Fixtures | **`fixture:build` (deterministic, from the gitignored cache) plus a manifest (`source_url`, `retrieved_at`, sha256, bytes) plus `fixture:verify` in CI. Tree marked `linguist-generated`. Expected values in tests are spec literals, never computed from the fixture.** | Meets #3 and keeps record/replay easy to rerun (SWE ch. 14). | CI can't prove the fixture wasn't hand-edited (§4.4). Size is unmeasured, estimated at 20–65 MB. |
| Property-based testing | **Adopt `fast-check` 4.10.2 with `@fast-check/vitest` 0.5.0 alongside seam 2**, for range expansion and parser robustness | Cheap, and finds the edge cases the tables miss. Failing seeds replay (§5.1). | Generators that mirror the parser's grammar are tautological. Real-text tables stay the primary oracle. |
| Mutation testing | **Later.** Once the seam-2 parsers exist, run StrykerJS 10.1.x with `mutate` limited to the parser modules, `--incremental`, on demand or weekly, `break: null` at first, and no TypeScript checker. | Measures whether the parser tables kill mutants without slowing every PR (§5.2). | Cost unmeasured. The checker needs the TS 6 API. |
| Coverage | **Report v8 coverage with `coverage.include: ['src/**/*.ts']`. Enforce thresholds only per glob on the parser modules. No global percentage gate.** | SWE ch. 11: a global percentage becomes a ceiling. Seam-1 tests inflate coverage. | Unparsed areas can stay dark. Pair with mutation testing later. |
| TypeScript and lint | **TypeScript 7.0.2 for `tsc`. Prettier 3.9.x for formatting. `oxlint` for lint, adding `oxlint-tsgolint` type-aware rules when wanted.** If ESLint is required, use the TS team's documented TS 6 alias. | TS 7 is fast (0.13 s), and oxlint's type-aware mode requires TS 7. typescript-eslint can't install next to TS 7 (measured). | oxlint is not typescript-eslint, and its type-aware coverage is "incomplete". The TS 7.1 API may change the picture. dependency-cruiser needs `@swc/core` (an install script to approve). |
| Pre-commit | **Follow `setup-pre-commit`: husky 9.1.7 + lint-staged 17.6.x (Prettier) + `typecheck` + `test`.** Keep `npm test` fast, and keep the full-build evaluation run in a separate script. | It is the skill the agents follow. husky uses the root `prepare` script, which npm's `allowScripts` doesn't gate. | Slow hooks get bypassed with `--no-verify`. CI remains the gate. |
| CI | **One job on Node 24 (the deploy image), ordered as §7.4, cancelling superseded runs.** `npm audit --audit-level=high` runs separately. Dependency review stays off unless the org has Advanced Security. | Fast, and matches the deploy runtime. The repo is private, so minutes count against the plan's included $12/$18. | Node 24 has been in maintenance since 2026-10-20. Add a Node 26 leg before moving the image. Temporal becomes native there and fake timers then mock it. |
| Manual checks | **MCP Inspector 2.13.x**, web or CLI, against a local run. Optional pinned CLI smoke in CI. | The official tool, with a scriptable CLI and schema `--strict` findings (§6.5). | Without a keychain it stores secrets unencrypted. Not needed for a no-auth server. |

---

## 9. Open questions

1. **Origin and Host allowlists for a public, no-login server.** The spec says servers "MUST validate the `Origin` header". Which origins, if any, should be admitted? Reject every present `Origin`, or allow a list? Which `Host` values does the Cloudflare tunnel forward, given that the public name is still to be settled?
2. **Which MCP hosts speak 2026-07-28 today?** That decides how long the legacy era must stay in the seam-1 matrix.
3. **Worker in-process or as a child process in seam 1?** In-process is faster. A child process is closer to the two-container design and needs the HTTP fake (§4.2).
4. **The evaluation runner's shape (#23).** Should it be a Vitest project, a CLI, or both from one table of cases? The ticket needs both CI and "by command against any built database".
5. **Fixture size and per-file sizes**, once #3 lands (estimated at 20–65 MB).
6. **StrykerJS cost** on the real parsers, measured once seam 2 exists.
7. **Lint stack.** Is oxlint's rule set acceptable, or is ESLint with the TS 6 alias wanted until TS 7.1 ships an API?
8. **`@modelcontextprotocol/conformance` applicability** to a domain server (not evaluated).
9. **Moving to Node 26.** When does the image move, and do tests that rely on `Date` change once `Temporal` is native?
10. **Advanced Security on the org**, which decides whether `dependency-review-action` can run on this private repo.

---

## Appendix: local measurement files

All under `<scratch>`:
- `b-bench/package.json` lists the exact versions installed for the bench: `@modelcontextprotocol/server` 2.4.0, `client` 2.4.0, `node` 2.1.2, `zod` 4.6.7, `vitest` 5.0.5, `@vitest/coverage-v8` 5.0.5, `fast-check` 4.10.2, `@fast-check/vitest` 0.5.0, `typescript` 7.0.2, `@types/node` 24.19.2, `dependency-cruiser` 18.7.0, `@swc/core` 1.16.20.
- `b-bench/test/seam.test.ts` covers both eras through `handler.fetch`, `InMemoryTransport`, an ephemeral-port server with Host and Origin guards, error channels, output-schema validation, annotations, and fake timers across a real round trip. Output: `results/vitest-run.txt`.
- `b-bench/test/range.test.ts` has the spec's example plus a `test.prop` on a toy range expander.
- `b-bench/test/types.test-d.ts`, with output in `results/vitest-typecheck-ts7.txt`: `vitest --typecheck.only` under TS 7.0.2.
- `results/depcruise-ts7-only.txt` (0 modules cruised) and `results/depcruise-swc.txt` (the violation caught) come from `src/packages/{a,b}` with the skill's config.
- `results/typescript-eslint-ts7-eresolve.txt`: `npm install --dry-run typescript-eslint eslint` next to TS 7.
- SQLite and temp-directory check, run inline: `node --input-type=module -e "…mkdtempDisposableSync…DatabaseSync…PRAGMA journal_mode=WAL…"`, which printed `wal`, then `memory`, then `removed: true`.
- Fetched primary pages (text extractions) are in `b-src/pages/` (Canon TDD, Fowler ×3, SWE book ch. 11–14) and `b-src/*.md` (Node, undici, msw, fast-check, Stryker, Inspector and setup-node docs). The extraction script is `b-scripts/html2txt.py`.
