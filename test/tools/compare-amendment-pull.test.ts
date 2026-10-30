// Seam 1: what compare_amendment says when the evidence about the Version an amendment amends is missing or
// disagrees, when an amendment's postings hold different files, and when a file has no text layer or never
// came. The committed fixture has none of these (test/fixtures/CLAUDE.md: it is never edited by hand), so each
// case adds a feed row to the fake OLIS (`strayRows`), served with a fixture file (`strayDocuments`), or makes
// a fixture file fail (`documentFailures`). EVERY ROW IN `madeUp` IS MADE UP: its id (9900xx), its amendment number
// and the file it is served with are not the feed's. What is real is each file: it is a fixture document, and what
// compare_amendment reads of it is what it reads of the fixture's own. Cases that only read the fixture are in
// compare-amendment.test.ts. Every case runs once with a 2026-07-28 client and once with a legacy client.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

const clockAt = "2026-08-01T17:00:00Z";

// A case that builds its own system and serves the documents pulls the fixture's 278 files, about four seconds
// on its own and more with the other files' workers running beside it (the default is five).
vi.setConfig({ testTimeout: 60_000 });
const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads";

/** A made-up CommitteeProposedAmendments row, shaped like the feed's, posted to SLB's real meeting of 2025-01-30 08:00. */
function postingRow(id: number, amendmentNumber: string, fileUrl: string): Record<string, unknown> {
  return {
    ProposedAmendmentId: id,
    CommitteeAgendaItemId: 202165,
    SessionKey: "2025R1",
    CommitteeCode: "SLB",
    MeetingDate: "2025-01-30T08:00:00",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    AmendmentNumber: amendmentNumber,
    Meaning: "Proposed",
    ProposedAmendmentUrl: fileUrl,
    CreatedDate: "2025-01-23T16:00:00",
    ModifiedDate: null,
  };
}

type Amended = {
  known: boolean;
  id: string | null;
  label: string | null;
  reason: string;
  text_read: boolean | null;
  statute_links: unknown[];
};
type File = {
  posting_ids: string[];
  text_read: boolean;
  not_read_reason: string | null;
  statute_links: { kind: string; target_id: string; measure_section: string | null }[];
};
type Comparison = {
  amendment: { postings: { id: string; fetched: boolean }[] };
  amended_version: Amended;
  files: File[];
  deletions_note: string;
};

