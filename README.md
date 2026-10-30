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
| `OLIS_BASE_URL` | worker | none | The OLIS OData service root, such as `https://api.oregonlegislature.gov/odata/odataservice.svc/`. |
| `MCP_PATH` | server | `/mcp` | Where the endpoint is mounted. |
| `MCP_HOST`, `MCP_PORT` | server | `127.0.0.1`, `3000` | Where it listens. |
| `MCP_ALLOWED_HOSTS` | server | `localhost,127.0.0.1,[::1]` | Host names a request may be addressed to; any other `Host` is refused with 403. |
| `MCP_ALLOWED_ORIGINS` | server | none | Origin host names a browser request may come from. A request with another `Origin` is refused with 403; one with no `Origin` passes. |

A full pull against the live feed is allowed only between 5 pm and 6 am Pacific (ADR-0005). Nothing
schedules it yet, so run it by hand inside that window.

## How the code is written

Test-first, at the two seams spec #1 agreed. The rules agents and people
follow are in `CLAUDE.md` at the root and in each top-level folder. The
toolchain and dependency policy are in
`docs/adr/0008-typescript-toolchain-and-dependency-policy.md`.

## License

The code is MIT licensed (`LICENSE`). The Oregon Legislature documents
committed under `test/fixtures/` are public records reproduced as published;
the license does not cover them.
