import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { documentSchema } from "./document.ts";
import type { SessionStore } from "./store.ts";

const GROUNDING = "Every result carries a sourceUrl; cite it. This index is a mirror, not the official record.";

/** Build an MCP server exposing the session index as retrieval tools. */
export function createMcpServer(store: SessionStore): McpServer {
  const server = new McpServer({ name: "session-gateway", version: "0.1.0" });

  server.registerTool(
    "session_overview",
    {
      title: "Session overview",
      description: `What this index holds: sessions covered and document counts by type. Call first. ${GROUNDING}`,
      inputSchema: {},
    },
    async () => json(store.overview()),
  );

  server.registerTool(
    "search",
    {
      title: "Search the session",
      description: `Full-text search over passages of session documents (measures, amendments, testimony, meetings, votes, journals). Returns ranked passages with snippets; use get_document for full text. ${GROUNDING}`,
      inputSchema: {
        query: z.string().min(1).describe("Natural-language or keyword query"),
        type: documentSchema.shape.type.optional().describe("Restrict to one document type"),
        measure: z.string().optional().describe('Restrict to one measure, e.g. "HB 2001"'),
        limit: z.number().int().min(1).max(50).optional().describe("Max passages (default 10)"),
      },
    },
    async ({ query, type, measure, limit }) => json({ hits: store.search(query, { type, measure, limit }) }),
  );

  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description: `Full text and metadata for one document by id (from search results). ${GROUNDING}`,
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const doc = store.get(id);
      if (!doc) return { isError: true, content: [{ type: "text", text: `No document with id "${id}"` }] };
      return json(doc);
    },
  );

  return server;
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
