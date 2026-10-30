// Seam 1 at the process boundary: the two entry scripts in src/bin/, run as the deployment's two
// containers run them, with their configuration in the environment. The fake OLIS is the only
// thing in this process; the worker and the server are child processes.
import { spawn } from "node:child_process";
import { createServer, connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOlis, type FakeOlis } from "../support/fake-olis.ts";
import { createSimulatedClock } from "../support/clock.ts";
import { callTool, connectClientToUrl } from "../support/mcp-clients.ts";
import { createTempDatabase, type TempDatabase } from "../support/temp-database.ts";

type Finished = { code: number | null; stdout: string; stderr: string };

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Runs a script with exactly this environment (and Node's own PATH), until it exits. */
function run(script: string, env: Record<string, string>): Promise<Finished> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: { PATH: process.env["PATH"] ?? "", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise<void>((resolve) =>
    probe.close(() => {
      resolve();
    }),
  );
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function listening(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        resolve(false);
      });
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`nothing listens on port ${port}`);
}

async function fakeOlisAndDatabase(): Promise<{ olis: FakeOlis; database: TempDatabase }> {
  const olis = await startFakeOlis({ clock: createSimulatedClock("2025-07-15T17:00:00Z") });
  const database = createTempDatabase();
  cleanups.push(async () => {
    await olis.close();
    database.remove();
  });
  return { olis, database };
}

describe("the entry scripts", () => {
  it("serve what the worker pulled: ingest.ts, then server.ts, then a client on its port", async () => {
    const { olis, database } = await fakeOlisAndDatabase();
    const env = { SESSION_KEY: "2025R1", OLIS_BASE_URL: olis.baseUrl, DATABASE_PATH: database.path };

    const pulled = await run("src/bin/ingest.ts", env);
    expect(pulled.code, pulled.stderr).toBe(0);

    const port = await freePort();
    const server = spawn(process.execPath, ["src/bin/server.ts"], {
      env: { PATH: process.env["PATH"] ?? "", ...env, MCP_PORT: String(port) },
    });
    const exited = new Promise<number | null>((resolve) => server.once("close", resolve));
    cleanups.push(() => {
      server.kill("SIGKILL");
    });
    await listening(port);

    const connected = await connectClientToUrl("2026-07-28", new URL(`http://127.0.0.1:${port}/mcp`));
    const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });
    await connected.close();
    server.kill("SIGTERM");

    expect(outcome.structured).toMatchObject({ id: "measure-2025r1-sb69" });
    expect(await exited).toBe(0);
  });

  it("fail at start-up on a bad variable, naming the variable and never its value", async () => {
    const { olis, database } = await fakeOlisAndDatabase();

    const finished = await run("src/bin/ingest.ts", {
      SESSION_KEY: "not-a-session-key",
      OLIS_BASE_URL: olis.baseUrl,
      DATABASE_PATH: database.path,
    });

    expect(finished.code).not.toBe(0);
    expect(finished.stderr).toContain("SESSION_KEY");
    expect(finished.stderr).not.toContain("not-a-session-key");
  });
});
