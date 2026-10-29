# SessionGateway

RAG data source for one legislative session, served over MCP. TypeScript on Node 24, ESM.

- Gates: `npm run typecheck && npm test && npm run build`. All three must pass before handing work back.
- Imports use `.ts` extensions (`./store.ts`); `tsc` rewrites them to `.js`. Keep code erasable: no enums, namespaces or parameter properties.
- `src/document.ts` is the ingest contract. Change it deliberately and update the fixture and tests with it.
- `SessionStore.search` is the retrieval seam. Change ranking behind it; don't leak ranking details into `mcp.ts`.
- The HTTP server must stay stateless (fresh MCP server per request). Scale-to-zero hosting depends on it.
- The server is retrieval only: no LLM calls, no API keys.
- Test fixtures are fictional and labeled as such. Never put invented content where it could pass for a real legislative record.
- Architecture and next steps: `docs/architecture.md`. Deployment: `docs/deploy.md`.
