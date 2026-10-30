// Seam 1: what get_document shows depends on what the worker fetched, and how often. The worker's
// requests are counted by the fake OLIS, and a test reads that count from the harness, never from the
// database. Cases here build their own system because the feed, the clock or the failures the fake
// gives are the thing under test; cases that only read are in get-document.test.ts.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

async function start(options: SystemOptions): Promise<System> {
  const system = await startSystem({ documents: true, ...options });
  started.push(system);
  return system;
}

async function getDocument(system: System, id: string) {
  const connected = await connectClient("2026-07-28", system.handler);
  try {
    return await callTool(connected, "get_document", { id });
  } finally {
    await connected.close();
  }
}

// The documents the feed links, as the fixture's manifest lists them (test/fixtures/olis-2025R1/
// manifest.json): every entry with a feed row behind it. The Statutes Affected Table has none.
const manifest = JSON.parse(
  readFileSync(new URL("../fixtures/olis-2025R1/manifest.json", import.meta.url), "utf8"),
) as { documents: { source_url: string; linked_by: unknown[] }[] };
const linkedPaths = manifest.documents
  .filter((document) => document.linked_by.length > 0)
  .map((document) => new URL(document.source_url).pathname)
  .toSorted();

// 2026-08-01 10:00 in Oregon: every row of the fixture exists by then.
const everything = "2026-08-01T17:00:00Z";

describe("fetching each document once", () => {
  // One system for both cases: the second pull adds no document, so neither changes what the other reads.
  let system: System;

  beforeAll(async () => {
    system = await startSystem({ clockAt: everything, documents: true });
  }, 60_000);

  afterAll(async () => {
    await system.stop();
  });

  it("fetches every document the feed links, once each", () => {
    expect(linkedPaths).toHaveLength(278);
    expect(system.olis.documentRequests().toSorted()).toEqual(linkedPaths);
  });

  it("does not fetch a stored document again in a second pull", async () => {
    const second = await system.pullAgain();

    expect(second.documentsFetched).toBe(0);
    expect(system.olis.documentRequests().toSorted()).toEqual(linkedPaths);
  });
});

describe("a transient failure", () => {
  // 2025-01-29 09:00 in Oregon, the day before SLB heard SB 69 (spec #1, case (c)): few documents exist,
  // so each case pulls in a moment. SB 69's Introduced Version was posted on 2025-01-10.
  const clockAt = "2025-01-29T17:00:00Z";
  const sb69Introduced = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced";
  const sb69IntroducedPath = new URL(sb69Introduced).pathname;

  it.for([
    ["a request that times out", "hang"],
    ["a 503 answer", 503],
    ["a 504 answer", 504],
  ] as const)("is retried: %s", async ([, failure]) => {
    const system = await start({
      clockAt,
      documentTimeoutMs: 300,
      olis: { documentFailures: { [sb69Introduced]: [failure] } },
    });

    const outcome = await getDocument(system, "version-2025r1-sb69-introduced");

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({ source_url: sb69Introduced, has_text_layer: true });
    // One request failed and the next was answered: no more, since the answer is kept.
    expect(system.olis.documentRequests().filter((path) => path === sb69IntroducedPath)).toHaveLength(2);
  });
});

describe("a document that cannot be had", () => {
  const clockAt = "2025-01-29T17:00:00Z";
  const sb69Introduced = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced";
  const sb69IntroducedPath = new URL(sb69Introduced).pathname;

  function notFetched(system: System): unknown {
    return system.buildReport()["documents_not_fetched"];
  }

  it("is left out and reported when OLIS says it is not there, and the next pull fetches it", async () => {
    const system = await start({ clockAt, olis: { documentFailures: { [sb69Introduced]: [404] } } });

    const missing = await getDocument(system, "version-2025r1-sb69-introduced");
    const other = await getDocument(system, "version-2025r1-sb64-introduced");

    // Not a transient failure, so one request only; the pull went on to the other documents.
    expect(system.olis.documentRequests().filter((path) => path === sb69IntroducedPath)).toHaveLength(1);
    expect(missing.isError).toBe(true);
    expect(other.isError).toBe(false);
    expect(notFetched(system)).toEqual([
      {
        id: "version-2025r1-sb69-introduced",
        source_url: sb69Introduced,
        reason: expect.stringContaining("404") as unknown,
      },
    ]);

    await system.pullAgain();

    expect((await getDocument(system, "version-2025r1-sb69-introduced")).isError).toBe(false);
    expect(notFetched(system)).toEqual([]);
  });

  it("is given up on after three attempts that all time out, and the pull goes on", async () => {
    const system = await start({
      clockAt,
      documentTimeoutMs: 200,
      olis: { documentFailures: { [sb69Introduced]: ["hang", "hang", "hang"] } },
    });

    expect((await getDocument(system, "version-2025r1-sb69-introduced")).isError).toBe(true);
    expect((await getDocument(system, "version-2025r1-sb64-introduced")).isError).toBe(false);
    expect(system.olis.documentRequests().filter((path) => path === sb69IntroducedPath)).toHaveLength(3);
    expect(notFetched(system)).toEqual([
      {
        id: "version-2025r1-sb69-introduced",
        source_url: sb69Introduced,
        reason: expect.stringContaining("3 attempts") as unknown,
      },
    ]);
  });
});
