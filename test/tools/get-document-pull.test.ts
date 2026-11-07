// Seam 1: what get_document shows depends on what the worker fetched, and how often. The worker's
// requests are counted by the fake OLIS, and a test reads that count from the harness, never from the
// database. Cases here build their own system because the feed, the clock or the failures the fake
// gives are the thing under test; cases that only read are in get-document.test.ts.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";
import { madeUpTestimonyRow, testimonyDownloadPath } from "../support/testimony.ts";

const started: System[] = [];

// A case that serves the documents pulls the fixture's 314 files, about four seconds on its own and more
// with the other files' workers running beside it (as get-measure-analysis-pull.test.ts says).
vi.setConfig({ testTimeout: 60_000 });

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

// 2026-08-05 10:00 in Oregon: every row of the fixture exists by then (the latest, SRULES's Recording Log 317265, was created 2026-08-04).
const everything = "2026-08-05T17:00:00Z";

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
    expect(linkedPaths).toHaveLength(314);
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

describe("a row OLIS changes after its file was fetched", () => {
  // The file is unchanging (ADR-0005); its feed row is not: 12 of the fixture's 15 CommitteeProposedAmendments
  // rows and 80 of its 120 CommitteeMeetingDocuments rows carry a ModifiedDate, and SB 69-2's row 26288 was
  // created Proposed and is Adopted now. The fixture holds each row's final state, so the rows here are
  // added to the fake and changed between two pulls: the fake reads `strayRows` at every request.
  const clockAt = "2025-01-29T17:00:00Z";
  const olisRoot = "https://olis.oregonlegislature.gov/liz/2025R1";
  const postingUrl = `${olisRoot}/Downloads/ProposedAmendment/900005`;
  const testimonyUrl = `${olisRoot}/Downloads/PublicTestimonyDocument/900006`;

  /** The feed row of a posting of SB 69's -3 to SLB's meeting of 2025-01-28, which the committee only proposed. */
  function postingRow(): Record<string, unknown> {
    return {
      SessionKey: "2025R1",
      ProposedAmendmentId: 900005,
      CommitteeCode: "SLB",
      MeetingDate: "2025-01-28T08:00:00",
      MeasurePrefix: "SB",
      MeasureNumber: 69,
      AmendmentNumber: "-3",
      Meaning: "Proposed",
      ProposedAmendmentUrl: postingUrl,
    };
  }

  /** The feed row of a piece of Testimony on SB 69 to the same meeting. */
  function testimonyRow(): Record<string, unknown> {
    return {
      SessionKey: "2025R1",
      CommTestId: 900006,
      // The submitter and the position, which every row of the feed has and the OLIS client now reads (#14).
      SubmitterFirstName: "Made",
      SubmitterLastName: "Up",
      PositionOnMeasureId: 3983,
      CommitteeCode: "SLB",
      MeetingDate: "2025-01-28T08:00:00",
      DocumentDescription: "Testimony",
      MeasurePrefix: "SB",
      MeasureNumber: 69,
      DocumentUrl: olisRoot,
    };
  }

  function related(outcome: Awaited<ReturnType<typeof getDocument>>): [string, string, string | null][] {
    return (outcome.structured?.["related"] as { relation: string; id: string; meaning: string | null }[]).map(
      (node) => [node.relation, node.id, node.meaning],
    );
  }

  it("shows what the committee did at the meeting once the row says Adopted, without fetching the file again", async () => {
    const posting = postingRow();
    const system = await start({
      clockAt,
      documents: true,
      olis: {
        strayRows: { CommitteeProposedAmendments: [posting] },
        strayDocuments: { [new URL(postingUrl).pathname]: "proposed-amendments/26286.pdf" },
      },
    });
    expect(related(await getDocument(system, "amendment-2025r1-sb69-3"))).toContainEqual([
      "posted_to",
      "meeting-2025r1-slb-2025-01-28-0800",
      "Proposed",
    ]);

    posting["Meaning"] = "Adopted";
    await system.pullAgain();

    const outcome = await getDocument(system, "amendment-2025r1-sb69-3");
    expect(related(outcome)).toContainEqual(["posted_to", "meeting-2025r1-slb-2025-01-28-0800", "Adopted"]);
    expect(related(outcome)).not.toContainEqual(["posted_to", "meeting-2025r1-slb-2025-01-28-0800", "Proposed"]);
    expect(system.olis.documentRequests().filter((path) => path === new URL(postingUrl).pathname)).toHaveLength(1);
  });

  it("shows the label and the Measure a row names now, without fetching the file again", async () => {
    const testimony = testimonyRow();
    const system = await start({
      clockAt,
      documents: true,
      olis: {
        strayRows: { CommitteePublicTestimonies: [testimony] },
        strayDocuments: { [new URL(testimonyUrl).pathname]: "testimony/117165.pdf" },
      },
    });
    expect(await getDocument(system, "testimony-2025r1-900006")).toMatchObject({
      structured: { label: "Testimony" },
    });

    testimony["DocumentDescription"] = "Letter";
    testimony["MeasureNumber"] = 64;
    await system.pullAgain();

    const outcome = await getDocument(system, "testimony-2025r1-900006");
    expect(outcome.structured).toMatchObject({ label: "Letter" });
    expect(related(outcome).map(([relation, id]) => [relation, id])).toContainEqual(["measure", "measure-2025r1-sb64"]);
    expect(related(outcome).map(([relation, id]) => [relation, id])).not.toContainEqual([
      "measure",
      "measure-2025r1-sb69",
    ]);
    expect(system.olis.documentRequests().filter((path) => path === new URL(testimonyUrl).pathname)).toHaveLength(1);
  });
});

