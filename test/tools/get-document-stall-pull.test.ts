// Seam 1: a document whose bytes keep coming is fetched however long it takes, and one whose bytes stop is given up on
// (ticket #167). 32 2026R1 documents got no file within three attempts of a 60-second total limit at every full pull
// (docs/research/olis-odata.md, section 9); the owner decided on 2026-11-11 that a document's download ends on a stall (no
// bytes for the stall limit) and not on a total time, under a generous overall cap. Each case builds its own system, because
// the pull and the fake's pacing are the subject. Every row and file is MADE UP and labelled so; no real document is sent
// slowly. The limits are small (a second or less) so a case takes a few seconds of real time: the worker's timers are real.
import { afterEach, describe, expect, it, vi } from "vitest";
import { madeUpPdf } from "../support/made-up-pdf.ts";
import { callTool, connectClient } from "../support/mcp-clients.ts";
import { startSystem, type System, type SystemOptions } from "../support/system.ts";
import { madeUpTestimonyRow, testimonyDownloadPath } from "../support/testimony.ts";

const started: System[] = [];

vi.setConfig({ testTimeout: 60_000 });

afterEach(async () => {
  for (const system of started.splice(0)) await system.stop();
});

async function start(options: SystemOptions): Promise<System> {
  const system = await startSystem(options);
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

type Entry = { id: string; source_url: string; reason: string; cause: string; bytes_received?: number };

function notFetched(system: System): Entry[] {
  return system.buildReport()["documents_not_fetched"] as Entry[];
}

// 2025-07-15 10:00 in Oregon, as the #116 cases in get-document-pull.test.ts: SB 983's made-up Testimony is filed by then.
const clockAt = "2025-07-15T17:00:00Z";
const slowId = 900121;
const slowUrl = `https://olis.oregonlegislature.gov${testimonyDownloadPath(slowId)}`;
// MADE UP: a one-page PDF, the file the slow Testimony links.
const slowFile = madeUpPdf([["MADE UP: testimony sent a little at a time"]]);

describe("a file that keeps sending past the stall limit as a total (ticket #167)", () => {
  // 12 pieces 150 ms apart: about 1.65 s in all, longer than the 1 s stall limit, with no gap of more than 150 ms.
  it("is stored, from one request, and the build report does not list it", async () => {
    const system = await start({
      clockAt,
      documentTimeoutMs: 1_000,
      olis: {
        madeUpRows: { CommitteePublicTestimonies: [madeUpTestimonyRow({ commTestId: slowId })] },
        madeUpDocuments: { [testimonyDownloadPath(slowId)]: slowFile },
        documentPacing: { [testimonyDownloadPath(slowId)]: { pieces: 12, everyMs: 150 } },
      },
    });

    const outcome = await getDocument(system, `testimony-2025r1-${String(slowId)}`);

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({ source_url: slowUrl, has_text_layer: true });
    expect(outcome.structured?.["text"]).toContain("MADE UP: testimony sent a little at a time");
    expect(system.olis.documentRequests().filter((path) => path === testimonyDownloadPath(slowId))).toHaveLength(1);
    expect(notFetched(system).map((entry) => entry.id)).not.toContain(`testimony-2025r1-${String(slowId)}`);
  });
});

describe("a file whose bytes stop (ticket #167)", () => {
  const stalledId = 900122;
  const stalledUrl = `https://olis.oregonlegislature.gov${testimonyDownloadPath(stalledId)}`;
  // MADE UP: the file the stalled Testimony links. Each of the three attempts sends its first 100 bytes and then nothing.
  const stalledFile = madeUpPdf([["MADE UP: testimony whose download stops part of the way"]]);

  it("is reported request_failed after three attempts, with the bytes received, and the pull goes on", async () => {
    expect(stalledFile.length).toBeGreaterThan(100);
    const stall = { stallAfter: 100 };
    const system = await start({
      clockAt,
      documentTimeoutMs: 300,
      olis: {
        madeUpRows: {
          CommitteePublicTestimonies: [stalledId, slowId].map((commTestId) => madeUpTestimonyRow({ commTestId })),
        },
        madeUpDocuments: {
          [testimonyDownloadPath(stalledId)]: stalledFile,
          [testimonyDownloadPath(slowId)]: slowFile,
        },
        documentFailures: { [stalledUrl]: [stall, stall, stall] },
      },
    });

    expect(notFetched(system).find((entry) => entry.id === `testimony-2025r1-${String(stalledId)}`)).toEqual({
      id: `testimony-2025r1-${String(stalledId)}`,
      source_url: stalledUrl,
      reason: expect.stringContaining("3 attempts") as unknown,
      cause: "request_failed",
      bytes_received: 100,
    });
    expect(system.olis.documentRequests().filter((path) => path === testimonyDownloadPath(stalledId))).toHaveLength(3);
    expect((await getDocument(system, `testimony-2025r1-${String(stalledId)}`)).isError).toBe(true);
    expect((await getDocument(system, `testimony-2025r1-${String(slowId)}`)).isError).toBe(false);
  });
});