describe("amendments the fixture has no row for", () => {
  // SB 69-A9: a number that names A-Engrossed, on SB 69-2's file, whose header names Introduced.
  // SB 69-3: the file is SB 69's Introduced Version, which has no "PROPOSED AMENDMENTS TO" header.
  // SB 69-2 again, posted a third time with the file of SB 921-2 (header "SENATE BILL 921", Introduced).
  // SB 69-4: the file is a scan with no text layer (Exhibit 288141, the fixture's SB 64 scan).
  // SB 69-AB3: SB 69-2's file again, with a number that names no Version.
  const madeUp = [
    postingRow(990001, "-A9", `${root}/ProposedAmendment/26286`),
    postingRow(990002, "-3", `${root}/MeasureDocument/SB69/Introduced`),
    postingRow(990003, "-2", `${root}/ProposedAmendment/26923`),
    postingRow(990004, "-4", `${root}/ProposedAmendment/990004`),
    // The number "-AB3" names no Version in either form (digits alone, or one letter and digits).
    postingRow(990005, "-AB3", `${root}/ProposedAmendment/26286`),
  ];
  let system: System;

  beforeAll(async () => {
    system = await startSystem({
      clockAt,
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
      olis: {
        strayRows: { CommitteeProposedAmendments: madeUp },
        strayDocuments: { "/liz/2025R1/Downloads/ProposedAmendment/990004": "committee-meeting-documents/288141.pdf" },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await system.stop();
  });

  describe.for(eras)("for a %s client", (era) => {
    let connected: ConnectedClient;

    beforeAll(async () => {
      connected = await connectClient(era, system.handler);
    });

    afterAll(async () => {
      await connected.close();
    });

    async function compare(reference: string): Promise<Comparison> {
      const outcome = await callTool(connected, "compare_amendment", { amendment: reference });
      expect(outcome.isError).toBe(false);
      return outcome.structured as unknown as Comparison;
    }

    it("says the Version is not known when the header names Introduced and the number names A-Engrossed, and gives the amendment's own links and no comparison", async () => {
      const comparison = await compare("SB 69-A9");

      expect(comparison.amended_version).toEqual({
        known: false,
        id: null,
        label: null,
        source_url: null,
        reason:
          "The amendment's header names the Introduced Version but its number -A9 names the A-Engrossed Version, so which Version it amends is not known.",
        text_read: null,
        not_read_reason: null,
        statute_links: [],
      });
      // The file is SB 69-2's: its links are read all the same, and the deletions note is still there.
      expect(comparison.files.map((file) => file.posting_ids)).toEqual([["posting-2025r1-990001"]]);
      expect(comparison.files[0]?.statute_links[0]).toEqual(
        expect.objectContaining({ kind: "amends", target_id: "ors-657b.070", measure_section: "3" }),
      );
      expect(comparison.deletions_note).toContain("was not evaluated");
    });

    it("says the Version is not known when the file has no header, because nothing is guessed from the number alone", async () => {
      const comparison = await compare("SB 69-3");

      expect(comparison.amended_version.known).toBe(false);
      expect(comparison.amended_version.reason).toBe(
        'The header of the amendment\'s file (the line after "PROPOSED AMENDMENTS TO") could not be read, so which Version it amends is not known.',
      );
      expect(comparison.amended_version.statute_links).toEqual([]);
    });

    it("says the Version is not known when the number names no Version, however the header reads", async () => {
      // The citation form takes one letter and digits, so this amendment is asked for by its id.
      const comparison = await compare("amendment-2025r1-sb69-ab3");

      expect(comparison.amended_version.known).toBe(false);
      expect(comparison.amended_version.reason).toBe(
        "The amendment's number -AB3 names no Version (a number of digits alone names Introduced, and a letter names that engrossed Version), so which Version it amends is not known.",
      );
    });

    it("lists each distinct file of an amendment on its own with its posting ids, and picks none", async () => {
      const comparison = await compare("SB 69-2");

      // 26286 and 26288 share a file; the made-up posting 990003 is a different one, SB 921-2's, whose header
      // ("SENATE BILL 921") and the number "-2" both say Introduced.
      expect(comparison.files.map((file) => file.posting_ids)).toEqual([
        ["posting-2025r1-26286", "posting-2025r1-26288"],
        ["posting-2025r1-990003"],
      ]);
      expect(comparison.files[0]?.statute_links).toContainEqual(
        expect.objectContaining({ kind: "amends", target_id: "ors-653.616", measure_section: "8" }),
      );
      // SB 921-2 (pdftotext of proposed-amendments/26923.pdf): SECTION 1 refers to "ORS 285A.666 to ..."; nothing is amended.
      expect(comparison.files[1]?.statute_links).toContainEqual(
        expect.objectContaining({ kind: "cites", target_id: "ors-285a.666", measure_section: "1" }),
      );
      expect(comparison.files[1]?.statute_links.map((link) => link.kind)).not.toContain("amends");
      expect(comparison.amended_version).toMatchObject({ known: true, id: "version-2025r1-sb69-introduced" });
    });

    it("reports a file with no text layer as not read, with no links, and does not call the Version known", async () => {
      const comparison = await compare("SB 69-4");

      expect(comparison.files).toEqual([
        {
          posting_ids: ["posting-2025r1-990004"],
          text_read: false,
          not_read_reason:
            "This index did not read the file for Statute Links: it has no text layer (a scan or a photograph), or the index has not read it yet. The empty list does not mean the document has none.",
          statute_links: [],
          relating_clause_edits: [],
        },
      ]);
      expect(comparison.amended_version.known).toBe(false);
    });

    // The operator reads the same fact in the build report (spec #1, story 54): a posting with no text layer is on its list of
    // documents with no text layer, so the scan is chased and not read as an amendment with no Statute Links.
    it("puts the scan on the build report's list of documents with no text layer", () => {
      expect(system.buildReport()["documents_without_text_layer"]).toContainEqual({
        id: "posting-2025r1-990004",
        source_url: `${root}/ProposedAmendment/990004`,
      });
    });

    it("lists the postings of the amendments it was asked about, made up or not, and no others", async () => {
      expect((await compare("SB 69-A9")).amendment.postings.map((posting) => posting.id)).toEqual([
        "posting-2025r1-990001",
      ]);
    });
  });
});

describe("files that never came", () => {
  // HB 3795's A-Engrossed Version and both of SB 69-2's postings answer 404 (not found), which the worker does not
  // retry: the store then holds the other documents and not these.
  const aEngrossed = `${root}/MeasureDocument/HB3795/A-Engrossed`;
  let system: System;

  beforeAll(async () => {
    system = await startSystem({
      clockAt,
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
      olis: {
        documentFailures: {
          [aEngrossed]: [404],
          [`${root}/ProposedAmendment/26286`]: [404],
          [`${root}/ProposedAmendment/26288`]: [404],
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await system.stop();
  });

  describe.for(eras)("for a %s client", (era) => {
    let connected: ConnectedClient;

    beforeAll(async () => {
      connected = await connectClient(era, system.handler);
    });

    afterAll(async () => {
      await connected.close();
    });

    it("says HB 3795's A-Engrossed Version is not held, and still lists HB 3795-A3's own links", async () => {
      const outcome = await callTool(connected, "compare_amendment", { amendment: "HB 3795-A3" });

      expect(outcome.isError).toBe(false);
      const comparison = outcome.structured as unknown as Comparison;
      expect(comparison.amended_version).toMatchObject({
        known: false,
        id: null,
        reason:
          "The amendment's header and number both name the A-Engrossed Version of HB 3795, which this index does not hold.",
      });
      expect(comparison.files[0]?.statute_links[0]).toEqual(
        expect.objectContaining({ kind: "amends", target_id: "ors-418.808", measure_section: "2" }),
      );
    });

    it("lists SB 69-2's postings as not fetched and has no file to read, so the Version is not known", async () => {
      const outcome = await callTool(connected, "compare_amendment", { amendment: "SB 69-2" });

      expect(outcome.isError).toBe(false);
      const comparison = outcome.structured as unknown as Comparison;
      expect(comparison.amendment.postings.map((posting) => [posting.id, posting.fetched])).toEqual([
        ["posting-2025r1-26286", false],
        ["posting-2025r1-26288", false],
      ]);
      expect(comparison.files).toEqual([]);
      expect(comparison.amended_version).toMatchObject({
        known: false,
        reason:
          "This index holds no file of the amendment, so its header, which names the Version it amends, cannot be read.",
      });
    });
  });
});
