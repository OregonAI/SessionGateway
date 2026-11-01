# SessionGateway

A data source for answering questions about an Oregon legislative session,
served over the [Model Context Protocol](https://modelcontextprotocol.io).
SessionGateway will cache a session from the Legislature's OLIS OData feed,
build a graph of it, and search it with embeddings. Paired with the OregonAI
Corpus MCP, it should show quickly how a proposed bill or amendment would affect
a state agency.

It runs on the OregonAI deploy box beside the platform's corpora
(`docs/adr/0007-run-on-the-deploy-box.md`).

## Status

Specified and ticketed: spec #1, tickets #3–#25. The build follows the
mattpocock-skills flow:

1. **Research**: `docs/research/` (OLIS OData, OregonAI pairing, embeddings and storage)
2. **Requirements**: `/grill-with-docs` → `GLOSSARY.md`, `docs/adr/`
3. **Spec**: `/to-spec`
4. **Plan**: `/to-tickets`
5. **Build**: `/implement`

An early spike (an FTS5 keyword index plus MCP tools in one container) is
parked on the `prototype/scaffold` branch. It is reference material, not a
decision.

## Running it

Two entry scripts, run by Node 26 straight from the `.ts` source, share one SQLite file. Both read
their configuration from the environment and fail at start-up, naming the variable, if it is wrong.

```
npm run model:fetch   # once: the embedding model (about 34 MB) into .cache/models/
export SESSION_KEY=2026R1 DATABASE_PATH=data/index.db OLIS_BASE_URL=https://api.oregonlegislature.gov/odata/odataservice.svc
export MODEL_PATH=.cache/models/Xenova--bge-small-en-v1.5/ea104dacec62c0de699686887e3f920caeb4f3e3
SNAPSHOT_PATH=data/snapshot.json node src/bin/ingest.ts --once   # one full pull, then exit: the first pull
SNAPSHOT_PATH=data/snapshot.json node src/bin/ingest.ts          # then the schedule below, until stopped
node src/bin/server.ts   # serves it at http://127.0.0.1:3000/mcp
```

| Variable | Used by | Default | What it is |
|---|---|---|---|
| `SESSION_KEY` | both | none | The one Session this deployment serves (ADR-0003), such as `2026R1` (ADR-0046). |
| `DATABASE_PATH` | both | none | The SQLite file. The worker writes it and the server reads it. |
| `SNAPSHOT_PATH` | worker | none | The OregonAI snapshot file the build uses (see "Building the OregonAI snapshot"). The worker reads it before it reads OLIS and stores its version with the full pull; the server never reads it. |
| `MODEL_PATH` | both | none | The directory that holds the pinned embedding model's files, which `npm run model:fetch` downloads and `npm run model:verify` checks (ADR-0026). The worker embeds each new passage with it and the server embeds each question; either checks every file against the lock's sha256 at start-up and stops, naming the file, if one is missing or is not the pinned one (about 25 ms). |
| `MODEL_THREADS` | worker | `1` | How many threads one run of the model may use (1 to 64). The server always uses one: the deploy box has two cores shared with seven corpora. |
| `OLIS_BASE_URL` | both | none | The OLIS OData service root, such as `https://api.oregonlegislature.gov/odata/odataservice.svc` (a trailing slash is added if it is missing). The worker pulls from it, and the server reads one Measure from it when `get_measure` is called. |
| `OLIS_LIVE_TIMEOUT_MS` | server | `5000` | How long one live lookup may take, its five requests together, before `get_measure` answers from the cache and says the lookup failed. A whole number of milliseconds from 1 to 30000 (half what an MCP client waits for a tool by default); another value stops the start-up. |
| `OLIS_DOCUMENT_ORIGIN` | worker | `https://olis.oregonlegislature.gov` | Where the worker fetches the documents the feed links. They are not on the feed's host. Only a test sets it. |
| `STATUTES_AFFECTED_TABLE_URL` | worker | none | Where Legislative Counsel publishes the Session's Statutes Affected Table, such as `https://www.oregonlegislature.gov/AutoPubs/artables2026R1.pdf` (an `http` or `https` URL; another value stops the start-up). It is not on OLIS, and it appears only after the Session ends (2025R1's is dated 8/19/2025). With it set, each full pull fetches the table, reads it again when its bytes or the snapshot's commit change, and `get_measure` sets its entries beside each Version's parsed Statute Links (ADR-0033, ADR-0034, ADR-0044). Unset, or while the address answers 404, nothing changes. |
| `INGEST_INCREMENTS` | both | `daily` | How often the worker reads what OLIS changed between full pulls: `off`, `daily` (one a night, 5 pm to 6 am Pacific, on nights the full pull does not run) or `15min` (every 15 minutes, 6 am to 10 pm Pacific, on days the Session meets). Another value stops the start-up (ADR-0039). The server reads it to know when the index is too old. |
| `INGEST_FULL_PULL` | both | `weekly` | How often the worker reads the whole Session: `nightly`, `weekly` (Saturday) or `monthly` (the 1st). It runs from midnight to 6 am Pacific, once a day at most, whatever the value. Another value stops the start-up (ADR-0039). |
| `INGEST_HASH_SAMPLE_SIZE` | worker | `200` | How many stored documents the nightly hash sample fetches again to compare their hashes with the stored ones (ADR-0040). A whole number of at least 1; another value stops the start-up. The sample runs every night inside 5 pm to 6 am Pacific and writes `hash-sample-report.json` beside the database. |
| `MCP_PATH` | server | `/mcp` | Where the endpoint is mounted. |
| `MCP_HOST`, `MCP_PORT` | server | `127.0.0.1`, `3000` | Where it listens. |
| `MCP_ALLOWED_HOSTS` | server | `localhost,127.0.0.1,[::1]` | Host names a request may be addressed to; any other `Host` is refused with 403. |
| `MCP_ALLOWED_ORIGINS` | server | none | Origin host names a browser request may come from. A request with another `Origin` is refused with 403; one with no `Origin` passes. |
| `MCP_RATE_LIMIT`, `MCP_RATE_WINDOW_SECONDS` | server | `120`, `60` | The most tool calls the server answers in one window, over every caller together. A call over the limit gets a tool error that says when to try again. The MCP specification requires a limit, so one is always on. |

