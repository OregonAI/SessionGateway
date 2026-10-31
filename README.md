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
export SESSION_KEY=2025R1 DATABASE_PATH=data/index.db OLIS_BASE_URL=https://api.oregonlegislature.gov/odata/odataservice.svc
export MODEL_PATH=.cache/models/Xenova--bge-small-en-v1.5/ea104dacec62c0de699686887e3f920caeb4f3e3
SNAPSHOT_PATH=data/snapshot.json node src/bin/ingest.ts   # one full pull, then exit
node src/bin/server.ts   # serves it at http://127.0.0.1:3000/mcp
```

| Variable | Used by | Default | What it is |
|---|---|---|---|
| `SESSION_KEY` | both | none | The one Session this deployment serves (ADR-0003), such as `2025R1`. |
| `DATABASE_PATH` | both | none | The SQLite file. The worker writes it and the server reads it. |
| `SNAPSHOT_PATH` | worker | none | The OregonAI snapshot file the build uses (see "Building the OregonAI snapshot"). The worker reads it before it reads OLIS and stores its version with the full pull; the server never reads it. |
| `MODEL_PATH` | both | none | The directory that holds the pinned embedding model's files, which `npm run model:fetch` downloads and `npm run model:verify` checks (ADR-0026). The worker embeds each new passage with it and the server embeds each question; either checks every file against the lock's sha256 at start-up and stops, naming the file, if one is missing or is not the pinned one (about 25 ms). |
| `MODEL_THREADS` | worker | `1` | How many threads one run of the model may use (1 to 64). The server always uses one: the deploy box has two cores shared with seven corpora. |
| `OLIS_BASE_URL` | both | none | The OLIS OData service root, such as `https://api.oregonlegislature.gov/odata/odataservice.svc` (a trailing slash is added if it is missing). The worker pulls from it, and the server reads one Measure from it when `get_measure` is called. |
| `OLIS_LIVE_TIMEOUT_MS` | server | `5000` | How long one live lookup may take, its five requests together, before `get_measure` answers from the cache and says the lookup failed. A whole number of milliseconds from 1 to 30000 (half what an MCP client waits for a tool by default); another value stops the start-up. |
| `OLIS_DOCUMENT_ORIGIN` | worker | `https://olis.oregonlegislature.gov` | Where the worker fetches the documents the feed links. They are not on the feed's host. Only a test sets it. |
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

A full pull against the live feed is allowed only between 5 pm and 6 am Pacific (ADR-0005). Nothing
schedules it yet, so run it by hand inside that window.

After a pull, `ingest.ts` writes `unresolved-legislator-codes.json` beside the database file: the
Legislator Codes it could not resolve through the Legislators rows or the alias file
(`src/packages/legislators/data/legislator-aliases.json`), with how many rows used each. An empty list
means every code resolved. An entry in the alias file needs evidence from the feed itself (see the
file's `about` entry). The pull also reads the committee members, and the members of a task force are not all
Legislators, so their names are listed here as unresolved (`CommitteeMembers`) and are not an error.

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
