// Seam 1 at the process boundary: the two entry scripts in src/bin/, run as the deployment's two
// containers run them, with their configuration in the environment. The fake OLIS is the only
// thing in this process; the worker and the server are child processes.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOlis, type FakeOlis, type FakeOlisOptions } from "../support/fake-olis.ts";
import { createSimulatedClock } from "../support/clock.ts";
import { callTool, connectClientToUrl } from "../support/mcp-clients.ts";
import { memberSponsorRow } from "../support/sponsors.ts";
import { createTempDatabase, type TempDatabase } from "../support/temp-database.ts";
import { snapshotFixturePath } from "../support/oregonai-snapshot.ts";
import { modelPath } from "../support/real-embedder.ts";
import { modelLockPath, readModelLock } from "#/packages/embedder/lock.ts";

type Finished = { code: number | null; stdout: string; stderr: string };

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** The environment of a child: this and nothing else, plus PATH and the tests' own non-Pacific zone. */
function childEnvironment(env: Record<string, string>): Record<string, string> {
  return { PATH: process.env["PATH"] ?? "", TZ: process.env["TZ"] ?? "UTC", ...env };
}

/** Runs a script with exactly this environment, until it exits, or until `limitMs` have passed and it is killed (code null). */
function run(script: string, env: Record<string, string>, limitMs = 60_000): Promise<Finished> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, script.split(" "), { env: childEnvironment(env) });
    const timer = setTimeout(() => child.kill("SIGKILL"), limitMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Runs a script until `ready()` is true, sends it `signal`, and waits for it to end. `ready` is polled, so it reads the
 * fake OLIS's request log, never the child's output. A child that has not ended after `limitMs` is killed (code null).
 */
async function runUntilSignalled(
  script: string,
  env: Record<string, string>,
  ready: () => boolean,
  signal: NodeJS.Signals,
  limitMs = 60_000,
): Promise<Finished & { signal: NodeJS.Signals | null }> {
  const child = spawn(process.execPath, script.split(" "), { env: childEnvironment(env) });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, by) => {
      resolve({ code, signal: by });
    });
  });
  const deadline = Date.now() + limitMs;
  while (!ready() && Date.now() < deadline && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  child.kill(child.exitCode === null && ready() ? signal : "SIGKILL");
  const { code, signal: by } = await ended;
  return { code, signal: by, stdout, stderr };
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
  options: Omit<FakeOlisOptions, "clock" | "documents"> & { clockAt?: string; documents?: boolean } = {},
): Promise<{ olis: FakeOlis; database: TempDatabase }> {
  const { clockAt, documents, ...fakeOptions } = options;
  const olis = await startFakeOlis({
    clock: createSimulatedClock(clockAt ?? "2025-07-15T17:00:00Z"),
    documents: documents ?? false,
    ...fakeOptions,
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
    MODEL_PATH: modelPath(),
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

    const pulled = await run("src/bin/ingest.ts --once", env);
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
    // The server read the Measure from OLIS with the `fetch`, the base URL and the system clock the entry
    // script gave it, and dated the read.
    expect(outcome.structured?.["live_status"]).toMatchObject({
      source: "olis",
      lookup_failed: false,
      as_of: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/) as unknown,
      // The pull and the read see the same OLIS, so the block says the location is the top level's.
      location: { status: "unchanged" },
    });
    expect(await exited).toBe(0);
  });

  // Ticket #17, ADR-0039: the two rhythms are configuration, read through the config schema at start-up.
  describe.for([
    { script: "src/bin/ingest.ts", variable: "INGEST_INCREMENTS", bad: "hourly" },
    { script: "src/bin/ingest.ts", variable: "INGEST_FULL_PULL", bad: "fortnightly" },
    // Ticket #20, ADR-0040: the hash sample's size is the worker's alone.
    { script: "src/bin/ingest.ts", variable: "INGEST_HASH_SAMPLE_SIZE", bad: "lots" },
    { script: "src/bin/server.ts", variable: "INGEST_INCREMENTS", bad: "hourly" },
    { script: "src/bin/server.ts", variable: "INGEST_FULL_PULL", bad: "fortnightly" },
  ])("$script with $variable=$bad", ({ script, variable, bad }) => {
    it("fails at start-up, naming the variable and not its value", async () => {
      const { olis, database } = await fakeOlisAndDatabase();
      const env = { ...workerEnvironment(olis, database.path), [variable]: bad };

      const finished = await run(script, env);

      expect(finished.code).not.toBe(0);
      expect(finished.code).not.toBeNull();
      expect(finished.stderr).toContain(variable);
      expect(finished.stderr).not.toContain(bad);
    });
  });

  it("src/bin/ingest.ts writes the Legislator Codes it could not resolve to a report beside the database", async () => {
    // A sponsor row (SB 69) whose code has no Legislators row and no alias; the cache's real codes
    // all resolve, so the report would otherwise be empty.
    const stray = memberSponsorRow("900001", "Rep Fahey", "Chief", "1");
    const { olis, database } = await fakeOlisAndDatabase({ strayRows: { MeasureSponsors: [stray] } });
    const env = workerEnvironment(olis, database.path);

    const pulled = await run("src/bin/ingest.ts --once", env);

    expect(pulled.code, pulled.stderr).toBe(0);
    const report: unknown = JSON.parse(
      readFileSync(join(dirname(database.path), "unresolved-legislator-codes.json"), "utf8"),
    );
    expect(report).toEqual({
      session: "2025R1",
      // The worker dated the pull with the system clock, in Pacific time.
      as_of: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/) as unknown,
      unresolved_legislator_codes: [{ code: "Rep Fahey", references: [{ source: "MeasureSponsors", count: 1 }] }],
    });
  });

  it("fetch and serve documents: ingest.ts pulls from OLIS_DOCUMENT_ORIGIN, then server.ts serves the text", async () => {
    // The documents are served only because this test asks. The clock is 2025-01-10 13:30 Pacific, when the
    // feed had created six Introduced Versions: the worker here is the real one, which embeds every document
    // it stores with the real model, and a later clock would add SB 64's Testimony 117281 (395,000 characters).
    const { olis, database } = await fakeOlisAndDatabase({ clockAt: "2025-01-10T21:30:00Z", documents: true });
    const env = workerEnvironment(olis, database.path);

    const pulled = await run("src/bin/ingest.ts --once", env);
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
    // The server made its embedder from MODEL_PATH, and the worker embedded the Version with the same model.
    const searched = await callTool(connected, "search", { query: "job-protected leave from work" });
    await connected.close();
    server.kill("SIGTERM");

    // The text is SB 69's Introduced Version as `pdftotext -raw` prints it; the link is the feed row's.
    expect(outcome.structured).toMatchObject({
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
      has_text_layer: true,
    });
    expect(String(outcome.structured?.["text"])).toContain("SECTION 2. Section 1 of this 2025 Act is repealed");
    expect(overview.structured).toMatchObject({ session: "2025R1" });
    expect((searched.structured?.["results"] as { id: string; found_by: string[] }[])[0]).toMatchObject({
      id: "version-2025r1-sb69-introduced",
      found_by: ["keyword", "embedding"],
    });
    expect(await exited).toBe(0);
  }, 60_000);

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

    const finished = await run("src/bin/ingest.ts --once", env);

    // A bug or a failed install is not an outcome to report per document: the pull fails, and the
    // error says what broke and for which document.
    expect(finished.code).not.toBe(0);
    expect(finished.stderr).toContain("Serverless PDF.js bundle could not be resolved");
    expect(finished.stderr).toContain("version-2025r1-");
    expect(existsSync(join(dirname(database.path), "build-report.json"))).toBe(false);
  });

  describe("ingest.ts --once told to stop by a signal in the middle of the pull (ticket #113)", () => {
    // The worker is stopped as a container stop or a watchdog stops it. Its first pull stores the early fixture's
    // documents; the second is held up on a file OLIS never answers, and is stopped there.
    const clockAt = "2025-01-10T21:30:00Z";
    const hungPath = "/liz/2025R1/Downloads/PublicTestimonyDocument/900203";
    const hungUrl = `https://olis.oregonlegislature.gov${hungPath}`;

    async function pullThenStopDuringSecond(signal: NodeJS.Signals): Promise<{
      stopped: Awaited<ReturnType<typeof runUntilSignalled>>;
      held: number;
      reportPath: string;
    }> {
      const { olis, database } = await fakeOlisAndDatabase({
        clockAt,
        documents: true,
        strayDocuments: { [hungPath]: "testimony/117166.pdf" },
      });
      const env = workerEnvironment(olis, database.path);
      const first = await run("src/bin/ingest.ts --once", env);
      expect(first.code, first.stderr).toBe(0);
      const held = new Set(olis.documentRequests()).size;
      const reportPath = join(dirname(database.path), "unresolved-legislator-codes.json");
      rmSync(reportPath);
      // MADE UP: a Testimony row the feed does not list, whose file never comes.
      olis.addRows("CommitteePublicTestimonies", [
        {
          SessionKey: "2025R1",
          CommTestId: 900203,
          SubmitterFirstName: "Made",
          SubmitterLastName: "Up 900203",
          PositionOnMeasureId: 3983,
          CommitteeCode: "HALNRW",
          MeetingDate: "2025-01-22T08:00:00",
          DocumentDescription: "Testimony",
          MeasurePrefix: "HB",
          MeasureNumber: 3131,
          DocumentUrl: "https://olis.oregonlegislature.gov/liz/2025R1",
          CreatedDate: "2025-01-10T10:00:00",
          ModifiedDate: null,
        },
      ]);
      olis.failDocuments(hungUrl, ["hang"]);
      const stopped = await runUntilSignalled(
        "src/bin/ingest.ts --once",
        env,
        () => olis.documentRequests().includes(hungPath),
        signal,
      );
      return { stopped, held, reportPath };
    }

    it.for(["SIGTERM", "SIGINT"] as const)(
      "%s: exits 0 with one JSON line saying it stopped, how many documents the index holds and that the next pull fetches the rest",
      async (signal) => {
        const { stopped, held, reportPath } = await pullThenStopDuringSecond(signal);

        expect(stopped.code, stopped.stderr).toBe(0);
        const lines = stopped.stdout.split("\n").filter((line) => line !== "");
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0] ?? "")).toMatchObject({
          level: 30,
          signal,
          documentsStored: held,
          msg: `The full pull stopped on ${signal}; the index holds ${held} documents, and the next pull fetches the rest`,
        });
        // No stack trace anywhere, and no report: the list of unresolved codes would be incomplete.
        expect(stopped.stderr).toBe("");
        expect(stopped.stdout).not.toContain("AbortError");
        expect(existsSync(reportPath)).toBe(false);
      },
      90_000,
    );
  });

  describe("src/bin/server.ts logs", () => {
    /** Pulls into a fresh database, starts the server on a free port and waits until it listens. */
    async function runningServer(serverEnv: Record<string, string> = {}): Promise<{
      port: number;
      stdout: () => string;
      stderr: () => string;
      stop: () => Promise<number | null>;
    }> {
      const { olis, database } = await fakeOlisAndDatabase();
      const env = workerEnvironment(olis, database.path);
      const pulled = await run("src/bin/ingest.ts --once", env);
      expect(pulled.code, pulled.stderr).toBe(0);
      const port = await freePort();
      const child = spawn(process.execPath, ["src/bin/server.ts"], {
        env: childEnvironment({ ...env, MCP_PORT: String(port), MCP_PATH: "/session-gateway/mcp", ...serverEnv }),
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
    });

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
    });

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
      const env = workerEnvironment(olis, database.path);
      const pulled = await run("src/bin/ingest.ts --once", env);
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
    });

    it("a live lookup that fails, as a JSON line with the Measure and the error, while get_measure answers from the cache", async () => {
      // Nothing listens on this port, so the server's connection to "OLIS" is refused.
      const nothingListens = await freePort();
      const server = await runningServer({
        OLIS_BASE_URL: `http://127.0.0.1:${nothingListens}/odata/odataservice.svc/`,
      });
      const connected = await connectClientToUrl(
        "2026-07-28",
        new URL(`http://127.0.0.1:${server.port}/session-gateway/mcp`),
      );

      const outcome = await callTool(connected, "get_measure", { measure: "SB 69" });
      await connected.close();
      await server.stop();

      expect(outcome.isError).toBe(false);
      expect(outcome.structured?.["live_status"]).toMatchObject({
        source: "cache",
        lookup_failed: true,
        // The reason an agent reads says what went wrong, and leaves out the address that was refused.
        notice: expect.stringMatching(
          /live lookup of OLIS failed: the connection to OLIS failed \(ECONNREFUSED\)\./,
        ) as unknown,
      });
      expect(server.stderr()).toBe("");
      const failure = jsonLines(server.stdout()).find((line) => line["level"] === 40);
      expect(failure).toMatchObject({
        msg: "The live lookup of OLIS failed; get_measure answered from the cache",
        measure: { session: "2025R1", prefix: "SB", number: 69 },
        err: { message: expect.stringContaining("ECONNREFUSED") as unknown },
      });
    });
  });

  // [script, variable, a value the variable must refuse]
  const badVariables: readonly (readonly [string, string, string])[] = [
    ["src/bin/ingest.ts", "SESSION_KEY", "not-a-session-key"],
    ["src/bin/ingest.ts", "OLIS_BASE_URL", "not a url at all"],
    ["src/bin/ingest.ts", "OLIS_DOCUMENT_ORIGIN", "not a url at all"],
    ["src/bin/ingest.ts", "STATUTES_AFFECTED_TABLE_URL", "not a url at all"],
    ["src/bin/ingest.ts", "STATUTES_AFFECTED_TABLE_URL", "ftp://example.test/artables2025R1.pdf"],
    ["src/bin/server.ts", "SESSION_KEY", "not-a-session-key"],
    ["src/bin/server.ts", "OLIS_BASE_URL", "not a url at all"],
    ["src/bin/server.ts", "OLIS_LIVE_TIMEOUT_MS", "soon"],
    // Over the bound the lookup may take (30 seconds: half the 60 seconds an MCP client waits for a tool
    // by default, so the cache's answer still reaches it), and over what a Node timer can count (2^31 - 1
    // ms), which it would take for 1 ms.
    ["src/bin/server.ts", "OLIS_LIVE_TIMEOUT_MS", "30001"],
    ["src/bin/server.ts", "OLIS_LIVE_TIMEOUT_MS", "3000000000"],
    ["src/bin/ingest.ts", "MODEL_THREADS", "many"],
    ["src/bin/server.ts", "MCP_PORT", "seventy"],
    ["src/bin/server.ts", "MCP_PATH", "no-leading-slash"],
    ["src/bin/server.ts", "MCP_RATE_LIMIT", "plenty"],
    ["src/bin/server.ts", "MCP_RATE_WINDOW_SECONDS", "never"],
  ];

  it("src/bin/server.ts fails at start-up when OLIS_BASE_URL is missing, naming the variable", async () => {
    // The server reads OLIS for the live status of get_measure, so a deployment without it would answer
    // every call from the cache. It is refused at start-up instead (src/CLAUDE.md, "Configuration").
    const { database } = await fakeOlisAndDatabase();

    const finished = await run("src/bin/server.ts", { SESSION_KEY: "2025R1", DATABASE_PATH: database.path });

    expect(finished.code).not.toBe(0);
    expect(finished.stderr).toContain("OLIS_BASE_URL");
  });

  it.for(badVariables)(
    "%s fails at start-up on a bad %s, naming the variable and never its value",
    async ([script, variable, value]) => {
      const { olis, database } = await fakeOlisAndDatabase();
      const env = { ...workerEnvironment(olis, database.path), [variable]: value };

      const finished = await run(script, env);

      expect(finished.code).not.toBe(0);
      expect(finished.stderr).toContain(variable);
      expect(finished.stderr).not.toContain(value);
    },
  );

  it.for(["src/bin/ingest.ts", "src/bin/server.ts"])(
    "%s fails at start-up when MODEL_PATH is not set, naming the variable",
    async (script) => {
      const { olis, database } = await fakeOlisAndDatabase();
      const withoutModel: Record<string, string> = workerEnvironment(olis, database.path);
      delete withoutModel["MODEL_PATH"];

      const finished = await run(script, withoutModel);

      expect(finished.code).not.toBe(0);
      expect(finished.stderr).toContain("MODEL_PATH");
    },
  );

  it.for(["src/bin/ingest.ts", "src/bin/server.ts"])(
    "%s fails at start-up when the model's files are not where MODEL_PATH says, and says how to get them",
    async (script) => {
      const { olis, database } = await fakeOlisAndDatabase();
      const env = { ...workerEnvironment(olis, database.path), MODEL_PATH: "/nonexistent/model" };

      const finished = await run(script, env);

      expect(finished.code).not.toBe(0);
      expect(finished.stderr).toContain("npm run model:fetch");
      // The variable is named and its value never printed (src/CLAUDE.md, "Configuration and portability").
      expect(finished.stderr).toContain("MODEL_PATH");
      expect(finished.stderr).not.toContain("/nonexistent/model");
    },
  );

  // The files at MODEL_PATH are checked against the lock's sha256 before anything is loaded: vectors are kept under the
  // model id the lock names, and files that are not the pinned ones would store theirs under it (ADR-0026). The
  // directory is the pinned one but for one file, the onnx file linked to save copying 34 MB.
  describe.for([
    {
      problem: "a tokenizer.json that is not the pinned one",
      file: "tokenizer.json",
      change: (text: string): string => text.replace('"lowercase": true', '"lowercase": false'),
    },
    {
      problem: "a config.json changed without changing its size",
      file: "config.json",
      change: (text: string): string => text.replace("bert", "BERT"),
    },
    {
      problem: "a tokenizer.json cut off in the middle",
      file: "tokenizer.json",
      change: (text: string): string => text.slice(0, 1000),
    },
  ])("with $problem in MODEL_PATH", ({ file, change }) => {
    it.for(["src/bin/ingest.ts", "src/bin/server.ts"])(
      "%s fails at start-up, naming the file and the variable, and never the directory",
      async (script) => {
        const lock = readModelLock(modelLockPath);
        const directory = mkdtempSync(join(tmpdir(), "sg-model-"));
        cleanups.push(() => {
          rmSync(directory, { recursive: true, force: true });
        });
        for (const pinned of lock.files) {
          const target = join(directory, pinned.path);
          mkdirSync(dirname(target), { recursive: true });
          if (pinned.path === file) {
            const original = readFileSync(join(modelPath(), pinned.path), "utf8");
            const changed = change(original);
            expect(changed, "the change must alter the file").not.toBe(original);
            writeFileSync(target, changed);
          } else {
            symlinkSync(join(modelPath(), pinned.path), target);
          }
        }
        const { olis, database } = await fakeOlisAndDatabase();

        const finished = await run(
          script,
          { ...workerEnvironment(olis, database.path), MODEL_PATH: directory },
          20_000,
        );

        expect(finished.code, finished.stderr).toBe(1);
        expect(finished.stderr).toContain(file);
        expect(finished.stderr).toContain("MODEL_PATH");
        expect(finished.stderr).toContain("npm run model:fetch");
        expect(finished.stderr).not.toContain(directory);
      },
    );
  });

  it("src/bin/ingest.ts fails at start-up when SNAPSHOT_PATH is not set, naming the variable", async () => {
    const { olis, database } = await fakeOlisAndDatabase();
    const withoutSnapshot: Record<string, string> = workerEnvironment(olis, database.path);
    delete withoutSnapshot["SNAPSHOT_PATH"];

    const finished = await run("src/bin/ingest.ts --once", withoutSnapshot);

    expect(finished.code).not.toBe(0);
    expect(finished.stderr).toContain("SNAPSHOT_PATH");
  });

  it("src/bin/server.ts refuses to start on a database the worker has not opened yet, saying to start the worker first", async () => {
    // Ticket #95, ADR-0048. An empty file is an empty SQLite database, with no tables and no recorded version (0): the
    // state of a file the worker has not opened, and the server knows version 1. The files that the server refuses for
    // another version, or that do not exist, are seam-4 cases (database/tests/schema-version.test.ts); arranging a file
    // at a newer version here would take SQL.
    const { olis, database } = await fakeOlisAndDatabase();
    writeFileSync(database.path, "");

    const finished = await run("src/bin/server.ts", workerEnvironment(olis, database.path));

    expect(finished.code).toBe(1);
    // A failed start-up leaves Node's own uncaught-error text on stderr (src/CLAUDE.md, "Toolchain").
    expect(finished.stderr).toContain(database.path);
    expect(finished.stderr).toMatch(
      /no recorded schema version.*worker has not opened it yet.*start the ingest worker first/is,
    );
    expect(finished.stdout).not.toContain("MCP server listening");
  });

  it("src/bin/ingest.ts refuses a database that cannot run in WAL mode, instead of writing in another mode", async () => {
    // SQLite answers a request for WAL without an error and keeps the journal mode it had when it cannot
    // switch: an in-memory database is one such case, a filesystem without shared memory is another.
    const { olis } = await fakeOlisAndDatabase();
    const env = workerEnvironment(olis, ":memory:");

    const finished = await run("src/bin/ingest.ts --once", env);

    expect(finished.code).not.toBe(0);
    expect(finished.stderr).toContain("WAL");
  });
});
