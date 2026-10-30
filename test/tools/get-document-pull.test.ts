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

describe("rows the fixture does not have", () => {
  // The fixture has no Recording Log, no file that is not a PDF, and no Proposed Amendment whose text
  // changed between postings. A row for each is added to the fake feed, and the file it links is a
  // fixture file served under a path of its own. The expected values are the manifest's.
  const olisRoot = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads";
  const recordingLogUrl = `${olisRoot}/CommitteeMeetingDocument/900001`;
  const corruptUrl = `${olisRoot}/MeasureDocument/SB69/Corrupt`;
  const revisedUrl = `${olisRoot}/ProposedAmendment/900002`;
  // Analysis documents whose Version label names no Version SB 69 has: "MRA" is a label olis-odata.md
  // gotcha 9 lists that no description maps to with certainty, and SB 69 has no C-Engrossed.
  const minorityLabelUrl = `${olisRoot}/MeasureAnalysisDocument/900003`;
  const missingVersionUrl = `${olisRoot}/MeasureAnalysisDocument/900004`;
  let system: System;

  beforeAll(async () => {
    system = await startSystem({
      clockAt: "2025-01-29T17:00:00Z",
      documents: true,
      olis: {
        strayRows: {
          CommitteeMeetingDocuments: [
            {
              SessionKey: "2025R1",
              CommitteeMeetingDocumentId: 900001,
              CommitteeCode: "SLB",
              MeetingDate: "2025-01-21T08:00:00",
              DocumentType: "Recording Log",
              MeasurePrefix: null,
              MeasureNumber: null,
              DocumentUrl: recordingLogUrl,
            },
          ],
          MeasureAnalysisDocuments: [
            {
              SessionKey: "2025R1",
              MeasureAnalysisId: "900003",
              CommittteCode: "SLB",
              DocumentType: "Fiscal Impact Statement",
              MeasurePrefix: "SB",
              MeasureNumber: 69,
              Version: "MRA",
              IsMinority: false,
              DocumentUrl: minorityLabelUrl,
            },
            {
              SessionKey: "2025R1",
              MeasureAnalysisId: "900004",
              CommittteCode: "SLB",
              DocumentType: "Fiscal Impact Statement",
              MeasurePrefix: "SB",
              MeasureNumber: 69,
              Version: "C",
              IsMinority: false,
              DocumentUrl: missingVersionUrl,
            },
          ],
          MeasureDocuments: [
            {
              SessionKey: "2025R1",
              MeasurePrefix: "SB",
              MeasureNumber: 69,
              VersionDescription: "Corrupt",
              DocumentUrl: corruptUrl,
              CreatedDate: "2025-01-10T13:20:19.467",
            },
          ],
          CommitteeProposedAmendments: [
            {
              SessionKey: "2025R1",
              ProposedAmendmentId: 900002,
              CommitteeCode: "SLB",
              MeetingDate: "2025-02-04T08:00:00",
              MeasurePrefix: "SB",
              MeasureNumber: 69,
              AmendmentNumber: "-1",
              Meaning: "Proposed",
              ProposedAmendmentUrl: revisedUrl,
            },
          ],
        },
        strayDocuments: {
          [new URL(recordingLogUrl).pathname]: "committee-meeting-documents/287879.pdf",
          // Not a PDF at all: the fixture's own list of Measures.
          [new URL(corruptUrl).pathname]: "../measures.txt",
          // SB 69-2's file, standing in for a -1 that was revised and posted again.
          [new URL(revisedUrl).pathname]: "proposed-amendments/26286.pdf",
          // SB 69's Fiscal Impact Statement, standing in for the two analysis documents.
          [new URL(minorityLabelUrl).pathname]: "measure-analysis-documents/85414.pdf",
          [new URL(missingVersionUrl).pathname]: "measure-analysis-documents/85414.pdf",
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await system.stop();
  });

  it("makes a Recording Log of a CommitteeMeetingDocuments row of that type, which is not an Exhibit", async () => {
    const outcome = await getDocument(system, "recording-log-2025r1-900001");

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({
      kind: "recording_log",
      label: "Recording Log",
      source_url: recordingLogUrl,
    });
    expect((await getDocument(system, "exhibit-2025r1-900001")).isError).toBe(true);
  });

  it.for([
    ["a label no description maps to with certainty (MRA)", "analysis-2025r1-900003"],
    ["a label whose Version the Measure does not have (C, with no C-Engrossed)", "analysis-2025r1-900004"],
  ] as const)("points an analysis document at no Version when its Version is %s", async ([, id]) => {
    const outcome = await getDocument(system, id);

    expect(outcome.isError).toBe(false);
    const related = (outcome.structured?.["related"] as { id: string; relation: string }[]).map(
      (node) => [node.relation, node.id] as const,
    );
    expect(related.toSorted()).toEqual(
      [
        ["measure", "measure-2025r1-sb69"],
        ["committee", "committee-2025r1-slb"],
      ].toSorted(),
    );
  });

  it("reports a file that is not a PDF instead of failing the pull", async () => {
    expect((await getDocument(system, "version-2025r1-sb69-corrupt")).isError).toBe(true);
    expect((await getDocument(system, "version-2025r1-sb69-introduced")).isError).toBe(false);
    expect(system.buildReport()["documents_not_fetched"]).toEqual([
      {
        id: "version-2025r1-sb69-corrupt",
        source_url: corruptUrl,
        reason: expect.stringMatching(/not a PDF/i) as unknown,
      },
    ]);
  });

  it("keeps the text of each posting when it differs, and serves the latest under the amendment's id", async () => {
    const node = await getDocument(system, "amendment-2025r1-sb69-1");
    const first = await getDocument(system, "posting-2025r1-26284");

    // The latest posting is the one to the later meeting, with the revised file.
    expect(node.structured).toMatchObject({
      document_id: "posting-2025r1-900002",
      content_hash: "7aa1301569fee7620b2b050fe096567160cf692b2efe6b0edba4c89779c4e10b",
    });
    // The first posting is still there, with the text it had.
    expect(first.structured).toMatchObject({
      content_hash: "c58e10ef692899f88e4d595727d739117b5893775527c09737441b5d95e57fe3",
    });
    expect(first.structured?.["text"]).not.toBe(node.structured?.["text"]);
  });
});
