# Seven packages for the tracer bullet, with the database's writer and reader as two entry points

Spec #1 lists twelve modules, and `src/CLAUDE.md` asks the ticket that first builds any of them to record how they become packages. Ticket #4 builds the path from OLIS to `get_measure`, so seven packages exist after it (`src/packages/`). Each package's root files are its entry points; everything below them is hidden (`src/packages/README.md`). The `example/` template stays until the owner deletes it.

| Package | Entry points | What it is |
|---|---|---|
| `time` | `clock.ts`, `pacific.ts` | The injected `Clock` and the system clock; Pacific `Timestamp`s: feed timestamps read as Pacific local time, instants written with their offset. |
| `domain` | `index.ts` | The glossary's words as types (`SessionKey`, `Measure`, `MeasureId`) and the one place that mints and parses ids and builds the OLIS page URL. |
| `config` | `index.ts` | The environment read once through zod, for the worker and for the server. |
| `olis-client` | `index.ts` | Spec module 1: the only code that sees the feed's own shapes. |
| `database` | `writer.ts`, `reader.ts` | The only code that imports `node:sqlite`. |
| `ingest` | `index.ts` | Spec module 2, the full pull only. |
| `mcp-server` | `handler.ts`, `http.ts` | The tool contract, and serving it on a port behind the Host and Origin guards. |

Dependencies point one way. `time` and `domain` sit at the bottom; `config`, `olis-client` and `database` build on them; `ingest` and `mcp-server` sit on top. `src/bin/ingest.ts` and `src/bin/server.ts` are the two entry scripts: they create the clock, `fetch` and the shutdown signal once and pass them down.

**The database is two entry points, not one.** The worker writes and the server reads (ADR-0007), and the SQLite connection modes differ: `writer.ts` opens with WAL and `timeout: 5000`, `reader.ts` opens `readOnly` with `timeout: 5000`. Giving each side its own entry point lets the boundary check say that the server's code and entry script may import `reader.ts` and never `writer.ts`, and that the worker may import `writer.ts` and never `reader.ts` (the `server-reads-only` and `worker-writes-only` rules in `.dependency-cruiser.cjs`). A server that cannot reach the writer cannot write by mistake. Later tickets add queries to `reader.ts` and `writer.ts` (or further entry points beside them, such as a search index) rather than a second way into SQLite.

**Time and ids are packages of their own.** The client reads feed timestamps as Pacific local time and the worker dates a pull, and what the server shows has to agree with both; the configuration, the client, the database and the server all use the same ids. So each lives once, in a package at the bottom. Pacific time uses Node 26's native `Temporal`, not the process time zone, which is why the tests run under a zone other than Pacific.

Later tickets add packages as their modules arrive (the document store, the Statute Link parser, the Agency Link extractor, the embedder, search) and add entry points to these. A new MCP tool is a file in `mcp-server/lib/` registered in `handler.ts`.

## Considered Options

- **One package per spec module, all twelve now.** Most would be empty folders, and their interfaces would be guesses before any caller exists.
- **One `core` package.** Nothing would be hidden, and the read-only server could reach the writer.
- **Separate packages for the writer and the reader.** They share one schema and one connection module, so splitting them would duplicate the schema or expose it.
- **A types-only package beside `domain`.** Minting an id needs the types it returns, so the two stay together.
