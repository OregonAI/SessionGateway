// Seam 1 (test/CLAUDE.md): a document link whose free-text last segment holds a literal "#" or "?" (ticket #176). OLIS
// writes a MeasureDocuments DocumentUrl as `/MeasureDocument/{Prefix}{Number}/{VersionDescription}`, the description
// raw (docs/research/olis-odata.md section 4 and gotcha 10), so 2026R1's "Minority Report #2 to A-Engrossed" of HB 4116
// reached the worker with a bare "#". Parsed as it stood, the "#" began a fragment, and the worker asked OLIS for
// ".../Minority%20Report%20", another resource. The whole description belongs to the path, and so does a "?" in it.
//
// EVERY ROW HERE IS MADE UP and labelled so: two Versions of SB 983 whose descriptions hold a "#" and a "?", and their
// one-page PDFs, which the fake OLIS serves only at the percent-encoded paths (%23, %3F), so a truncated request gets a
// 404 and the document is not fetched. Which cases copy: none; the rows and how their links are fetched are the subject,
// so the system is built here, once, and only read.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { madeUpPdf } from "../support/made-up-pdf.ts";
import { callTool, connectClient, eras } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

vi.setConfig({ testTimeout: 60_000 });

// 2025-07-15 10:00 in Oregon: after both made-up rows were created.
const clockAt = "2025-07-15T17:00:00Z";
const olisRoot = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads";

/** MADE UP: a Version of SB 983 whose description holds a "#", as 2026R1's HB 4116 Minority Report #2 does. */
const madeUpHashVersion = {
  SessionKey: "2025R1",
  MeasurePrefix: "SB",
  MeasureNumber: 983,
  VersionDescription: "Minority Report #2 to A-Engrossed",
  DocumentUrl: `${olisRoot}/MeasureDocument/SB983/Minority Report #2 to A-Engrossed`,
  CreatedDate: "2025-06-05T17:06:32.163",
  ModifiedDate: null,
};

/** MADE UP: a Version of SB 983 whose description holds a "?". */
const madeUpQuestionVersion = {
  SessionKey: "2025R1",
  MeasurePrefix: "SB",
  MeasureNumber: 983,
  VersionDescription: "Minority Report? to A-Engrossed",
  DocumentUrl: `${olisRoot}/MeasureDocument/SB983/Minority Report? to A-Engrossed`,
  CreatedDate: "2025-06-05T17:07:32.163",
  ModifiedDate: null,
};

const hashPath = "/liz/2025R1/Downloads/MeasureDocument/SB983/Minority%20Report%20%232%20to%20A-Engrossed";
const questionPath = "/liz/2025R1/Downloads/MeasureDocument/SB983/Minority%20Report%3F%20to%20A-Engrossed";

describe.for(eras)("get_document on a made-up Version whose link holds a '#' or a '?', for a %s client", (era) => {
  let system: System;

  beforeAll(async () => {
    system = await startSystem({
      clockAt,
      documents: false,
      documentTimeoutMs: 200,
      olis: {
        madeUpRows: { MeasureDocuments: [madeUpHashVersion, madeUpQuestionVersion] },
        madeUpDocuments: {
          [hashPath]: madeUpPdf([["MADE UP minority report number 2 of SB 983, served at the %23 path."]]),
          [questionPath]: madeUpPdf([["MADE UP minority report of SB 983, served at the %3F path."]]),
        },
      },
    });
  });

  afterAll(async () => {
    await system.stop();
  });

  it.for([
    [
      "a '#'",
      "version-2025r1-sb983-minority-report-2-to-a-engrossed",
      `https://olis.oregonlegislature.gov${hashPath}`,
      "MADE UP minority report number 2 of SB 983, served at the %23 path.",
    ],
    [
      "a '?'",
      "version-2025r1-sb983-minority-report-to-a-engrossed",
      `https://olis.oregonlegislature.gov${questionPath}`,
      "MADE UP minority report of SB 983, served at the %3F path.",
    ],
  ] as const)("fetches the whole path of a link with %s and cites it whole", async ([, id, sourceUrl, text]) => {
    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "get_document", { id });

      expect(outcome.isError, outcome.text).toBe(false);
      expect(outcome.structured?.["source_url"]).toBe(sourceUrl);
      expect(String(outcome.structured?.["text"])).toContain(text);
    } finally {
      await connected.close();
    }
  });
});
