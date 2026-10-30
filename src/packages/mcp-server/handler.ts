// The MCP server's handler: stateless Streamable HTTP, built on MCP SDK v2's createMcpHandler. It
// serves 2026-07-28 clients and, through the SDK's stateless fallback, 2025-era clients too.
import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { ServerConfig } from "#/packages/config/index.ts";
import { openIndexReader, type IndexReader } from "#/packages/database/reader.ts";
import { getMeasure, getMeasureInput, getMeasureOutput, unknownMeasureMessage } from "./lib/get-measure.ts";

export type SessionGatewayHandler = {
  fetch: McpHttpHandler["fetch"];
  close(): Promise<void>;
};

function buildServer(reader: IndexReader, config: ServerConfig): McpServer {
  const server = new McpServer({ name: "session-gateway", version: "0.0.0" });
  server.registerTool(
    "get_measure",
    {
      title: "Get a Measure",
      description:
        "Looks up one Measure of the Session by its id or citation and returns its catchline, a link to its OLIS page, when this index was last refreshed and a notice that it is not the official record.",
      inputSchema: getMeasureInput,
      outputSchema: getMeasureOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => {
      const result = getMeasure(reader, config.session, input);
      switch (result.kind) {
        case "found":
          return {
            content: [{ type: "text", text: JSON.stringify(result.measure) }],
            structuredContent: result.measure,
          };
        case "unknown":
          return {
            isError: true,
            content: [{ type: "text", text: unknownMeasureMessage(result.reference, result.session) }],
          };
        default:
          return result satisfies never;
      }
    },
  );
  return server;
}

export function createSessionGatewayHandler(config: ServerConfig): SessionGatewayHandler {
  const reader = openIndexReader(config.databasePath);
  const handler = createMcpHandler(() => buildServer(reader, config));
  return {
    fetch: handler.fetch,
    close: async () => {
      await handler.close();
      reader.close();
    },
  };
}
