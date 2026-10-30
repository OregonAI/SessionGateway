import { Client, StreamableHTTPClientTransport, type FetchLike } from "@modelcontextprotocol/client";

/** The two kinds of MCP client the server answers (test/CLAUDE.md, "MCP client"). */
export type Era = "2026-07-28" | "legacy";
export const eras: readonly Era[] = ["2026-07-28", "legacy"];

/** What the tests need of a server handler: the web-standard `fetch` face of `createMcpHandler`. */
export type FetchHandler = {
  fetch: (request: Request) => Promise<Response>;
};

export type ConnectedClient = {
  client: Client;
  close(): Promise<void>;
};

/**
 * Connects a client to a handler in-process: no port, no socket. A 2026-07-28 client is pinned to
 * that revision and never falls back; a legacy client is the SDK's default. `listTools()` comes
 * first so that the client validates each result's `structuredContent` against the tool's output
 * schema.
 */
export async function connectClient(era: Era, handler: FetchHandler): Promise<ConnectedClient> {
  return connect(era, new URL("http://session-gateway.test/mcp"), (input, init) =>
    handler.fetch(new Request(input, init)),
  );
}

/** Connects a client to a server on a real port, over the network stack. */
export async function connectClientToUrl(era: Era, url: URL): Promise<ConnectedClient> {
  return connect(era, url, undefined);
}

async function connect(era: Era, url: URL, fetchImplementation: FetchLike | undefined): Promise<ConnectedClient> {
  const client = new Client(
    { name: `seam-1-${era}-client`, version: "0.0.0" },
    era === "legacy" ? {} : { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(
    url,
    fetchImplementation === undefined ? {} : { fetch: fetchImplementation },
  );
  await client.connect(transport);
  const negotiated = client.getProtocolEra();
  if (negotiated !== (era === "legacy" ? "legacy" : "modern")) {
    throw new Error(`The ${era} client negotiated ${String(negotiated)}`);
  }
  await client.listTools();
  return { client, close: () => client.close() };
}

/** What an agent sees of one `get_measure` call. */
export type ToolOutcome = {
  isError: boolean;
  structured: Record<string, unknown> | undefined;
  text: string;
};

export async function callTool(
  { client }: ConnectedClient,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter((chunk) => chunk !== "")
    .join("\n");
  const structured = result.structuredContent;
  return {
    isError: result.isError === true,
    structured:
      typeof structured === "object" && structured !== null ? (structured as Record<string, unknown>) : undefined,
    text,
  };
}
