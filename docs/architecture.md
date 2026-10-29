# Architecture

## Shape

```
legislature sources ──adapter──▶ documents.jsonl ──ingest──▶ session.db ──baked into──▶ container
                                                                                         │
                                         MCP client ◀── search / get_document ── /mcp ◀──┘
```

The index is built **offline**, ships **read-only inside the image**, and the
server is **stateless**. Serving therefore needs no database service and no
sticky sessions, and it scales to zero. That is what keeps it inside the free
tiers.

## Decisions

**TypeScript on Node 24, ESM, TypeScript 7.** Sources import with `.ts`
extensions. `tsx` runs them in development, and `tsc` rewrites the imports to
`.js` in `dist/`. `erasableSyntaxOnly` keeps the code runnable by Node's native
type stripping as well.

**`node:sqlite` with FTS5, not a vector database.** A single session is small
(thousands of documents), and legislative questions lean heavily on exact terms:
measure numbers, statute citations, names. BM25 with Porter stemming is a strong
baseline, costs nothing, and has no native build step. The index is one file
that is copied into the image.

**Semantic search comes later, as an addition.** Hybrid retrieval (BM25 + vectors,
merged with reciprocal-rank fusion) can live in the same SQLite file through
`sqlite-vec`, with embeddings computed at ingest time. `SessionStore.search` is
the seam: the MCP tools never see how ranking works. Ship the BM25 baseline
first, build a question set, then measure whether vectors help.

**Retrieval only; the client generates.** The server makes no LLM calls, so it
needs no API key and has no per-query model cost. The tool descriptions tell the
client to cite `sourceUrl`.

**Stateless Streamable HTTP.** Each POST to `/mcp` gets a fresh `McpServer` and
transport (`sessionIdGenerator: undefined`, JSON responses). GET and DELETE
return 405. Stdio serves local clients from the same tool definitions.

**One container, two clouds.** Cloud Run and Azure Container Apps both run an
OCI image with `PORT` injected. The code contains nothing cloud-specific.

**Auth is optional.** Session documents are public records and the server is
read-only, so `/mcp` is open by default. Set `MCP_TOKEN` to require
`Authorization: Bearer <token>` (for example, to limit usage before launch).

## Ingest contract

`SessionDocument` (`src/document.ts`) is the only interface between data
sources and the index. Adapters for a given legislature (bill text, amendments,
testimony, agendas, votes) write JSONL, and nothing downstream depends on where
the data came from. Measure ids are normalized (`"H.B. 2001"` → `HB2001`) on both
write and query.

## Next steps

1. **Choose the target session and source.** Write the first adapter that turns
   the legislature's published data into `documents.jsonl`.
2. **Write an evaluation set.** Collect 30–50 real questions with known answers
   and source documents. Measure recall@k before changing ranking.
3. **Add structured tools for questions that aren't passage searches**: a measure's
   history and status, sponsors, committee referrals, vote tallies. These are
   relational queries, so they belong in tables beside the passages, not in the
   full-text index.
4. **Add hybrid retrieval** (`sqlite-vec` + a small local embedding model at
   ingest), if the evaluation set shows BM25 missing paraphrased questions.
5. **Add CI**: typecheck, test, build the index, build and push the image.
