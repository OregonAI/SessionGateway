// Seam 1 (test/CLAUDE.md): the nightly hash sample (ticket #20, ADR-0005, ADR-0040). Each night the worker fetches
// stored documents again and compares their hashes with the stored ones, to catch a file replaced behind the same URL.
// What the operator reads is `hash-sample-report.json` beside the database (`system.hashSampleReport()`), as the build
// report is; what an agent reads is unchanged, through the tools: a mismatch is reported and never replaces the
// stored document (ADR-0002). When the sample runs is a table in src/packages/ingest/tests/schedule.test.ts.
//
// The system is a copy of the template for the whole fixture at 2026-08-01 10:00 Pacific (a Saturday; PDT, UTC-7), so
// the full pull is not in the test. `runSchedule` then runs the worker's loop through that Saturday evening and night:
// the sample falls at 5 pm, and the night that ends on Sunday 2026-08-02 is not a full-pull night under `weekly`.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System, type SystemOptions } from "../support/system.ts";

vi.setConfig({ testTimeout: 120_000 });

const started: System[] = [];

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

const clockAt = "2026-08-01T17:00:00Z";
// 1 am Sunday: the evening's sample (5 pm Saturday) is long over.
const afterTheSample = "2026-08-02T08:00:00Z";

async function start(options: Partial<SystemOptions> = {}): Promise<System> {
  const system = await startCopiedSystem({ clockAt, documents: true, ...options });
  started.push(system);
  return system;
}

// Expected values are the manifest's (test/fixtures/olis-2025R1/manifest.json): each file's sha256 and `source_url`.
const sb69Introduced = {
  id: "version-2025r1-sb69-introduced",
  sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
  path: "/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
  sha256: "a306d6c6bf7d1a16814d60bc731f7ef6d1be4dfd3198edcfab27feca14f34f99",
};
// The file OLIS swaps in behind SB 69's URL: HB 3131's Introduced Version, a different PDF.
const hb3131Introduced = {
  fixtureFile: "documents/measure-documents/HB3131/Introduced.pdf",
  sha256: "5d89358f208475667fa1113c3415de9ed83d8802e61d6019dcdd7be47f9dda29",
};

const hb3131Bytes = readFileSync(new URL(`../fixtures/olis-2025R1/${hb3131Introduced.fixtureFile}`, import.meta.url));

describe("a file replaced behind the same URL", () => {
  it("is reported with the document id, the source_url, the stored and the new hash, and when", async () => {
    const system = await start({ ingest: { hashSampleSize: "1000" } });
    system.olis.serveDocument(sb69Introduced.path, hb3131Bytes);

    await system.runSchedule(afterTheSample);

    expect(system.hashSampleReport()["mismatches"]).toEqual([
      {
        id: sb69Introduced.id,
        source_url: sb69Introduced.sourceUrl,
        stored_hash: sb69Introduced.sha256,
        new_hash: hb3131Introduced.sha256,
        checked_at: "2026-08-01T17:00:00-07:00",
      },
    ]);
  });
});

// The fixture holds 280 documents (test/CLAUDE.md, "Documents"; the manifest lists 281 files, one of them the Statutes
// Affected Table, which is not a feed document). A sample of 1000 therefore draws all of them.
const documentsInFixture = 280;

describe("a file that was not replaced", () => {
  it("reports no mismatch, and the sample ran once through the night, fetching each document once", async () => {
    const system = await start({ ingest: { hashSampleSize: "1000" } });

    await system.runSchedule(afterTheSample);

    expect(system.hashSampleReport()).toMatchObject({
      session: "2025R1",
      as_of: "2026-08-01T17:00:00-07:00",
      sample_size: 1000,
      sampled: documentsInFixture,
      checked: documentsInFixture,
      mismatches: [],
      not_checked: [],
    });
    // The loop woke every quarter hour from 5 pm to 1 am; the night's sample ran in the first of them.
    expect(system.olis.documentRequests()).toHaveLength(documentsInFixture);
  });
});

describe("a file replaced behind the same URL: what an agent reads", () => {
  it.for(eras)("is still the file the index fetched (%s client)", async (era) => {
    const system = await start({ ingest: { hashSampleSize: "1000" } });
    system.olis.serveDocument(sb69Introduced.path, hb3131Bytes);

    await system.runSchedule(afterTheSample);

    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "get_document", { id: sb69Introduced.id });
      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({
        content_hash: sb69Introduced.sha256,
        retrieved_at: "2026-08-01T10:00:00-07:00",
      });
      expect(String(outcome.structured?.["text"])).toContain("The Employment Department shall study issues");
    } finally {
      await connected.close();
    }
  });
});

