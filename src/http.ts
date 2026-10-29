import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp.ts";
import type { SessionStore } from "./store.ts";

export interface HttpOptions {
  /** When set, /mcp requires `Authorization: Bearer <token>`. */
  token?: string | undefined;
}

/**
 * Stateless Streamable HTTP: each POST gets a fresh MCP server and transport,
 * so any instance can answer any request. That is what lets Cloud Run and
 * Azure Container Apps scale to zero and back without sticky sessions.
 */
export function createHttpServer(store: SessionStore, { token }: HttpOptions = {}): Server {
  return createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      jsonRpcError(res, 401, "Unauthorized");
      return;
    }
    if (req.method !== "POST") {
      jsonRpcError(res, 405, "Method not allowed: this server is stateless, POST only");
      return;
    }

    await handleMcp(store, req, res);
  });
}

async function handleMcp(store: SessionStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = createMcpServer(store);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("mcp request failed", err);
    if (!res.headersSent) jsonRpcError(res, 500, "Internal server error");
  }
}

function jsonRpcError(res: ServerResponse, status: number, message: string): void {
  res
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}
