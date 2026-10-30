// Seam 1 at the process boundary: the two entry scripts in src/bin/, run as the deployment's two
// containers run them, with their configuration in the environment. The fake OLIS is the only
// thing in this process; the worker and the server are child processes.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { connect, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOlis, type FakeOlis } from "../support/fake-olis.ts";
import { createSimulatedClock } from "../support/clock.ts";
import { callTool, connectClientToUrl } from "../support/mcp-clients.ts";
import { createTempDatabase, type TempDatabase } from "../support/temp-database.ts";
import { snapshotFixturePath } from "../support/oregonai-snapshot.ts";

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

async function fakeOlisAndDatabase(
  options: { clockAt?: string; documents?: boolean } = {},
): Promise<{ olis: FakeOlis; database: TempDatabase }> {
  const olis = await startFakeOlis({
    clock: createSimulatedClock(options.clockAt ?? "2025-07-15T17:00:00Z"),
    documents: options.documents ?? false,
  });
  const database = createTempDatabase();
  cleanups.push(async () => {
    await olis.close();
    database.remove();
  });
  return { olis, database };
}

/**
 * The worker's environment against this fake OLIS. The feed links documents on olis.oregonlegislature.gov;
 * OLIS_DOCUMENT_ORIGIN sends the worker to the fake instead, so no test reaches the real OLIS, whichever
 * rows the feed holds and whether or not the fake serves the files (test/CLAUDE.md, "Hermetic").
 */
function workerEnvironment(olis: FakeOlis, databasePath: string): Record<string, string> {
  return {
    SNAPSHOT_PATH: snapshotFixturePath,
    SESSION_KEY: "2025R1",
    OLIS_BASE_URL: olis.baseUrl,
    OLIS_DOCUMENT_ORIGIN: olis.origin,
    DATABASE_PATH: databasePath,
  };
}

describe("the entry scripts", () => {
  it("serve what the worker pulled: ingest.ts, then server.ts, then a client on its port", async () => {
    const { olis, database } = await fakeOlisAndDatabase();
    const env = workerEnvironment(olis, database.path);

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

  it("fetch and serve documents: ingest.ts pulls from OLIS_DOCUMENT_ORIGIN, then server.ts serves the text", async () => {
    // The documents are served only because this test asks.
    const { olis, database } = await fakeOlisAndDatabase({ clockAt: "2025-01-29T17:00:00Z", documents: true });
    const env = workerEnvironment(olis, database.path);

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
    const outcome = await callTool(connected, "get_document", { id: "version-2025r1-sb69-introduced" });
    const overview = await callTool(connected, "session_overview", {});
    await connected.close();
    server.kill("SIGTERM");

    // The text is SB 69's Introduced Version as `pdftotext -raw` prints it; the link is the feed row's.
    expect(outcome.structured).toMatchObject({
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
      has_text_layer: true,
    });
    expect(String(outcome.structured?.["text"])).toContain("SECTION 2. Section 1 of this 2025 Act is repealed");
    expect(overview.structured).toMatchObject({ session: "2025R1" });
    expect(await exited).toBe(0);
  }, 30_000);

  // A broken install of the extractor: Node cannot resolve "unpdf/pdfjs", the PDF.js bundle unpdf loads for
  // the first document. A resolve hook, passed in NODE_OPTIONS as a data: URL so that no file is needed,
  // throws for that specifier alone.
  const withoutPdfjsBundle = (() => {
    const registrar =
      'import { registerHooks } from "node:module"; registerHooks({ resolve(specifier, context, next) { if (specifier === "unpdf/pdfjs") throw new Error("the bundle is not installed"); return next(specifier, context); } });';
    return `--import=data:text/javascript,${encodeURIComponent(registrar)}`;
  })();

  it("ingest.ts stops and says why when the PDF extractor cannot load, and does not report every document as not a PDF", async () => {
    const { olis, database } = await fakeOlisAndDatabase({ clockAt: "2025-01-29T17:00:00Z", documents: true });
    const env = { ...workerEnvironment(olis, database.path), NODE_OPTIONS: withoutPdfjsBundle };

    const finished = await run("src/bin/ingest.ts", env);

    // A bug or a failed install is not an outcome to report per document: the pull fails, and the
    // error says what broke and for which document.
    expect(finished.code).not.toBe(0);
    expect(finished.stderr).toContain("Serverless PDF.js bundle could not be resolved");
    expect(finished.stderr).toContain("version-2025r1-");
    expect(existsSync(join(dirname(database.path), "build-report.json"))).toBe(false);
  }, 30_000);

  describe("src/bin/server.ts logs", () => {
    /** Pulls into a fresh database, starts the server on a free port and waits until it listens. */
    async function runningServer(): Promise<{
      port: number;
      stdout: () => string;
      stderr: () => string;
      stop: () => Promise<number | null>;
    }> {
      const { olis, database } = await fakeOlisAndDatabase();
      const env = workerEnvironment(olis, database.path);
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
  });

  // [script, variable, a value the variable must refuse]
  const badVariables: readonly (readonly [string, string, string])[] = [
    ["src/bin/ingest.ts", "SESSION_KEY", "not-a-session-key"],
    ["src/bin/ingest.ts", "OLIS_BASE_URL", "not a url at all"],
    ["src/bin/ingest.ts", "OLIS_DOCUMENT_ORIGIN", "not a url at all"],
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
      const env = { ...workerEnvironment(olis, database.path), [variable]: value };

      const finished = await run(script, env);

      expect(finished.code).not.toBe(0);
      expect(finished.stderr).toContain(variable);
      expect(finished.stderr).not.toContain(value);
    },
  );

  it("src/bin/ingest.ts fails at start-up when SNAPSHOT_PATH is not set, naming the variable", async () => {
    const { olis, database } = await fakeOlisAndDatabase();
    const withoutSnapshot: Record<string, string> = workerEnvironment(olis, database.path);
    delete withoutSnapshot["SNAPSHOT_PATH"];

    const finished = await run("src/bin/ingest.ts", withoutSnapshot);

    expect(finished.code).not.toBe(0);
    expect(finished.stderr).toContain("SNAPSHOT_PATH");
  }, 20_000);

  it("src/bin/ingest.ts refuses a database that cannot run in WAL mode, instead of writing in another mode", async () => {
    // SQLite answers a request for WAL without an error and keeps the journal mode it had when it cannot
    // switch: an in-memory database is one such case, a filesystem without shared memory is another.
    const { olis } = await fakeOlisAndDatabase();
    const env = workerEnvironment(olis, ":memory:");

    const finished = await run("src/bin/ingest.ts", env);

    expect(finished.code).not.toBe(0);
    expect(finished.stderr).toContain("WAL");
  }, 20_000);
});
