import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config.ts";
import { createMcpServer } from "../mcp.ts";
import { SessionStore } from "../store.ts";

// Local MCP clients (Claude Code, Claude Desktop) launch this over stdio.
// stdout carries the protocol, so log to stderr only.
const store = SessionStore.open(loadConfig().dbPath, { readOnly: true });
await createMcpServer(store).connect(new StdioServerTransport());
