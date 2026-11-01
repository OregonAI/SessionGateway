// Seam 1 on a real port (test/CLAUDE.md, "MCP client"): the Node adapter, the mount path and, below,
// the Host and Origin guards. Everything else is tested in-process through handler.fetch.
//
// Its systems are copies of the run's template for their options (test/CLAUDE.md, Database, Templates): one for the
// default server and one for each configured server.
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveMcp, type RunningServer } from "#/packages/mcp-server/http.ts";
import { callTool, connectClientToUrl, eras } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;
let server: RunningServer;

/** A legacy client's first request, which a server that lets the request through answers with 200. */
const initializeRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "guard-test", version: "0.0.0" } },
});

/** Posts an initialize request to the mount path with exactly these headers (fetch would not let a test choose Host). */
function postInitialize(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
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
    request.end(initializeRequest);
  });
}

/**
 * Sends one GET with exactly this request-target over a raw socket and returns the status code the
 * server answers with. fetch and http.request both normalise or refuse the targets below (`//`
 * would become `/`), so only bytes on a socket reach the server as written.
 */
function statusOfRawTarget(port: number, requestTarget: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let received = "";
    const shown = JSON.stringify(requestTarget);
    socket.setTimeout(2000, () => {
      socket.destroy();
      reject(new Error(`No answer to the request-target ${shown} within 2 s`));
    });
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("latin1");
      const code = /^HTTP\/1\.1 (\d{3}) /.exec(received)?.[1];
      if (code === undefined) return;
      socket.destroy();
      resolve(Number(code));
    });
    socket.once("error", reject);
    socket.once("close", () => {
      reject(new Error(`The server closed the connection without answering the request-target ${shown}`));
    });
    socket.write(`GET ${requestTarget} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
  });
}

/** An error the server reports is a failure of the test. */
function rethrow(error: Error): never {
  throw error;
}

beforeAll(async () => {
  system = await startCopiedSystem({
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

describe("a request-target that is not a URL", () => {
  // `new URL(target, "http://localhost")` rejects each of these, and the server once let that TypeError
  // out of the request listener, which ended the process. A request-target the server cannot read is
  // the client's mistake: 400 (the 404 above is for a target that reads fine and names another path).
  const unreadableTargets = [
    { target: "//", reason: "a network-path reference with no host" },
    { target: "//x:y", reason: "a port that is not a number" },
    { target: "//a:99999/b", reason: "a port above 65535" },
    { target: "//[", reason: "an IPv6 literal that never closes" },
    {
      target: "http://127.0.0.1:99999/session-gateway/mcp",
      reason: "an absolute-form target at the mount path with a bad port",
    },
    { target: "http://", reason: "an absolute-form target with no host" },
  ];

  it.for(unreadableTargets)("answers 400 to $target ($reason) and keeps serving", async ({ target }) => {
    expect(await statusOfRawTarget(server.port, target)).toBe(400);

    const connected = await connectClientToUrl(
      "2026-07-28",
      new URL(`http://127.0.0.1:${server.port}/session-gateway/mcp`),
    );
    try {
      const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });

      expect(outcome.structured).toMatchObject({ id: "measure-2025r1-sb69" });
    } finally {
      await connected.close();
    }
  });
});

describe("the Host and Origin guards", () => {
  it("refuses a request addressed to a host that is not on the list (DNS rebinding)", async () => {
    expect(await postInitialize(server.port, { host: "rebinding.example" })).toBe(403);
  });

  it("refuses a request from a browser origin that is not on the list", async () => {
    expect(await postInitialize(server.port, { origin: "https://evil.example" })).toBe(403);
  });
});

describe("the Host and Origin lists set in the environment", () => {
  // MCP_ALLOWED_HOSTS and MCP_ALLOWED_ORIGINS are comma-separated, with spaces allowed around each entry.
  let configured: System;
  let configuredServer: RunningServer;

  beforeAll(async () => {
    configured = await startCopiedSystem({
      clockAt: "2025-01-29T17:00:00Z",
      serverEnv: {
        MCP_HOST: "127.0.0.1",
        MCP_PORT: "0",
        MCP_PATH: "/session-gateway/mcp",
        MCP_ALLOWED_HOSTS: " gateway.example.org , 127.0.0.1 ",
        MCP_ALLOWED_ORIGINS: "claude.ai, app.example.org",
      },
    });
    configuredServer = await serveMcp(configured.handler, configured.serverConfig, { onError: rethrow });
  });

  afterAll(async () => {
    await configuredServer.close();
    await configured.stop();
  });

  it.for(["https://claude.ai", "https://app.example.org"])("answers a browser request from %s", async (origin) => {
    expect(await postInitialize(configuredServer.port, { origin })).toBe(200);
  });

  it("still refuses an origin the list leaves out", async () => {
    expect(await postInitialize(configuredServer.port, { origin: "https://evil.example" })).toBe(403);
  });

  it("answers a request addressed to a host the list names", async () => {
    expect(await postInitialize(configuredServer.port, { host: "gateway.example.org:8443" })).toBe(200);
  });

  it("refuses a host the list replaced, localhost among them", async () => {
    expect(await postInitialize(configuredServer.port, { host: "localhost" })).toBe(403);
  });
});
