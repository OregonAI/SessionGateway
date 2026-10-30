// Seam 1 (test/CLAUDE.md): what compare_amendment tells an agent about a Proposed Amendment, with the
// whole system behind it (ticket #13, spec #1 case (b)). A fake OLIS serves the committed fixture and its
// documents, the ingest worker pulls them into a database, and an MCP client calls the tool in-process,
// once as a 2026-07-28 client and once as a legacy one. One database serves every case in this file
// because none of them changes it; the cases that need a feed row the fixture lacks, or a file that
// failed to come, are in compare-amendment-pull.test.ts.
//
// Expected values are literals from outside the code: the fixture's feed rows
// (test/fixtures/olis-2025R1/feed/), the documents as `pdftotext` prints them
// (test/fixtures/olis-2025R1/documents/), the Statutes Affected Table
// (documents/reports/artables2025R1.pdf; docs/research/olis-odata.md §5) and the snapshot file
// (test/fixtures/oregonai-snapshot/snapshot.json).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 278 documents.
  // The simulated clock never moves, so the rate limit's window never ends; the cases make more calls than
  // the default 120 a minute together.
  system = await startSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

const proposedAmendmentUrl = (id: number): string =>
  `https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/${id}`;

describe.for(eras)("compare_amendment for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  describe("which amendment a call names", () => {
    // Spec #1 gives the citation forms ("SB 69-2", "HB 3795-A3") and the id form (`amendment-2025r1-sb69-2`);
    // get_measure takes "an id or citation" the same way.
    it.for([
      ["a citation", "SB 69-2", "amendment-2025r1-sb69-2"],
      ["a citation in lower case with no space after the prefix", "sb69-2", "amendment-2025r1-sb69-2"],
      ["a citation with spaces round the hyphen", " SB 69 - 2 ", "amendment-2025r1-sb69-2"],
      ["an id", "amendment-2025r1-sb69-2", "amendment-2025r1-sb69-2"],
      ["an id in capitals", "AMENDMENT-2025R1-SB69-2", "amendment-2025r1-sb69-2"],
      ["a citation with a letter in the number", "HB 3795-A3", "amendment-2025r1-hb3795-a3"],
      ["an id with a letter in the number", "amendment-2025r1-hb3795-a3", "amendment-2025r1-hb3795-a3"],
    ] as const)("takes %s", async ([, reference, id]) => {
      const outcome = await callTool(connected, "compare_amendment", { amendment: reference });

      expect(outcome.isError).toBe(false);
      expect((outcome.structured?.["amendment"] as { id: string }).id).toBe(id);
    });

    // Feed/CommitteeProposedAmendments.json has no -9 for SB 69, and SB 69 has no -A1; the other forms
    // name a Measure, a document and a Session that are not a Proposed Amendment of this deployment.
    it.for([
      ["an amendment the feed does not list", "SB 69-9"],
      ["an amendment of a Measure the feed does not list", "SB 99999-1"],
      ["a Measure's citation", "SB 69"],
      ["a Measure's id", "measure-2025r1-sb69"],
      ["a Version's id", "version-2025r1-sb69-introduced"],
      ["an amendment id of another Session", "amendment-2027r1-sb69-2"],
      ["text that is no reference", "the second amendment"],
    ] as const)("answers %s with an error that says what to give", async ([, reference]) => {
      const outcome = await callTool(connected, "compare_amendment", { amendment: reference });

      expect(outcome.isError).toBe(true);
      expect(outcome.text).toContain(reference);
      expect(outcome.text).toContain("SB 69-2");
      expect(outcome.text).toContain("amendment-2025r1-sb69-2");
    });
  });

  describe("the amendment", () => {
    // Feed/CommitteeProposedAmendments.json: SB 69's -2 has two rows, 26286 (Proposed at SLB's meeting of
    // 2025-01-28 08:00) and 26288 (Adopted at SLB's of 2025-01-30 08:00). Feed/Committees.json: SLB is
    // "Labor and Business". Times are Pacific, in January: -08:00.
    it("names SB 69-2, its Measure and the meetings it was posted to, with what the committee did at each", async () => {
      const outcome = await callTool(connected, "compare_amendment", { amendment: "SB 69-2" });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured?.["amendment"]).toEqual({
        id: "amendment-2025r1-sb69-2",
        number: "-2",
        measure_id: "measure-2025r1-sb69",
        postings: [
          {
            id: "posting-2025r1-26286",
            source_url: proposedAmendmentUrl(26286),
            meeting_id: "meeting-2025r1-slb-2025-01-28-0800",
            meeting_date: "2025-01-28T08:00:00-08:00",
            committee_code: "SLB",
            committee_name: "Labor and Business",
            meaning: "Proposed",
            fetched: true,
          },
          {
            id: "posting-2025r1-26288",
            source_url: proposedAmendmentUrl(26288),
            meeting_id: "meeting-2025r1-slb-2025-01-30-0800",
            meeting_date: "2025-01-30T08:00:00-08:00",
            committee_code: "SLB",
            committee_name: "Labor and Business",
            meaning: "Adopted",
            fetched: true,
          },
        ],
      });
    });
  });

  // SB 69's header (pdftotext of proposed-amendments/26286.pdf): "PROPOSED AMENDMENTS TO / SENATE BILL 69",
  // with no letter before the Measure, and its number "-2" has no letter either: both say Introduced.
  // Feed/MeasureDocuments.json lists SB 69's Introduced Version at .../MeasureDocument/SB69/Introduced.
  describe("the Version an amendment amends", () => {
    it("names SB 69's Introduced Version for SB 69-2", async () => {
      const outcome = await callTool(connected, "compare_amendment", { amendment: "SB 69-2" });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured?.["amended_version"]).toMatchObject({
        known: true,
        id: "version-2025r1-sb69-introduced",
        label: "Introduced",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
      });
    });
  });
});