describe("the size of the sample", () => {
  it("is 200 documents unless the deployment sets it (ADR-0005)", async () => {
    const system = await start();

    await system.runSchedule(afterTheSample);

    expect(system.hashSampleReport()).toMatchObject({ sample_size: 200, sampled: 200, checked: 200 });
    expect(system.olis.documentRequests()).toHaveLength(200);
  });

  it("is INGEST_HASH_SAMPLE_SIZE, and the documents drawn are the injected randomness's", async () => {
    // `random` is () => 0 by default: the first documents by id. The first three ids of the fixture are the HALNRW
    // agendas of 2025-01-22, 2025-01-27 and 2025-02-12 (the manifest's first three entries, in the same order).
    const system = await start({ ingest: { hashSampleSize: "3" } });

    await system.runSchedule(afterTheSample);

    expect(system.hashSampleReport()).toMatchObject({ sample_size: 3, sampled: 3, checked: 3 });
    expect([...system.olis.documentRequests()].toSorted()).toEqual([
      "/liz/2025R1/Downloads/CommitteeAgenda/HALNRW/2025-01-22-08-00",
      "/liz/2025R1/Downloads/CommitteeAgenda/HALNRW/2025-01-27-08-00",
      "/liz/2025R1/Downloads/CommitteeAgenda/HALNRW/2025-02-12-08-00",
    ]);
  });

  it.for([
    { random: 0, path: "/liz/2025R1/Downloads/CommitteeAgenda/HALNRW/2025-01-22-08-00" },
    { random: 0.999, path: "/liz/2025R1/Downloads/MeasureDocument/SB983/Introduced" },
  ])("draws the document the randomness picks ($random)", async ({ random, path }) => {
    // The first and the last document by id are the HALNRW agenda of 2025-01-22 and SB 983's Introduced Version.
    const system = await start({ ingest: { hashSampleSize: "1" }, random: () => random });

    await system.runSchedule(afterTheSample);

    expect(system.olis.documentRequests()).toEqual([path]);
  });
});

describe("a document OLIS will not give during the sample", () => {
  it("is reported as not checked, and is no mismatch", async () => {
    const system = await start({ ingest: { hashSampleSize: "1000" } });
    // The file is withdrawn: Not Found (the answer a withdrawn document gets in get-document-pull.test.ts).
    system.olis.failDocuments(sb69Introduced.sourceUrl, [404]);

    await system.runSchedule(afterTheSample);

    const report = system.hashSampleReport();
    expect(report).toMatchObject({ sampled: documentsInFixture, checked: documentsInFixture - 1, mismatches: [] });
    expect(report["not_checked"]).toEqual([
      {
        id: sb69Introduced.id,
        source_url: sb69Introduced.sourceUrl,
        reason: expect.stringContaining("404") as unknown,
      },
    ]);
  });
});

describe("every night", () => {
  it("samples again on the next night, and a restarted worker does not sample the same night twice", async () => {
    const system = await start({ ingest: { hashSampleSize: "1000", increments: "off" } });

    // Saturday evening to Sunday 1 am; then the worker restarts and runs on to 3 am: still the same night.
    await system.runSchedule(afterTheSample);
    await system.runSchedule("2026-08-02T10:00:00Z");
    expect(system.olis.documentRequests()).toHaveLength(documentsInFixture);

    // Sunday evening: the night that ends on Monday.
    await system.runSchedule("2026-08-03T08:00:00Z");
    expect(system.olis.documentRequests()).toHaveLength(2 * documentsInFixture);
    expect(system.hashSampleReport()["as_of"]).toBe("2026-08-02T17:00:00-07:00");
  });
});

describe("the night that holds the full pull", () => {
  it("samples in the evening and leaves midnight to 6 am to the full pull", async () => {
    // Friday 2026-08-07 at 10 am Pacific; the night that ends on Saturday 2026-08-08 is the weekly full-pull night.
    const system = await start({ clockAt: "2026-08-07T17:00:00Z", ingest: { hashSampleSize: "1000" } });

    await system.runSchedule("2026-08-08T14:00:00Z"); // 7 am Saturday

    expect(system.hashSampleReport()["as_of"]).toBe("2026-08-07T17:00:00-07:00");
    // The sample fetched each document once, and so did nothing in the small hours; the full pull ran after it. A
    // full pull is one count of Measures without a `gt datetime` filter (ingest-schedule.test.ts).
    expect(system.olis.documentRequests()).toHaveLength(documentsInFixture);
    const counts = system.olis.requests().filter((request) => request.entitySet === "Measures" && request.isCount);
    expect(counts.filter((request) => request.filter?.includes(" gt datetime") !== true)).toHaveLength(1);
  });
});

