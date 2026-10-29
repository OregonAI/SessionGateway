# SessionGateway

A retrieval (RAG) data source for one legislative session, served over the
[Model Context Protocol](https://modelcontextprotocol.io). An MCP client — Claude,
or any agent — asks questions about the session; SessionGateway returns ranked,
cited passages from the session's documents (measures, amendments, testimony,
committee meetings, votes, journals).

SessionGateway does retrieval, not generation: it returns passages and sources,
and the client's model writes the answer.

## Quick start

Requires Node 24+.

```sh
npm install
npm test                 # 16 tests: chunking, search, MCP tools, HTTP transport
npm run ingest:sample    # builds data/session.db from the fictional sample fixture
npm run dev:http         # http://localhost:8080/mcp  (health: /healthz)
```

Use it from Claude Code over stdio:

```sh
claude mcp add session-gateway -- npx tsx /home/dzinck/SessionGateway/src/bin/stdio.ts
```

or over HTTP, against the dev server or a deployed URL:

```sh
claude mcp add --transport http session-gateway http://localhost:8080/mcp
```

## MCP tools

| Tool | Purpose |
|---|---|
| `session_overview` | Sessions covered and document counts by type. Call it first. |
| `search` | Full-text passage search, with optional `type` and `measure` filters (`"HB 2001"`, `"hb2001"` and `"H.B. 2001"` all match). |
| `get_document` | Full text and metadata for one document, by id. |

Every hit carries a `sourceUrl`. The index is a mirror, not the official record.

## Loading a session

The ingest contract is JSONL, one `SessionDocument` per line (schema in
[`src/document.ts`](src/document.ts)):

```json
{"id":"…","session":"2027R1","type":"measure","measure":"HB 2001","title":"…","date":"2027-01-11","sourceUrl":"https://…","text":"…"}
```

```sh
npm run ingest -- path/to/documents.jsonl [--db data/session.db]
```

Re-ingesting an id replaces that document. Data-source adapters, which fetch from
the legislature and write this JSONL, are not built yet. See
[docs/architecture.md](docs/architecture.md#next-steps).

## Layout

```
src/
  document.ts      ingest contract (zod schema) + measure normalization
  chunk.ts         text → retrieval passages
  store.ts         SQLite index: documents + FTS5 passages (node:sqlite, no native deps)
  mcp.ts           MCP tool definitions
  http.ts          stateless Streamable HTTP transport (+ optional bearer token)
  config.ts        env → config
  bin/             entry points: http, stdio, ingest
test/              vitest suites + fictional sample fixture
docs/              architecture decisions and deployment
Dockerfile         one image for Cloud Run and Azure Container Apps
```

## Scripts

| Script | |
|---|---|
| `npm test` / `npm run typecheck` | vitest / `tsc --noEmit` (TypeScript 7) |
| `npm run build` | compile to `dist/` |
| `npm start` | run the compiled HTTP server |
| `npm run dev:http` / `dev:stdio` | run from source |
| `npm run ingest -- <file.jsonl>` | build or update the index |

## Hosting

[docs/deploy.md](docs/deploy.md) covers deploying the same container image to
Google Cloud Run or Azure Container Apps. Both fit in their free monthly grants
at low traffic.
