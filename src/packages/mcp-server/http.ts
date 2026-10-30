// Serves the MCP handler over HTTP on a port, with the Node adapter from @modelcontextprotocol/node.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from "@modelcontextprotocol/node";
import type { ServerConfig } from "#/packages/config/index.ts";
import type { SessionGatewayHandler } from "./handler.ts";

export type RunningServer = {
  /** The port actually bound (the configured one, or the one the system chose for port 0). */
  port: number;
  close(): Promise<void>;
};

export type ServeDeps = {
  /** Told of an error the adapter turns into a 500 response. */
  onError: (error: Error) => void;
};

export async function serveMcp(
  handler: SessionGatewayHandler,
  config: Pick<ServerConfig, "host" | "port" | "mcpPath" | "allowedHosts" | "allowedOrigins">,
  deps: ServeDeps,
): Promise<RunningServer> {
  const mcp = toNodeHandler(handler, { onerror: deps.onError });
  // The handler trusts its caller, but the MCP specification says a server must validate Origin
  // (against DNS rebinding), so both guards stand in front of it. Each answers 403 itself.
  const allowedHost = hostHeaderValidation(config.allowedHosts);
  const allowedOrigin = originValidation(config.allowedOrigins);
  const server = createServer((request, response) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== config.mcpPath) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    if (!allowedHost(request, response) || !allowedOrigin(request, response)) return;
    // The adapter types its request structurally, with optional properties that exclude `undefined`;
    // a real IncomingMessage satisfies it at runtime but not under exactOptionalPropertyTypes.
    mcp(request as NodeIncomingMessageLike, response).catch((error: unknown) => {
      deps.onError(error instanceof Error ? error : new Error("MCP request failed", { cause: error }));
      response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
        server.closeAllConnections();
      }),
  };
}
