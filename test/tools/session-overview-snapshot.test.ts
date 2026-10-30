// Seam 1 (test/CLAUDE.md): what session_overview tells an agent about the OregonAI snapshot the database
// was built with (ticket #10). The snapshot files here are MADE UP (test/support/made-up-snapshot.ts):
// each has a version of its own, so the test shows the version comes from the file the worker was given
// and not from the code. Each case builds its own database, because the cases change the snapshot.
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { loadIngestConfig } from "#/packages/config/index.ts";
import { runFullPull } from "#/packages/ingest/index.ts";
import { committedAliasFilePath, readLegislatorAliases } from "#/packages/legislators/aliases.ts";
import { createSimulatedClock } from "../support/clock.ts";
import { createFakeEmbedder } from "../support/fake-embedder.ts";
import { startFakeOlis } from "../support/fake-olis.ts";
import { callTool, connectClient, eras } from "../support/mcp-clients.ts";
import { createMadeUpSnapshot, type MadeUpSnapshot } from "../support/made-up-snapshot.ts";
import { startSystem, type System } from "../support/system.ts";
import { createTempDatabase } from "../support/temp-database.ts";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function madeUpSnapshot(version: Parameters<typeof createMadeUpSnapshot>[0] = {}): MadeUpSnapshot {
  const snapshot = createMadeUpSnapshot(version);
  cleanups.push(() => {
    snapshot.remove();
  });
  return snapshot;
}

async function start(snapshot: string): Promise<System> {
  const system = await startSystem({ clockAt: "2025-01-29T17:00:00Z", snapshot });
  cleanups.push(() => system.stop());
  return system;
}

describe.for(eras)("session_overview for a %s client", (era) => {
  it("reports the version of the snapshot the database was built with: the OregonAI repository, its commit and the commit's date", async () => {
    const snapshot = madeUpSnapshot({
      commit: "89abcdef0123456789abcdef0123456789abcdef",
      commitDate: "2026-03-04T05:06:07-08:00",
    });
    const system = await start(snapshot.path);

    const connected = await connectClient(era, system.handler);
    const outcome = await callTool(connected, "session_overview", {});
    await connected.close();

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({
      snapshot: {
        source: "executive-regulatory-frameworks",
        commit: "89abcdef0123456789abcdef0123456789abcdef",
        commit_date: "2026-03-04T05:06:07-08:00",
      },
    });
  });

  // An agent picks a tool by the description in the tool list (spec #1, story 56: "so that I know which
  // snapshot an answer used"), so the description has to say that session_overview is where the version is.
  it("says in the tool list that it reports which OregonAI snapshot the index was built with", async () => {
    const system = await start(madeUpSnapshot().path);

    const connected = await connectClient(era, system.handler);
    const { tools } = await connected.client.listTools();
    await connected.close();

    const description = tools.find((tool) => tool.name === "session_overview")?.description ?? "";
    expect(description).toContain("OregonAI snapshot");
    expect(description).toContain("commit");
  });
});

describe("a build with the committed snapshot fixture", () => {
  // The fixture is the real snapshot, trimmed, so its version is real: the executive-regulatory-frameworks
  // checkout at commit 58e1839d441addf3ac1e1748c91ce3de78d3f342, which `git log -1` there dates
  // 2026-09-13T12:36:19-07:00 (the checkout is behind origin/main, which the version shows).
  it("reports the version of the ERF checkout it was taken from", async () => {
    const system = await startSystem({ clockAt: "2025-01-29T17:00:00Z" });
    cleanups.push(() => system.stop());

    const connected = await connectClient("2026-07-28", system.handler);
    const outcome = await callTool(connected, "session_overview", {});
    await connected.close();

    expect(outcome.structured?.["snapshot"]).toEqual({
      source: "executive-regulatory-frameworks",
      commit: "58e1839d441addf3ac1e1748c91ce3de78d3f342",
      commit_date: "2026-09-13T12:36:19-07:00",
    });
  });
});

describe("the snapshot version", () => {
  it("is kept with the database: the file the worker read is not needed while serving", async () => {
    const snapshot = madeUpSnapshot({ commit: "fedcba9876543210fedcba9876543210fedcba98" });
    const system = await start(snapshot.path);
    rmSync(snapshot.path);

    const connected = await connectClient("2026-07-28", system.handler);
    const outcome = await callTool(connected, "session_overview", {});
    await connected.close();

    expect(outcome.structured).toMatchObject({ snapshot: { commit: "fedcba9876543210fedcba9876543210fedcba98" } });
  });

  it("is the one the latest full pull read", async () => {
    const snapshot = madeUpSnapshot({ commit: "1111111111111111111111111111111111111111" });
    const system = await start(snapshot.path);
    snapshot.rewrite({ commit: "2222222222222222222222222222222222222222", commitDate: "2026-04-05T06:07:08-07:00" });

    await system.pullAgain();

    const connected = await connectClient("2026-07-28", system.handler);
    const outcome = await callTool(connected, "session_overview", {});
    await connected.close();
    expect(outcome.structured).toMatchObject({
      snapshot: { commit: "2222222222222222222222222222222222222222", commit_date: "2026-04-05T06:07:08-07:00" },
    });
  });
});

describe("a build whose snapshot cannot be used", () => {
  it("fails, naming the file, when the snapshot file is not there", async () => {
    await expect(
      startSystem({ clockAt: "2025-01-29T17:00:00Z", snapshot: "/nonexistent/snapshot.json" }),
    ).rejects.toThrow('Could not read the OregonAI snapshot at "/nonexistent/snapshot.json"');
  });

  // ADR-0012: the worker reads the snapshot before it reads OLIS, so a build with no usable snapshot stops
  // at once and a failed build has not spent a pull on the feed. The fetch the worker is given records
  // what it was asked to reach, and a fake OLIS answers it as it would a real pull (F6).
  it("fails before it asks OLIS for anything when the snapshot file is not there", async () => {
    const clock = createSimulatedClock("2025-01-29T17:00:00Z");
    const olis = await startFakeOlis({ clock, documents: false });
    cleanups.push(() => olis.close());
    const database = createTempDatabase();
    cleanups.push(() => {
      database.remove();
    });
    const asked: string[] = [];
    const recordingFetch: typeof fetch = (input, init) => {
      asked.push(input instanceof Request ? input.url : String(input));
      return fetch(input, init);
    };
    const config = loadIngestConfig({
      SESSION_KEY: "2025R1",
      OLIS_BASE_URL: olis.baseUrl,
      DATABASE_PATH: database.path,
      OLIS_DOCUMENT_ORIGIN: olis.origin,
      SNAPSHOT_PATH: "/nonexistent/snapshot.json",
      MODEL_PATH: "/nonexistent/model",
    });

    await expect(
      runFullPull(config, {
        fetch: recordingFetch,
        clock,
        signal: AbortSignal.timeout(30_000),
        pause: () => Promise.resolve(),
        legislatorAliases: readLegislatorAliases(committedAliasFilePath),
        embedder: createFakeEmbedder(),
      }),
    ).rejects.toThrow('Could not read the OregonAI snapshot at "/nonexistent/snapshot.json"');

    expect(asked).toEqual([]);
  });

  it("fails and names the problem when the file is not a snapshot: its commit is not a commit SHA", async () => {
    // A made-up version whose commit is a branch name, not the 40 hexadecimal digits of a commit.
    const snapshot = madeUpSnapshot({ commit: "main" });

    await expect(startSystem({ clockAt: "2025-01-29T17:00:00Z", snapshot: snapshot.path })).rejects.toThrow(
      /version\.commit: must be a full 40-character commit SHA/,
    );
  });
});
