// Seam 1 at the process boundary: the two entry scripts in src/bin/, run as the deployment's two
// containers run them, with their configuration in the environment. The fake OLIS is the only
// thing in this process; the worker and the server are child processes.
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
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

/** The environment of a child: this and nothing else, plus PATH and the tests' own non-Pacific zone. */
function childEnvironment(env: Record<string, string>): Record<string, string> {
  return { PATH: process.env["PATH"] ?? "", TZ: process.env["TZ"] ?? "UTC", ...env };
}

/** Runs a script with exactly this environment, until it exits. */
function run(script: string, env: Record<string, string>): Promise<Finished> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: childEnvironment(env) });
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
      env: childEnvironment({ ...env, MCP_PORT: String(port) }),
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
    // The worker dated the pull with the system clock: Pacific time, an offset of -08:00 or -07:00.
    expect(outcome.structured?.["as_of"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/);
    expect(await exited).toBe(0);
  }, 20_000);

  describe("src/bin/server.ts logs", () => {
    /** Pulls into a fresh database, starts the server on a free port and waits until it listens. */
    async function runningServer(): Promise<{
      port: number;
      stdout: () => string;
      stderr: () => string;
      stop: () => Promise<number | null>;
    }> {
      const { olis, database } = await fakeOlisAndDatabase();
      const env = { SESSION_KEY: "2025R1", OLIS_BASE_URL: olis.baseUrl, DATABASE_PATH: database.path };
      const pulled = await run("src/bin/ingest.ts", env);
      expect(pulled.code, pulled.stderr).toBe(0);
      const port = await freePort();
      const child = spawn(process.execPath, ["src/bin/server.ts"], {
        env: childEnvironment({ ...env, MCP_PORT: String(port), MCP_PATH: "/session-gateway/mcp" }),
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
      const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
      cleanups.push(() => {
        child.kill("SIGKILL");
      });
      await listening(port);
      return {
        port,
        stdout: () => out,
        stderr: () => err,
        stop: () => {
          child.kill("SIGTERM");
          return exited;
        },
      };
    }

    /** Every line the server wrote to stdout, each parsed as JSON (a line that is not JSON throws). */
    function jsonLines(stdout: string): Record<string, unknown>[] {
      return stdout
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }

    it("as JSON lines on stdout, with nothing on stderr: where it listens", async () => {
      const server = await runningServer();

      await server.stop();

      expect(server.stderr()).toBe("");
      expect(jsonLines(server.stdout())[0]).toMatchObject({
        msg: "MCP server listening",
        port: server.port,
        path: "/session-gateway/mcp",
      });
    }, 20_000);

    it("an error the Node adapter reports as a JSON line with the error and its stack, not text on stderr", async () => {
      const server = await runningServer();

      // A client that hangs up in the middle of its request body: the adapter reports an error.
      const socket = connect(server.port, "127.0.0.1");
      await new Promise((resolve) => socket.once("connect", resolve));
      socket.write(
        "POST /session-gateway/mcp HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{",
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      socket.destroy();
      for (let wait = 0; wait < 50 && !server.stdout().includes('"level":50'); wait += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await server.stop();

      expect(server.stderr()).toBe("");
      const failure = jsonLines(server.stdout()).find((line) => line["level"] === 50);
      expect(failure).toMatchObject({ msg: "The MCP adapter reported an error", err: { message: "aborted" } });
      expect(String((failure?.["err"] as Record<string, unknown> | undefined)?.["stack"])).toContain("aborted");
    }, 20_000);

    /**
     * Resolves the moment the port accepts a connection: retries at once, where `listening` waits 50 ms.
     * The kernel accepts as soon as the server has bound the port, before Node has run the script's next line.
     */
    async function acceptsAtOnce(port: number): Promise<void> {
      for (;;) {
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
      }
    }

    it("a SIGTERM that arrives the moment the port accepts still ends it with exit code 0, after the listening line", async () => {
      // A supervisor that waits for the port may signal a server that is still starting up. Without a handler
      // registered yet, Node's default action ends the process by the signal, with nothing logged and no close.
      const { olis, database } = await fakeOlisAndDatabase();
      const env = { SESSION_KEY: "2025R1", OLIS_BASE_URL: olis.baseUrl, DATABASE_PATH: database.path };
      const pulled = await run("src/bin/ingest.ts", env);
      expect(pulled.code, pulled.stderr).toBe(0);

      for (let start = 1; start <= 5; start += 1) {
        const port = await freePort();
        const child = spawn(process.execPath, ["src/bin/server.ts"], {
          env: childEnvironment({ ...env, MCP_PORT: String(port) }),
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
        const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
          child.once("close", (code, signal) => {
            resolve({ code, signal });
          }),
        );
        cleanups.push(() => {
          child.kill("SIGKILL");
        });

        await acceptsAtOnce(port);
        child.kill("SIGTERM");

        expect(await exited, `start ${start}: how it ended`).toEqual({ code: 0, signal: null });
        expect(err, `start ${start}: stderr`).toBe("");
        expect(jsonLines(out)[0], `start ${start}: first stdout line`).toMatchObject({
          msg: "MCP server listening",
          port,
        });
      }
    }, 30_000);
  });

  // [script, variable, a value the variable must refuse]
  const badVariables: readonly (readonly [string, string, string])[] = [
    ["src/bin/ingest.ts", "SESSION_KEY", "not-a-session-key"],
    ["src/bin/ingest.ts", "OLIS_BASE_URL", "not a url at all"],
    ["src/bin/server.ts", "SESSION_KEY", "not-a-session-key"],
    ["src/bin/server.ts", "MCP_PORT", "seventy"],
    ["src/bin/server.ts", "MCP_PATH", "no-leading-slash"],
    ["src/bin/server.ts", "MCP_RATE_LIMIT", "plenty"],
    ["src/bin/server.ts", "MCP_RATE_WINDOW_SECONDS", "never"],
  ];

  it.for(badVariables)(
    "%s fails at start-up on a bad %s, naming the variable and never its value",
    { timeout: 20_000 },
    async ([script, variable, value]) => {
      const { olis, database } = await fakeOlisAndDatabase();
      const env = {
        SESSION_KEY: "2025R1",
        OLIS_BASE_URL: olis.baseUrl,
        DATABASE_PATH: database.path,
        [variable]: value,
      };

      const finished = await run(script, env);

      expect(finished.code).not.toBe(0);
      expect(finished.stderr).toContain(variable);
      expect(finished.stderr).not.toContain(value);
    },
  );

  it("src/bin/ingest.ts refuses a database that cannot run in WAL mode, instead of writing in another mode", async () => {
    // SQLite answers a request for WAL without an error and keeps the journal mode it had when it cannot
    // switch: an in-memory database is one such case, a filesystem without shared memory is another.
    const { olis } = await fakeOlisAndDatabase();
    const env = { SESSION_KEY: "2025R1", OLIS_BASE_URL: olis.baseUrl, DATABASE_PATH: ":memory:" };

    const finished = await run("src/bin/ingest.ts", env);

    expect(finished.code).not.toBe(0);
    expect(finished.stderr).toContain("WAL");
  }, 20_000);
});