`get_measure` reads the Measure's location, history, schedule and votes from OLIS when a call arrives
(the `live_status` block, dated by the clock at the read). That is five OData requests for each call,
all filtered to that one Measure. The rate limit is a fixed window, so at the default 120 calls a minute
the server makes at most 600 requests in a window, and up to 1,195 within one minute when a burst of
calls straddles two windows (the window opens with its first call, so 119 calls at the end of one window
and 120 at the start of the next are all answered). If OLIS cannot be read the block holds the index's
values and says the lookup failed.

A full pull also fetches every document the feed links that the database does not hold yet, once each,
and writes `build-report.json` beside the database: the documents that are scans with no text layer, and
the ones it could not get or read (ADR-0011), and how many passages it embedded and how many it reused because
the same text already had a vector (ADR-0025). The report also has `pull`: every set the pull read, with the rows
the feed counted for it, the rows that came, and how many the index lists and holds without listing. A pull counts
as complete only when every set's rows match the feed's count. One that does not is refused: it stores nothing,
leaves the database as the last complete pull left it, exits with an error that names each short set, and writes a
`build-report.json` of its own (`attempted_at` and `pull`, with `complete: false` and the short sets). A row that two
complete pulls in a row did not list stays in the database and is served by id, but search leaves it out
(ADR-0005, ADR-0030). The report also has `committee_members`: for each committee, the rows the database holds of
the feed's CommitteeMembers, by Legislator Code.

A full pull against the live feed is allowed only between 5 pm and 6 am Pacific (ADR-0005). `ingest.ts` with no
argument runs the schedule (ADR-0039): it wakes every quarter hour and runs what the two settings say is due, an
increment or the full pull, once for each night or quarter hour. A full pull runs from midnight to 6 am of its day
(every day, Saturday or the 1st), so it falls once on a date however often the worker restarts. `ingest.ts --once`
makes one full pull at once, ignoring the window, and exits: make the first pull with it (an increment needs a full
pull before it), inside the window.

An increment reads only the rows OLIS created or modified since the last run, less two hours (`CreatedDate gt X or
ModifiedDate gt X`), and fetches the documents they link; the index's `as_of` is the start of the latest full pull or
increment, and `session_overview` reports `last_increment`. Two delays follow, and neither is a bug:

- A row OLIS stops listing leaves search only after two complete full pulls, because an increment is not one
  (ADR-0030): about two weeks under the default `weekly`.
- MeasureDocuments and MeasureAnalysisDocuments rows have a null `ModifiedDate`, so an increment picks up their new
  rows by `CreatedDate`, and a change to an existing row of those sets waits for the next full pull.

Every tool result carries a warning, as one more block of text, when the index is too old for the configured
rhythm: with `15min`, the latest update is over two hours old during working hours; with `daily`, it is older than the
last night window (a night was missed); with `off`, the last full pull is older than its last scheduled run. A day the
Session meets is, for now, a day with a committee meeting in the index (ConveneTimes and the Session's dates are not
read yet). The ingest worker logs each run that fails as a JSON line on stdout (pino), and the loop tries again in the
next slot.