describe("a fake OLIS that serves no document files", () => {
  // The default for a test that reads no document. The feed is still the feed (spec #1, "Testing Decisions":
  // the rows with a CreatedDate up to the clock's time): at 2025-07-15 10:00 in Oregon the fixture holds
  // 12 Committees and 36 CommitteeMeetings, and the rows that link a document add up to 277 (25
  // MeasureDocuments, 34 MeasureAnalysisDocuments, 15 CommitteeProposedAmendments, 83 of the 86
  // CommitteeMeetingDocuments that are not Recording Logs, 84 CommitteePublicTestimonies, and 36 agendas) and 31 of
  // the 34 Recording Logs, the ones created by then (ticket #124): 308. The files are not there, so each of those is
  // left out and reported.
  it("still serves the committees and meetings, and reports each linked document as not fetched", async () => {
    const system = await start({ clockAt: "2025-07-15T17:00:00Z", documents: false });

    const connected = await connectClient("2026-07-28", system.handler);
    const overview = await callTool(connected, "session_overview", {});
    await connected.close();

    expect(overview.structured).toMatchObject({ counts: { committees: 12, meetings: 36, documents: 0 } });
    const notFetched = system.buildReport()["documents_not_fetched"] as { reason: string }[];
    expect(notFetched).toHaveLength(308);
    expect(notFetched[0]?.reason).toContain("404");
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
        cause: "request_failed",
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
        cause: "request_failed",
      },
    ]);
  });
});

