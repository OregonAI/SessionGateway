# Production code

Rules for everything under `src/`. Spec #1's "Modules" section lists the modules; ADR-0008 has the toolchain.

## Shape

- Code lives in deep modules under `src/packages/<name>/`. A package's root files are its entry points, and everything in its subfolders is hidden: implementation in `lib/`, its tests in `tests/`. dependency-cruiser enforces this over `src` and `test` (`npm run lint:boundaries`), and `src/packages/README.md` has the rules. `/codebase-design` has the vocabulary. The lead set the rules up with `/setup-ts-deep-modules`, which is user-invoked, so agents don't run it.
- Which spec modules become which packages is a design call. The ticket that first splits them records the split in an ADR; ADR-0009 records the first one, and a ticket that adds a package or an entry point extends it.
- Only one package imports `node:sqlite`, and the other modules reach the database through its entry points. The API is Stability 1.2 (release candidate), so keeping it behind one module keeps a swap to better-sqlite3 local if an adopter refuses release-candidate APIs. The writer opens with `timeout: 5000` and WAL; the server opens `readOnly: true, timeout: 5000`. The default timeout of 0 fails at once on a busy database.
- Only the OLIS client sees the feed's own shapes: misspelled property names (`CommitteCode`, `LegislatoreCode`), decimal keys as strings, timestamps with no offset (read as Pacific, exposed with an offset). It hands everything else domain types named as `GLOSSARY.md` names them.
- One module mints and parses ids, in the forms spec #1 and ADR-0004 give (`measure-2025r1-sb69`, `ors-468.130`, `ors-chapter-657b`). Ids are branded types, so a `MeasureId` can't stand in for an `OrsSectionId`.

## Parse at the boundary

Every value from outside the process arrives as `unknown`: OLIS JSON, extracted PDF text and metadata, environment variables, MCP tool arguments, the OregonAI snapshot. A zod schema parses it into a domain type at the edge, and code past the edge trusts the type. Each MCP tool's zod schemas are the single source of its `inputSchema` and `outputSchema`.

## Dependencies are passed in

The clock, `fetch`, the OLIS base URL, file paths and randomness are parameters. Each is created once in the entry scripts under `src/bin/` and passed down. Time comes from the injected `Clock`; only the system clock adapter calls `Date.now()` or a bare `new Date()`. This is what lets seam-1 tests run the whole system at a simulated time.

## Errors

- **Expected outcomes are values.** An unknown citation, a removed row, or a live lookup that failed and fell back to the cache is a discriminated-union result, handled by an exhaustive `switch` with a `never` default.
- **Bugs and infrastructure failures throw** an `Error` with a `cause`.
- **The MCP edge decides what is an error.** The tool result envelope turns a tool's fault into it: an unknown id or citation becomes a tool result with `isError: true` (spec #1: "Errors are reported as MCP errors"). A cache fallback or a row OLIS no longer lists is a normal result with a flag saying so, because the cache still answers (story 44) and a removed row stays fetchable by id (story 47). Only protocol problems become JSON-RPC errors.
- **Async calls are bounded and awaited.** Every `fetch` carries an `AbortSignal` (a timeout combined with shutdown), and every promise is awaited or returned.

## What every tool result carries

- a `source_url` for each document;
- the index's "as of" time;
- the notice that this is not the official record;
- ids in OregonAI form.

The as-of time and the notice, with the rate limit, the Staleness warning and the MCP result (the content pair, `isError`), belong to the tool result envelope, `mcp-server/envelope.ts`, and to no tool: a tool supplies its name, its schemas (without `as_of` and `notice`, which the envelope folds into the `outputSchema`), a function that returns its answer or a fault, and a message for each fault. The envelope reads the As of once for each call and passes it to the tool; an Index with none answers every tool with one error.

Results are facts only: no predictions, advice or opinions on a Measure's merits.

Documents are served exactly as published (ADR-0002); extraction may split text into parts but never rewrites it. Nothing calls OregonAI while serving (ADR-0004), and OregonAI data comes only from the build-time snapshot. Rules check it (ADR-0012). In `.dependency-cruiser.cjs`: the server never reaches the `oregonai-snapshot` package, nothing under `src/` imports `scripts/`, nothing under `src/` imports a `devDependencies` package, and the server path imports no built-in that opens a connection (`https`, `net`, `tls`, ...). In `eslint.config.js`: only the entry scripts under `src/bin/` name the global `fetch` or `WebSocket`, and `node:http` is for `createServer` alone. Only the ingest worker reads the snapshot file; the server learns its version from the database.

## MCP

The server is built on MCP SDK v2: `@modelcontextprotocol/server` and `createMcpHandler`, stateless. Every tool has an `outputSchema`, returns `structuredContent`, and is marked `readOnlyHint: true`. The MCP specification, not spec #1, requires servers to validate `Origin` and to rate-limit tool calls, so both are on by default and configured from the environment. Which origins to allow is still open (`docs/research/testing-and-mcp.md` §9, question 1).

The `prototype/scaffold` branch is a throwaway spike on SDK v1. Write new code from the v2 docs, not from it.

## Configuration and portability

One config module reads `process.env` once at startup through a zod schema. It fails fast, naming the bad variable but never its value, and passes a typed object down. Everything a deployment varies is an environment variable: the Session key, OLIS base URL, data, model and snapshot paths, MCP path, host and port, allowed origins, and rate limits.

The deploy box, its addresses and paths, the Cloudflare tunnel and platform-deploy belong in deploy files, so another organization can run the same image on its own platform. Logs are JSON lines on stdout (pino).

## Readable by whoever inherits it

The next maintainers may come from C#. Write for them:

- explicit parameter and return types on every exported function;
- a string-literal union or an `as const` object where C# would use an enum, since type stripping rejects `enum`, `namespace` and parameter properties;
- plain functions and modules rather than classes, and plain control flow rather than type-level computation.