describe("the night window", () => {
  // Friday 2026-08-07 at 11:45 pm Pacific (PDT): the night that ends on Saturday holds the full pull, so the sample
  // has until midnight.
  const lateFriday = "2026-08-08T06:45:00Z";
  // Midnight Saturday: the run stops there, before the full pull begins.
  const midnight = "2026-08-08T07:00:00Z";

  it("closes between documents: none is fetched at or after the deadline, and the rest are reported as not checked", async () => {
    const system = await start({ clockAt: lateFriday, ingest: { hashSampleSize: "1000" } });
    system.everyRequestTakes(60_000);

    await system.runSchedule(midnight);

    // One minute for each document: the 15 fetched from 11:45 to 11:59 pm.
    expect(system.olis.documentRequests()).toHaveLength(15);
    const report = system.hashSampleReport();
    expect(report).toMatchObject({ sampled: documentsInFixture, checked: 15, mismatches: [] });
    const notChecked = report["not_checked"] as { reason: string }[];
    expect(notChecked).toHaveLength(documentsInFixture - 15);
    expect(notChecked.every((entry) => entry.reason.includes("night window closed"))).toBe(true);
  });

  it("closes in the middle of a fetch: a document OLIS is slow to give is stopped at the deadline", async () => {
    // 11:59:59.9 pm: the deadline is 100 ms away and OLIS never answers the first document. The fetch would
    // otherwise wait out its timeout and its retries, and hold the loop past midnight, when the full pull is due.
    const system = await start({ clockAt: "2026-08-08T06:59:59.900Z", ingest: { hashSampleSize: "1000" } });
    system.olis.failDocuments(
      "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeAgenda/HALNRW/2025-01-22-08-00",
      ["hang"],
    );
    const began = Date.now();

    await system.runSchedule(midnight);

    expect(Date.now() - began).toBeLessThan(10_000);
    expect(system.olis.documentRequests()).toHaveLength(1);
    const report = system.hashSampleReport();
    expect(report).toMatchObject({ sampled: documentsInFixture, checked: 0, mismatches: [] });
    const notChecked = report["not_checked"] as { reason: string }[];
    expect(notChecked).toHaveLength(documentsInFixture);
    expect(notChecked.every((entry) => entry.reason.includes("night window closed"))).toBe(true);
  });

  it("is judged by the clock after the increment, not before it", async () => {
    // Monday 2026-08-03 at 5:45 am: the night's daily increment is due, and OLIS takes 5 minutes to answer each of its
    // requests, so it ends after 6 am. The night is over by then, and no sample begins.
    const system = await start({
      clockAt: "2026-08-03T12:45:00Z",
      ingest: { hashSampleSize: "1000", increments: "daily" },
    });
    system.everyRequestTakes(5 * 60_000);

    await system.runSchedule("2026-08-03T14:00:00Z");

    expect(system.olis.documentRequests()).toEqual([]);
    expect(() => system.hashSampleReport()).toThrow();
  });
});

describe("a mismatch found on an earlier night", () => {
  const sb69Original = readFileSync(
    new URL("../fixtures/olis-2025R1/documents/measure-documents/SB69/Introduced.pdf", import.meta.url),
  );
  const foundOnTheFirstNight = {
    id: sb69Introduced.id,
    source_url: sb69Introduced.sourceUrl,
    stored_hash: sb69Introduced.sha256,
    new_hash: hb3131Introduced.sha256,
    checked_at: "2026-08-01T17:00:00-07:00",
  };
  // The first night is Saturday's, to 1 am; the second is Sunday's, to 1 am Monday.
  const secondNight = "2026-08-03T08:00:00Z";

  async function afterTheFirstNight(): Promise<System> {
    const system = await start({ ingest: { hashSampleSize: "1000", increments: "off" } });
    system.olis.serveDocument(sb69Introduced.path, hb3131Bytes);
    await system.runSchedule(afterTheSample);
    expect(system.hashSampleReport()["mismatches"]).toEqual([foundOnTheFirstNight]);
    return system;
  }

  it("stays in the report on a night that does not check that document", async () => {
    const system = await afterTheFirstNight();
    system.olis.failDocuments(sb69Introduced.sourceUrl, [404]);

    await system.runSchedule(secondNight);

    const report = system.hashSampleReport();
    expect(report).toMatchObject({ as_of: "2026-08-02T17:00:00-07:00", checked: documentsInFixture - 1 });
    expect(report["mismatches"]).toEqual([foundOnTheFirstNight]);
  });

  it("is dropped when a later night checks the document and finds the file as it was stored", async () => {
    const system = await afterTheFirstNight();
    system.olis.serveDocument(sb69Introduced.path, sb69Original);

    await system.runSchedule(secondNight);

    expect(system.hashSampleReport()["mismatches"]).toEqual([]);
  });

  it("is reported once, with the later night's time, when a later night checks it and the file still differs", async () => {
    const system = await afterTheFirstNight();

    await system.runSchedule(secondNight);

    expect(system.hashSampleReport()["mismatches"]).toEqual([
      { ...foundOnTheFirstNight, checked_at: "2026-08-02T17:00:00-07:00" },
    ]);
  });
});