describe("rows the fixture does not have", () => {
  // The fixture has no file that is not a PDF and no Proposed Amendment whose text changed between postings, and
  // its Recording Logs (ticket #124) are created from 2025-01-29 13:13 Pacific on, so none exists at this clock
  // (2025-01-29 09:00). A row for each is added to the fake feed, and the file it links is a fixture file served
  // under a path of its own. The expected values are the manifest's.
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
        cause: "unreadable_file",
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

describe("a file OLIS serves empty or broken, and a request OLIS does not answer (ticket #116)", () => {
  // 2025-07-15 10:00 in Oregon: every row of the fixture but eight exists (testimony-made-up.test.ts). Every row and
  // file here is MADE UP and labelled so; no real 2026R1 document is reproduced. The real cases are 56 Testimony
  // files of zero bytes and 2 files with invalid PDF structure (docs/research/olis-odata.md, section 9): a zero-byte
  // file has no text to put into a seam-2 table, so the case is at seam 1, on made-up rows (ADR-0046).
  const clockAt = "2025-07-15T17:00:00Z";
  const emptyId = 900101;
  const brokenId = 900102;
  const silentId = 900103;
  const olisRoot = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads";

  type Entry = { id: string; source_url: string; reason: string; cause?: string };

  /** MADE UP: three Testimony rows, filed under SB 983 as the other made-up rows are. */
  function arranged(): SystemOptions {
    return {
      clockAt,
      documents: false,
      documentTimeoutMs: 200,
      olis: {
        madeUpRows: {
          CommitteePublicTestimonies: [emptyId, brokenId, silentId].map((commTestId) =>
            madeUpTestimonyRow({ commTestId }),
          ),
        },
        madeUpDocuments: {
          // MADE UP: a file of zero bytes, as OLIS serves for 56 of 2026R1's Testimony.
          [testimonyDownloadPath(emptyId)]: new Uint8Array(0),
          // MADE UP: bytes that are no PDF at all.
          [testimonyDownloadPath(brokenId)]: new TextEncoder().encode("MADE UP: this is not a PDF file"),
        },
        documentFailures: { [`${olisRoot}/PublicTestimonyDocument/${silentId}`]: ["hang", "hang", "hang"] },
      },
    };
  }

  function entryOf(system: System, id: number): Entry {
    const entries = system.buildReport()["documents_not_fetched"] as Entry[];
    const found = entries.find((entry) => entry.id === `testimony-2025r1-${String(id)}`);
    if (found === undefined) throw new Error(`The build report has no entry for testimony ${String(id)}`);
    return found;
  }

  // Box 2 of the ticket: a reader of the report can tell a file OLIS served empty or unreadable (which may never
  // heal) from a request that got no answer (which can).
  it.for([
    ["a file of zero bytes is empty_file", emptyId, "empty_file"],
    ["bytes that are no PDF are unreadable_file", brokenId, "unreadable_file"],
    ["a request that times out three times is request_failed", silentId, "request_failed"],
  ] as const)("the build report says why: %s", async ([, id, cause]) => {
    const system = await start(arranged());

    expect(entryOf(system, id).cause).toBe(cause);
  });

  // Box 3 of the ticket: the answer says what is known, and does not promise the next pull fetches it.
  it("is answered by get_document for a Testimony whose file is empty with what is known: the file is empty", async () => {
    const system = await start(arranged());

    const outcome = await getDocument(system, `testimony-2025r1-${String(emptyId)}`);

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(`testimony-2025r1-${String(emptyId)}`);
    expect(outcome.text).toMatch(/file OLIS serves for it is empty/);
    expect(outcome.text).not.toMatch(/next pull|not yet|yet\./i);
  });

  // Box 4 of the ticket: a listed Version whose file is not held is a listed row with no file, not an unknown id. The
  // fixture's SB 69 Introduced is a real row; the failure is made up (the fake OLIS answers its download 404).
  it("is answered by get_document for a listed Version with no file as a listed row, not as an unknown id", async () => {
    const sb69Introduced = `${olisRoot}/MeasureDocument/SB69/Introduced`;
    const system = await start({
      clockAt: "2025-01-29T17:00:00Z",
      documentTimeoutMs: 200,
      olis: { documentFailures: { [sb69Introduced]: [404, 404, 404] } },
    });

    const outcome = await getDocument(system, "version-2025r1-sb69-introduced");

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("version-2025r1-sb69-introduced");
    expect(outcome.text).toMatch(/listed .*holds no file/);
    expect(outcome.text).not.toContain("No document");
    expect(outcome.text).not.toContain("Give a document id such as");
  });
});
