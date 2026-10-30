# Seven packages for the tracer bullet, with the database's writer and reader as two entry points

Spec #1 lists twelve modules, and `src/CLAUDE.md` asks the ticket that first builds any of them to record how they become packages. Ticket #4 builds the path from OLIS to `get_measure`, so seven packages exist after it (`src/packages/`). Each package's root files are its entry points; everything below them is hidden (`src/packages/README.md`). The `example/` template stays until the owner deletes it.

| Package | Entry points | What it is |
|---|---|---|
| `time` | `clock.ts`, `pacific.ts` | The injected `Clock` and the system clock; the Pacific `Timestamp`: an instant or a Pacific wall-clock reading written with the offset in force. It knows the zone and no source's text format. |
| `domain` | `index.ts` | The glossary's words as types (`SessionKey`, `Measure`, `MeasureId`) and the one place that mints and parses ids and builds the OLIS page URL. |
| `config` | `index.ts` | The environment read once through zod, for the worker and for the server. |
| `olis-client` | `index.ts` | Spec module 1: the only code that sees the feed's own shapes, among them the offset-less timestamps, which it reads as Pacific local time and refuses in any other form. |
| `database` | `writer.ts`, `reader.ts` | The only code that imports `node:sqlite`. |
| `agency-links` | `index.ts` | Spec module 5, the Agency Link extractor (ticket #7): pure functions from a Fiscal Impact Statement's text, Version or Proposed Amendment text, or a Testimony row's `Organization` to Agency Links with their evidence. The agency registry is a parameter. It imports only `domain`, for the Agency id (`AgencyId`, minted in `domain/agencies.ts`), and no package imports it yet; the ingest worker will, with the build-time snapshot (#16). |
| `ingest` | `index.ts` | Spec module 2, the full pull only. |
| `mcp-server` | `handler.ts`, `http.ts` | The tool contract and its rate limit (one ceiling over every caller, timed by the injected `Clock`), and serving it on a port behind the Host and Origin guards. |

Dependencies point one way. `time` is at the bottom, `domain` is on it, `config`, `olis-client` and `database` build on those, and `ingest` and `mcp-server` sit on top. `src/bin/ingest.ts` and `src/bin/server.ts` are the two entry scripts: each loads its configuration and creates what it needs (the clock, `fetch`, the shutdown signal, and for the server its pino logger) once, and passes it down.

**What the OLIS client reads so far.** Ticket #4 reads one entity set, Measures. Of the feed's quirks (`src/CLAUDE.md`, "Shape"; `docs/research/olis-odata.md` sections 1 and 8) the client therefore handles, and the tests show, `$inlinecount`, paging with a relative `odata.nextLink`, `/$count` without a JSON `Accept` header, and timestamps with no offset. Decimal keys serialized as strings and misspelled property names do not occur in Measures: they are in sets the client does not read yet (`MeasureSponsors`: `MeasureSponsorId` and `LegislatoreCode`; `MeasureAnalysisDocuments`: `MeasureAnalysisId` and `CommittteCode`; `CommitteeAgendaItems`: `CommitteCode`). The first ticket that reads one of them handles the quirk in `olis-client/lib/`, exposes the corrected name or number as a domain type, and shows it through a tool. Reading a set only to exercise a quirk, with nothing an agent could see, would have meant a test below the tools, which `test/CLAUDE.md` does not agree as a seam.

**The database is two entry points, not one.** The worker writes and the server reads (ADR-0007), and the SQLite connection modes differ: `writer.ts` opens with WAL and `timeout: 5000`, `reader.ts` opens `readOnly` with `timeout: 5000`. Giving each side its own entry point lets the boundary check say that the server's code and entry script may import `reader.ts` and never `writer.ts`, and that the worker may import `writer.ts` and never `reader.ts` (the `server-reads-only` and `worker-writes-only` rules in `.dependency-cruiser.cjs`). A server that cannot reach the writer cannot write by mistake. Later tickets add queries to `reader.ts` and `writer.ts` (or further entry points beside them, such as a search index) rather than a second way into SQLite.

**Time and ids are packages of their own.** The worker dates a pull and the client dates every row, and what the server shows has to agree with both; the configuration, the client, the database and the server all use the same ids. So each lives once, in a package at the bottom. Pacific time uses Node 26's native `Temporal`, not the process time zone, which is why the tests run under a zone other than Pacific. How the feed writes a timestamp (no offset, read as Pacific) is a feed shape, so `src/CLAUDE.md` keeps it in the OLIS client: `time` turns a Pacific wall-clock reading into a `Timestamp` and the client's `lib/timestamps.ts` is the only code that reads the feed's text.

Later tickets add packages as their modules arrive (the document store, the Statute Link parser, the Agency Link extractor, the embedder, search) and add entry points to these. A new MCP tool is a file in `mcp-server/lib/` registered in `handler.ts`.

## Considered Options

- **One package per spec module, all twelve now.** Most would be empty folders, and their interfaces would be guesses before any caller exists.
- **One `core` package.** Nothing would be hidden, and the read-only server could reach the writer.
- **Separate packages for the writer and the reader.** They share one schema and one connection module, so splitting them would duplicate the schema or expose it.
- **A types-only package beside `domain`.** Minting an id needs the types it returns, so the two stay together.
