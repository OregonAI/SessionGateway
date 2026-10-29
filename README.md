# SessionGateway

A data source for answering questions about an Oregon legislative session,
served over the [Model Context Protocol](https://modelcontextprotocol.io).
SessionGateway will cache a session from the Legislature's OLIS OData feed,
build a graph of it, and search it with embeddings. Paired with the OregonAI
Corpus MCP, it should show quickly how a proposed bill or amendment would affect
a state agency.

It should be hostable on the Google Cloud Run free tier or on Azure.

## Status

Pre-requirements. The build follows the mattpocock-skills flow:

1. **Research**: `docs/research/` (OLIS OData, OregonAI pairing, embeddings and storage)
2. **Requirements**: `/grill-with-docs` → `GLOSSARY.md`, `docs/adr/`
3. **Spec**: `/to-spec`
4. **Plan**: `/to-tickets`
5. **Build**: `/implement`

An early spike (an FTS5 keyword index plus MCP tools in one container) is
parked on the `prototype/scaffold` branch. It is reference material, not a
decision.
