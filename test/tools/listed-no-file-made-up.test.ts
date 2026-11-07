// Seam 1 (test/CLAUDE.md): get_document on a row the feed lists whose file the index does not hold, for the kinds other than
// Testimony and Version (ADR-0059, ticket #116). ADR-0017 answers a listed Testimony with an error that names the id; the
// same is true of every kind the feed lists before its file is fetched, so none is answered as an unknown id, which
// tells the agent that the id the tool handed out is malformed. The reader knows the row's kind; the id is not read for it.
//
// EVERY ROW HERE IS MADE UP and labelled so: an Exhibit (CommitteeMeetingDocumentId 900201, filed under SB 983 and
// HRULES's meeting of 2025-06-05) and a Printed Amendment (SB 983's "House Amendments to A-Engrossed"). The fake OLIS
// answers their downloads 404 (the files are off), so the worker lists them and holds no file. Which cases copy: none;
// the rows are the subject, so the system is built here, once, and only read.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

vi.setConfig({ testTimeout: 60_000 });

// 2025-07-15 10:00 in Oregon: every row of the fixture but eight exists (testimony-made-up.test.ts).
const clockAt = "2025-07-15T17:00:00Z";
const olisRoot = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads";

/** MADE UP: an Exhibit of HRULES's meeting of 2025-06-05, on SB 983. */
const madeUpExhibit = {
  CommitteeMeetingDocumentId: 900201,
  SessionKey: "2025R1",
  CommitteeCode: "HRULES",
  MeetingDate: "2025-06-05T08:00:00",
  ExhibitReference: null,
  ExhibitTitle: "MADE UP exhibit",
  Submitter: "MADE UP submitter",
  DocumentType: "Meeting Material",
  MeasurePrefix: "SB",
  MeasureNumber: 983,
  DocumentUrl: `${olisRoot}/CommitteeMeetingDocument/900201`,
  CreatedDate: "2025-06-05T16:19:17.2266922",
  ModifiedDate: null,
};

/** MADE UP: a Printed Amendment of SB 983. */
const madeUpPrintedAmendment = {
  SessionKey: "2025R1",
  MeasurePrefix: "SB",
  MeasureNumber: 983,
  VersionDescription: "House Amendments to A-Engrossed",
  DocumentUrl: `${olisRoot}/MeasureDocument/SB983/House-Amendments-to-A-Engrossed`,
  CreatedDate: "2025-06-05T17:06:32.163",
  ModifiedDate: null,
};

describe.for(eras)("get_document on a made-up listed row with no file, for a %s client", (era) => {
  let system: System;

  beforeAll(async () => {
    system = await startSystem({
      clockAt,
      documents: false,
      documentTimeoutMs: 200,
      olis: {
        madeUpRows: { CommitteeMeetingDocuments: [madeUpExhibit], MeasureDocuments: [madeUpPrintedAmendment] },
      },
    });
  });

  afterAll(async () => {
    await system.stop();
  });

  it.for([
    ["an Exhibit", "exhibit-2025r1-900201"],
    ["a Printed Amendment", "printed-amendment-2025r1-sb983-house-amendments-to-a-engrossed"],
  ] as const)("answers %s as a listed row that holds no file, not as an unknown id", async ([, id]) => {
    const connected = await connectClient(era, system.handler);
    try {
      const outcome = await callTool(connected, "get_document", { id });

      expect(outcome.isError).toBe(true);
      expect(outcome.text).toContain(`"${id}"`);
      expect(outcome.text).toMatch(/listed .*holds no file/);
      expect(outcome.text).not.toContain("No document");
      expect(outcome.text).not.toContain("Give a document id such as");
    } finally {
      await connected.close();
    }
  });
});
