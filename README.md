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
SESSION_KEY=2025R1 DATABASE_PATH=data/index.db node src/bin/ingest.ts   # one full pull, then exit
SESSION_KEY=2025R1 DATABASE_PATH=data/index.db node src/bin/server.ts   # serves it at http://127.0.0.1:3000/mcp
```

| Variable | Used by | Default | What it is |
|---|---|---|---|
| `SESSION_KEY` | both | none | The one Session this deployment serves (ADR-0003), such as `2025R1`. |
| `DATABASE_PATH` | both | none | The SQLite file. The worker writes it and the server reads it. |
| `OLIS_BASE_URL` | both | none | The OLIS OData service root, such as `https://api.oregonlegislature.gov/odata/odataservice.svc` (a trailing slash is added if it is missing). The worker pulls from it, and the server reads one Measure from it when `get_measure` is called. |
| `OLIS_LIVE_TIMEOUT_MS` | server | `5000` | How long one live lookup may take, its five requests together, before `get_measure` answers from the cache and says the lookup failed. A whole number of milliseconds from 1 to 30000 (half what an MCP client waits for a tool by default); another value stops the start-up. |
| `MCP_PATH` | server | `/mcp` | Where the endpoint is mounted. |
| `MCP_HOST`, `MCP_PORT` | server | `127.0.0.1`, `3000` | Where it listens. |
| `MCP_ALLOWED_HOSTS` | server | `localhost,127.0.0.1,[::1]` | Host names a request may be addressed to; any other `Host` is refused with 403. |
| `MCP_ALLOWED_ORIGINS` | server | none | Origin host names a browser request may come from. A request with another `Origin` is refused with 403; one with no `Origin` passes. |
| `MCP_RATE_LIMIT`, `MCP_RATE_WINDOW_SECONDS` | server | `120`, `60` | The most tool calls the server answers in one window, over every caller together. A call over the limit gets a tool error that says when to try again. The MCP specification requires a limit, so one is always on. |

`get_measure` reads the Measure's location, history, schedule and votes from OLIS when a call arrives
(the `live_status` block, dated by the clock at the read). That is five OData requests for each call,
all filtered to that one Measure, so at the default rate limit the server makes at most 600 a minute. If
OLIS cannot be read the block holds the index's values and says the lookup failed.

A full pull against the live feed is allowed only between 5 pm and 6 am Pacific (ADR-0005). Nothing
schedules it yet, so run it by hand inside that window.

After a pull, `ingest.ts` writes `unresolved-legislator-codes.json` beside the database file: the
Legislator Codes it could not resolve through the Legislators rows or the alias file
(`src/packages/legislators/data/legislator-aliases.json`), with how many rows used each. An empty list
means every code resolved. An entry in the alias file needs evidence from the feed itself (see the
file's `about` entry).

## How the code is written

Test-first, at the two seams spec #1 agreed. The rules agents and people
follow are in `CLAUDE.md` at the root and in each top-level folder. The
toolchain and dependency policy are in
`docs/adr/0008-typescript-toolchain-and-dependency-policy.md`.

## License

The code is MIT licensed (`LICENSE`). The Oregon Legislature documents
committed under `test/fixtures/` are public records reproduced as published;
the license does not cover them.
