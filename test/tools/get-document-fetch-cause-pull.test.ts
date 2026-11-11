// Seam 1: get_document says what the worker last saw of a listed document whose file the index does not hold (ticket #168,
// ADR-0063, amending ADR-0059): that the file OLIS serves for it is empty, that it is not a readable PDF (with the worker's
// reason), or, for a request that got no file and for a document no attempt has reached, the general answer ADR-0059 decided.
// Each case builds its own system, because the pull and the files the fake serves are the subject; the cases that pull twice
// change the fake between the pulls. Every row and file is MADE UP and labelled so; no real 2026R1 document is reproduced
// (the real cases are docs/research/olis-odata.md, section 9). The fixture's own documents are off, as in the #116 cases of
// get-document-pull.test.ts, so a request for any other document is answered 404, except in the case whose second pull stores a
// file OLIS serves from then on (the fake's `serveDocument` serves only with the documents on).
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

// 2025-07-15 10:00 in Oregon: every row of the fixture but eight exists (testimony-made-up.test.ts).
const clockAt = "2025-07-15T17:00:00Z";
const olisOrigin = "https://olis.oregonlegislature.gov";
const emptyId = 900131;
const brokenId = 900132;
const silentId = 900133;
const testimonyId = (commTestId: number): string => `testimony-2025r1-${String(commTestId)}`;
/** ADR-0059's answer for an unheld Testimony when nothing more is known. */
const generalAnswer =
  "This index does not hold its file: OLIS may serve it empty or broken, a request for it may have failed, or a pull has not reached it yet.";

// MADE UP: bytes that are no PDF at all.
const notAPdf = new TextEncoder().encode("MADE UP: this is not a PDF file");

/** MADE UP: three Testimony rows on SB 983, one served empty, one served as no PDF, and one whose requests hang. */
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
        [testimonyDownloadPath(emptyId)]: new Uint8Array(0),
        [testimonyDownloadPath(brokenId)]: notAPdf,
      },
      documentFailures: { [`${olisOrigin}${testimonyDownloadPath(silentId)}`]: ["hang", "hang", "hang"] },
    },
  };
}

type Entry = { id: string; reason: string; cause: string };

function reportEntryOf(system: System, id: string): Entry {
  const entries = system.buildReport()["documents_not_fetched"] as Entry[];
  const found = entries.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`The build report has no entry for ${id}`);
  return found;
}

describe("an unheld Testimony, by what the worker last saw of its file (ticket #168)", () => {
  it("served empty, is answered that the file OLIS serves for it is empty", async () => {
    const system = await start(arranged());

    const outcome = await getDocument(system, testimonyId(emptyId));

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(
      `Testimony "${testimonyId(emptyId)}" is listed in the 2025R1 Session. This index does not hold its file: the file OLIS serves for it is empty.`,
    );
    expect(outcome.text).not.toContain("OLIS may serve it empty or broken");
    expect(outcome.text).not.toMatch(/next pull fetches|last pull|build report/i);
  });

  it("served as no PDF, is answered that it is not a readable PDF, with the worker's reason", async () => {
    const system = await start(arranged());
    const { cause, reason } = reportEntryOf(system, testimonyId(brokenId));
    expect(cause).toBe("unreadable_file");

    const outcome = await getDocument(system, testimonyId(brokenId));

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(
      `Testimony "${testimonyId(brokenId)}" is listed in the 2025R1 Session. This index does not hold its file: the file OLIS serves for it is not a readable PDF. The worker's reason: "${reason}"`,
    );
    expect(reason).toContain("The file is not a PDF the extractor can read");
    // No parenthesis inside a parenthesis, and no capital letter run on mid-sentence.
    expect(outcome.text).not.toMatch(/\([^)]*\(/);
    expect(outcome.text).not.toMatch(/ \(The /);
  });

  it("whose requests time out, is given the general answer: the request got no file, so nothing is known of the file", async () => {
    const system = await start(arranged());
    expect(reportEntryOf(system, testimonyId(silentId)).cause).toBe("request_failed");

    const outcome = await getDocument(system, testimonyId(silentId));

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(`Testimony "${testimonyId(silentId)}" is listed in the 2025R1 Session.`);
    expect(outcome.text).toContain(generalAnswer);
  });

  it("is answered by the latest attempt: served empty at one pull and refused 404 at the next, it gets the general answer", async () => {
    const system = await start(arranged());
    expect((await getDocument(system, testimonyId(emptyId))).text).toContain("the file OLIS serves for it is empty");

    system.olis.failDocuments(`${olisOrigin}${testimonyDownloadPath(emptyId)}`, [404, 404, 404]);
    await system.pullAgain();

    expect(reportEntryOf(system, testimonyId(emptyId)).cause).toBe("request_failed");
    expect((await getDocument(system, testimonyId(emptyId))).text).toContain(generalAnswer);
  });

  it("that OLIS later serves a readable file for is stored at the next pull and served, with no word of the old failure", async () => {
    // With the fixture's documents on, so that `serveDocument` replaces the made-up empty file at the second pull.
    const system = await start({ ...arranged(), documents: true });
    expect((await getDocument(system, testimonyId(emptyId))).text).toContain("the file OLIS serves for it is empty");

    // MADE UP: the file OLIS serves for the row from then on.
    system.olis.serveDocument(
      testimonyDownloadPath(emptyId),
      madeUpPdf([["MADE UP: testimony that OLIS serves at the second pull"]]),
    );
    await system.pullAgain();

    const outcome = await getDocument(system, testimonyId(emptyId));
    expect(outcome.isError).toBe(false);
    expect(outcome.structured?.["text"]).toContain("MADE UP: testimony that OLIS serves at the second pull");
    expect(outcome.text).not.toContain("is empty");
  });
});

describe("a listed Version with no file, by what the worker last saw of its file (ticket #168)", () => {
  // MADE UP: SB 983's "B-Engrossed", which the feed does not list, as in the #116 case of get-document-pull.test.ts.
  const versionId = "version-2025r1-sb983-b-engrossed";
  const downloadPath = "/liz/2025R1/Downloads/MeasureDocument/SB983/B-Engrossed";
  const madeUpVersion = {
    SessionKey: "2025R1",
    MeasurePrefix: "SB",
    MeasureNumber: 983,
    VersionDescription: "B-Engrossed",
    DocumentUrl: `${olisOrigin}${downloadPath}`,
    CreatedDate: "2025-06-05T17:06:32.163",
    ModifiedDate: null,
  };

  it.for([
    ["served empty", new Uint8Array(0), "the file OLIS serves for it is empty."],
    [
      "served as no PDF",
      notAPdf,
      "the file OLIS serves for it is not a readable PDF. The worker's reason: \"The file is not a PDF the extractor",
    ],
  ] as const)("%s, is answered as a listed row with what is known of its file", async ([, bytes, said]) => {
    const system = await start({
      clockAt,
      documents: false,
      documentTimeoutMs: 200,
      olis: { madeUpRows: { MeasureDocuments: [madeUpVersion] }, madeUpDocuments: { [downloadPath]: bytes } },
    });

    const outcome = await getDocument(system, versionId);

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(
      `The Version "${versionId}" is listed in the 2025R1 Session, and this index holds no file for it: ${said}`,
    );
  });
});
