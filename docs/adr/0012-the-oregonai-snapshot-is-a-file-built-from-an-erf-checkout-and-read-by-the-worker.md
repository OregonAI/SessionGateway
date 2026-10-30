# The OregonAI snapshot is one JSON file built from a checkout of OregonAI's ERF repository, named by its commit, and only the worker reads it

ADR-0004 says what is copied from OregonAI at build time: the agency registry, the ORS section ids and a table from each ORS chapter to the Agencies whose rules implement it. This ADR records how (ticket #10).

**The build step.** `scripts/snapshot/build.ts` reads a local checkout of OregonAI's `executive-regulatory-frameworks` (ERF) repository, whose path is an argument and is never in the code, and writes one JSON file. It needs no network. It reads three committed files and nothing else, and it only reads: git runs with `GIT_OPTIONAL_LOCKS=0`, so `git status` does not refresh the checkout's index, and a test shows the index is left as found.

- **The registry** is `_meta/catalog/agencies.yml`: for each of its 190 rows the slug, `name`, `aliases`, `oar_chapter` and `das_agency_number` (20 rows have no OAR chapter, 10 have aliases, 80 have a DAS number). Node has no YAML parser and ERF publishes the registry in no JSON form (its `agency-graph.json` has the slugs and names but neither aliases nor numbers), so the script uses the `yaml` package (ISC, no dependencies, no install script), a dev dependency that the service does not ship.
- **The ORS section ids** are the statute nodes of `_meta/graph.json`. The files under `statutes/` are the same 37,534 ids, and the build stops if the two differ. ERF's own catalog marks exactly those sections "ingested"; it lists 221 more (219 "not_sliceable", 2 "not_ingested") that have no id on OregonAI and so none here.
- **The chapter-to-agency table.** For each `implements` edge of the graph from a rule to an ORS section, the rule's OAR chapter, taken from its id (`oar-340-012-0130` is in chapter 340), is matched to the registry row with that `oar_chapter`, and that row's slug joins the section's chapter (`ors-chapter-468`). Only rule-to-section edges count: 92,532 of the graph's 96,524 `implements` edges (policies, executive orders and rule-to-rule edges make up the rest). The result is 1,572 pairs over 439 of the 531 chapters, two Agencies to a chapter at the median and 123 at most (chapter 183). A rule whose chapter is not in the registry stops the build, naming the rule, because the table would leave its Agency out silently.

Two checks on the data, run on 2026-10-30 against ERF at commit 58e1839, support this reading. Every one of the 42,561 rules has an `agency:` slug in its frontmatter that equals the registry row of its id's chapter, so "the rule's OAR chapter" and "the rule's Agency" are the same fact. And ERF's own `_meta/agency-graph.json` lists, for each agency, the ORS chapters its rules implement; turned around, it gives exactly this table (439 chapters, no difference).

**The version** is the checkout's HEAD commit (its 40-character SHA) and its commit date, written in Pacific time with its offset like every time here, with the name of the corpus (`executive-regulatory-frameworks`). The build refuses a checkout where any of the three paths it reads has uncommitted changes (including untracked files in `statutes/`): the commit names the data only if the data is the commit's. ERF's commit says how old the data is, and the version of a snapshot taken from a checkout behind `origin/main` shows that.

**Who reads it.** The ingest worker reads the file (`SNAPSHOT_PATH`) before it reads OLIS, parses it with zod, and stores its version with the full pull in one transaction (`snapshot_state`). The server reads the version from the database and `session_overview` reports it. The snapshot file is not needed while serving. The worker stores the version and nothing else of the snapshot yet: no tool shows the registry, the section list or the table, and a table or a reader with no caller is a test below the tools (ADR-0009). The first ticket that reads one of them decides whether it keeps the data in the database or reads the file, and says so in its own ADR.

**Nothing calls OregonAI while serving**, as three `dependency-cruiser` rules that `npm run lint:boundaries` runs, each shown to bite by a test that plants the import it forbids:
- the MCP server and its entry script never reach the `oregonai-snapshot` package, directly or through a chain of imports (`reachable`);
- nothing under `src/` imports `scripts/`, so the builder, the only code that knows ERF's layout, is not part of any path the service runs;
- nothing under `src/` imports a package from `devDependencies`, which covers the MCP client SDK, the one package that could speak to OregonAI's gateway, and `yaml`.

What the rules cannot see is a bare `fetch` to an OregonAI host in code that was given one. The server is built with no `fetch` today (`createSessionGatewayHandler(config, { clock })`); the ticket that gives it one for the live lookup passes it to code that calls OLIS alone.

**The trimmed fixture.** `test/fixtures/oregonai-snapshot/` holds the snapshot cut down to what the 2025R1 fixture touches, made by the same script (`--trim-to`), with a record of what it kept (`test/fixtures/oregonai-snapshot/README.md`). It keeps 114 of 190 Agencies, 4,383 of 37,534 sections and 38 of 439 table rows. `scripts/snapshot/verify.ts` checks it in `npm run check` without a checkout, and fails when a Measure added to the 2025R1 fixture cites a chapter the snapshot fixture lacks.

## Considered Options

- **Keep the whole snapshot in the database.** Spec #1 says the snapshot is "stored with the database's build metadata", and a database copied from the GPU desktop to the deploy box would then carry it. But nothing reads it yet and no tool could show it; the reader and the tables would be written for callers that do not exist. Left to the first ticket that reads the content, which can add it to `snapshot_state`'s neighbours without changing what is here.
- **Take the rule's Agency from its frontmatter** instead of its id's chapter. They agree on every rule today. The id needs no file reads (42,561 of them), and the ticket says "each rule's OAR chapter".
- **Take the table from ERF's `agency-graph.json`.** It gives the same table, but ERF derives it from `graph.json` for another purpose (its own note says so), and its fields could change without warning. Used here as a check.
- **Write a small YAML reader** for the registry. Its rows have multi-line quoted scalars and nested lists; a reader that skipped them correctly would be a YAML parser of our own.
- **Ask OregonAI's gateway for the registry and the table at build time.** It needs the network, which a build on the GPU desktop may not have, and the deployed gateway lags `main` (ADR-0004).

## Consequences

- A sub-unit of an Agency is a row of its own, with its own OAR chapter: the Department of Human Services is `department-of-human-services` (chapter 407), and its Child Welfare Programs are `department-of-human-services-child-welfare-programs` (chapter 413). The table says which of them implements a chapter. A Fiscal Impact Statement that names "Department of Human Services" resolves to the parent, so deriving "a measure touches DHS" from a Statute Link needs the sub-unit's parent, which each row's `relations` records in the registry and the snapshot does not copy yet.
- The registry has no alias "ODHS" or "OBDD". Neither appears in `agencies.yml`, which holds aliases on 10 rows only. The 2025R1 fixture's README leaves open whether those short names count as aliases the spec means; against this registry they do not.
- `name` is the registry's statutory name. `oar_name` (the chapter's OAR title, which differs from `name` on 3 rows) and `raw_index_name` are not copied.
- A range is expanded against ERF's ingested sections, which are all but 221 of the 37,755 ERF's catalog lists.
- The snapshot's version is the commit of the checkout, which may be behind `origin/main`; a refresh is a new build.
