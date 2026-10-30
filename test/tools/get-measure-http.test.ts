// Seam 1 on a real port (test/CLAUDE.md, "MCP client"): the Node adapter, the mount path and, below,
// the Host and Origin guards. Everything else is tested in-process through handler.fetch.
import { request as httpRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveMcp, type RunningServer } from "#/packages/mcp-server/http.ts";
import { callTool, connectClientToUrl, eras } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;
let server: RunningServer;

/** An error the server reports is a failure of the test. */
function rethrow(error: Error): never {
  throw error;
}

beforeAll(async () => {
  system = await startSystem({
    clockAt: "2025-01-29T17:00:00Z",
    serverEnv: { MCP_HOST: "127.0.0.1", MCP_PORT: "0", MCP_PATH: "/session-gateway/mcp" },
  });
  server = await serveMcp(system.handler, system.serverConfig, { onError: rethrow });
});

afterAll(async () => {
  await server.close();
  await system.stop();
});

describe("get_measure over HTTP", () => {
  it.for(eras)("answers a %s client at the mount path", async (era) => {
    const connected = await connectClientToUrl(era, new URL(`http://127.0.0.1:${server.port}/session-gateway/mcp`));
    try {
      const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

      expect(outcome.structured).toMatchObject({ id: "measure-2025r1-sb69" });
    } finally {
      await connected.close();
    }
  });

  it("answers 404 anywhere else", async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: "{}",
    });

    expect(response.status).toBe(404);
  });
});

describe("the Host and Origin guards", () => {
  /** Posts to the mount path with exactly these headers (fetch would not let a test choose Host). */
  function post(headers: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: server.port,
          path: "/session-gateway/mcp",
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.once("error", reject);
      request.end("{}");
    });
  }

  it("refuses a request addressed to a host that is not on the list (DNS rebinding)", async () => {
    expect(await post({ host: "rebinding.example" })).toBe(403);
  });

  it("refuses a request from a browser origin that is not on the list", async () => {
    expect(await post({ origin: "https://evil.example" })).toBe(403);
  });
});