After a pull, `ingest.ts` writes `unresolved-legislator-codes.json` beside the database file: the
Legislator Codes it could not resolve through the Legislators rows or the alias file
(`src/packages/legislators/data/legislator-aliases.json`), with how many rows used each. An empty list
means every code resolved. An entry in the alias file needs evidence from the feed itself (see the
file's `about` entry). The pull also reads the committee members, and the members of a task force are not all
Legislators, so their names are listed here as unresolved (`CommitteeMembers`) and are not an error.

## Evaluating a build

`npm run eval` runs the acceptance questions of a Session (spec #1, story 58) against any built database, in
process, through the MCP tools, the way an agent would ask them, and prints each as `PASS` or `FAIL` with the reason
for a failure. It opens the database read-only and sends nothing to OLIS. It is development tooling, a script under
`scripts/eval/`; it is not part of `npm test` or `npm run check`, which test it against the fixture.

```
npm run eval -- --database data/index.db                      # the questions of the Session the database holds, each at its own moment
npm run eval -- --database data/index.db --since 2025-01-23   # the same, with "since yesterday" fixed for every question
```

| Option | Default | What it is |
|---|---|---|
| `--database` | none | The SQLite file the ingest worker wrote. Required. |
| `--session` | the database's Session | The Session whose questions to run: `scripts/eval/questions/<session>.yml`. The database must hold that Session. Not needed when it holds exactly one; a database that holds several needs it, and one that holds none cannot be run. A Session with no question set file is an exit 2 that names the file. |
| `--since` | each question's own | What "since yesterday" means to every question that says `$since` (question (a)): an ISO 8601 date or time, which overrides the question's own. Not needed: each question names the moment it is asked at (`clock`) and "since yesterday" is the Pacific day before it, so (a) is asked on 2025-01-24 and 2025-01-31, the days after its postings, and passes on any database that holds them, a full build included. |

The exit status is 0 when every question passed, 1 when any failed, and 2 when the run could not be made (no
database at the path, a bad option, a database that holds no Session, several with none named by `--session`, or not the
one named, a Session with no question set file, a question set that is not valid). `MODEL_PATH` is read as for the server. A
question set is data: each question has a `clock` (required when it says `$since`, otherwise the database's as-of time), and lists the tool calls and, for each, checks of the form `{ path, equals | includes |
atLeast | length | present }` over the tool's structured result (`scripts/eval/paths.ts` says how a path is read), so
2026R1's questions are another file in `scripts/eval/questions/` with no change to the code.

## Building in a Claude cloud session

A ticket can be built in a Claude Code cloud session (claude.ai/code) as well as on a local checkout, and
`npm run check` is the same gate there. A cloud session starts from a fresh clone on a fresh Ubuntu 24.04 VM, so
three things are set once in its cloud environment (Anthropic's [cloud environment
docs](https://code.claude.com/docs/en/cloud-environments), read 2026-10-31):

- **Node 26.** The image has Node 20, 21 and 22 (`/opt/node20` to `/opt/node22`, with 22 on `PATH`), and
  `package.json`'s `engines` range starts at Node 26.13.0: Node runs the `.ts` source with no build step
  (ADR-0008). Install it with the environment's setup script, which runs as root before the cloud session starts
  and is kept in the environment's cache. A script that exits non-zero stops the cloud session from starting, so
  a download that fails its hash never runs.

  ```bash
  #!/bin/bash
  # Node for SessionGateway (package.json's engines). The hash is this file's line in the release's signed
  # SHASUMS256.txt.
  set -euo pipefail
  v=26.13.0
  f=node-v$v-linux-x64.tar.gz
  if [ ! -x /opt/node26/bin/node ]; then
    curl -fsSL "https://nodejs.org/dist/v$v/$f" -o "/tmp/$f"
    echo "5848553868b402d3fabb5b09270649977780a390f832155721025a08b5104455  /tmp/$f" | sha256sum -c -
    mkdir -p /opt/node26
    tar -xzf "/tmp/$f" -C /opt/node26 --strip-components=1
    rm "/tmp/$f"
  fi
  /opt/node26/bin/node --version
  ```

  The signature on that `SHASUMS256.txt` checks against Node release key
  `C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C` from [nodejs/release-keys](https://github.com/nodejs/release-keys)
  (checked 2026-10-31). Node 26.13.0 ships npm 11.20.0, which knows the settings in `.npmrc`
  (`strict-allow-scripts`, `min-release-age`, `allow-git`, `allow-remote`). Install with it, never with the
  image's npm. When `engines` moves to another Node, the script's version and hash move with it, here and in
  the environment.
- **Network.** Choose Custom access, keep "Also include default list of common package managers" (it has
  `registry.npmjs.org` and `nodejs.org`), and add these two lines to the allowed domains:

  ```
  huggingface.co
  *.hf.co
  ```

  `npm run model:fetch` downloads the pinned model (ADR-0026) from huggingface.co, which hands the 34 MB ONNX
  file on to a CDN host under `hf.co` (`us.aws.cdn.hf.co` on 2026-10-31). `npm ci` reads only the npm
  registry, because `.npmrc` refuses git and remote-tarball dependencies. `npm run check` needs no network: the
  suite reaches only localhost. No OLIS host is on the list, and none should be added (see below).
- **Command time.** Claude waits at most 10 minutes for a command in the foreground. `npm run check` took
  11 min 12 s on the CI runner (run 41209641029, 649 s of it the tests), and a cloud session has about 4 vCPUs,
  so give the check room: add `BASH_MAX_TIMEOUT_MS=1800000` to the environment's variables, or have Claude run
  it in the background.

Then, from the clone's root. Claude's commands do not keep an exported variable from one to the next, so each
one puts Node 26 first on `PATH`:

```
PATH=/opt/node26/bin:$PATH node --version   # v26.13.0
PATH=/opt/node26/bin:$PATH npm ci
PATH=/opt/node26/bin:$PATH npm run model:fetch
PATH=/opt/node26/bin:$PATH npm run check
```

`npm ci` is the only install, never `npm install`: `strict-allow-scripts` makes it fail while any dependency's
install script is neither approved nor denied in `package.json`, and `min-release-age` resolves only versions
published at least 14 days ago ("Dependencies" in `CLAUDE.md`).

Working on a ticket there differs in three ways
([cloud session docs](https://code.claude.com/docs/en/claude-code-on-the-web)):

- The repository is private, so the Claude GitHub App must be installed on the OregonAI organization (or
  GitHub connected with `/web-setup`).
- The cloud session's GitHub proxy refuses the `gh` commands that use GraphQL, `gh issue` and `gh pr` among them.
  Read a ticket with `gh api repos/OregonAI/SessionGateway/issues/<N>`, and open the PR with the cloud session's
  Create PR button or `gh api repos/OregonAI/SessionGateway/pulls`. A cloud session pushes branches only, never
  a tag or a deletion.
- The mattpocock skills that `CLAUDE.md`'s build flow names (`/implement`, `/tdd`, `/code-review`, `/pr`,
  `/domain-modeling`) are committed under `.claude/skills/`, so a cloud session has them as a local checkout
  does. They were copied with `npx skills@latest add mattpocock/skills --agent claude-code`, and
  `skills-lock.json` pins each one to a hash of its files; `npx skills@latest update` brings them up to date in
  a PR of its own, where the diff shows what changed. A skill runs with the agent's permissions, so read a
  changed one before merging it.

Three things stay on a local machine:

- **The OLIS cache** (`.cache/olis-2025R1/`, gitignored). The Acceptable Use Agreement allows a full refresh once
  a day, between 5 pm and 6 am Pacific, and grants no redistribution license (ADR-0005,
  `docs/research/olis-odata.md`). So the cache is not copied into a cloud environment, and a cloud session never
  pulls the feed.
- **The checkout of `executive-regulatory-frameworks`** that the snapshot build reads (see "Building the
  OregonAI snapshot"). It is another repository, which the build reads from a local path, and a cloud session
  holds only this one.
- **The fixture build's downloads.** They come from OLIS under the same agreement, and each is cached under
  `.cache/` with its retrieval time, so that a rebuild produces no diff (`test/fixtures/CLAUDE.md`).

So three kinds of ticket are built on a local checkout, not in a cloud session: a snapshot rebuild (such as
#49), a fixture rebuild (such as #54), and anything that pulls from OLIS or reads its cache, such as the 2026R1 backfill (#24)
or an evaluation run against a full build (#23).

## Building the OregonAI snapshot

The agency registry, the list of ORS section ids and the table of which Agencies' rules implement each
ORS chapter come from OregonAI's published data, copied once when a database is built and never looked
up while serving (ADR-0004, ADR-0012). The build step reads a local checkout of OregonAI's
`executive-regulatory-frameworks` repository, whose path is an argument, and writes the snapshot as one
JSON file named by the checkout's commit:

```
node scripts/snapshot/build.ts --erf <checkout of executive-regulatory-frameworks> --out data/snapshot.json
```

The checkout is only read, and the build stops if the path is not the root of a git checkout or a file it reads has uncommitted changes. Needs no network.
`session_overview` reports the commit and its date.

## How the code is written

Test-first, at the two seams spec #1 agreed. The rules agents and people
follow are in `CLAUDE.md` at the root and in each top-level folder. The
toolchain and dependency policy are in
`docs/adr/0008-typescript-toolchain-and-dependency-policy.md`.

## License

The code is MIT licensed (`LICENSE`). The Oregon Legislature documents
committed under `test/fixtures/` are public records reproduced as published;
the license does not cover them.
