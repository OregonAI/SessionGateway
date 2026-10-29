import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer } from "../src/http.ts";
import { createMcpServer } from "../src/mcp.ts";
import { sampleStore } from "./helpers.ts";

function text(result: unknown): string {
  const first = (result as CallToolResult).content[0];
  if (first?.type !== "text") throw new Error("expected text content");
  return first.text;
}

describe("MCP tools", () => {
  async function connect() {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(sampleStore()).connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    return client;
  }

  it("lists the retrieval tools", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_document", "search", "session_overview"]);
  });

  it("search returns cited hits", async () => {
    const result = await (await connect()).callTool({ name: "search", arguments: { query: "broadband" } });
    const { hits } = JSON.parse(text(result));
    expect(hits[0]).toMatchObject({ id: "sample-sb9002-testimony-1", sourceUrl: expect.stringMatching(/^https:/) });
  });

  it("get_document reports a missing id as a tool error", async () => {
    const result = await (await connect()).callTool({ name: "get_document", arguments: { id: "nope" } });
    expect(result.isError).toBe(true);
  });
});

describe("HTTP transport", () => {
  const servers: ReturnType<typeof createHttpServer>[] = [];
  afterEach(() => servers.splice(0).forEach((s) => s.close()));

  async function listen(token?: string) {
    const server = createHttpServer(sampleStore(), { token });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("serves health and MCP over stateless HTTP", async () => {
    const base = await listen();
    expect(await (await fetch(`${base}/healthz`)).text()).toBe("ok");

    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const result = await client.callTool({ name: "session_overview", arguments: {} });
    expect(JSON.parse(text(result)).documents).toBe(3);
    await client.close();
  });

  it("rejects requests without the bearer token when one is configured", async () => {
    const base = await listen("secret");
    const res = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);

    const client = new Client({ name: "test", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: "Bearer secret" } },
    });
    await client.connect(transport);
    expect((await client.listTools()).tools.length).toBe(3);
    await client.close();
  });
});
