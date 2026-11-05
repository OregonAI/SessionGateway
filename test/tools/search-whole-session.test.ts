// Seam 1 (test/CLAUDE.md): `search` over the whole committed fixture, as the feed stood on 2026-08-05, when
// every row of it exists. Citations, the size of an answer and the hits' ids need the Measures and
// Proposed Amendments that come late in the Session, and the whole fixture holds SB 64's Testimony 117281
// (395,000 characters), which the real model would take half a minute to embed. None of these cases is about
// how well a meaning ranks, so the embedder is the fake (test/support/fake-embedder.ts); the cases that are
// use the real model on an early clock (search.test.ts, search-keyword-only.test.ts).
//
// The citation cases are about which documents a citation names, and that does not depend on meaning: the
// ranking of an exact citation reads the stored citations and the Measure and amendment ids, never a vector. The
// fake is the real tokenizer over a fake session, so the documents are cut into the passages production cuts
// (the cuts decide which citations a passage boundary splits), and that is why it is enough here.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates). It covers the citations, the citations the index does not hold, the size of an answer and
// the values of a hit.
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  system = await startCopiedSystem({
    clockAt: "2026-08-05T17:00:00Z",
    documents: true,
    // About a hundred and twenty calls are made on the one simulated clock (the cases run for two MCP clients): the
    // default ceiling is 120 a minute.
    serverEnv: { MCP_RATE_LIMIT: "100000" },
  });
}, 120_000);

afterAll(async () => {
  await system.stop();
});

type Hit = {
  id: string;
  document_id: string;
  kind: string;
  title: string;
  measure: string | null;
  date: string | null;
  snippet: string;
  source_url: string;
  found_by: string[];
};
const hitsOf = (outcome: { structured: Record<string, unknown> | undefined }): Hit[] =>
  outcome.structured?.["results"] as Hit[];

describe.for(eras)("search over the whole fixture for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  describe("an exact citation", () => {
    // SB 69's -2 was posted to SLB's meetings of 2025-01-28 (CommitteeProposedAmendments row 26286, Proposed) and
    // 2025-01-30 (row 26288, Adopted), a file for each. It is one node, whose text is the later posting's.
    it("of a Proposed Amendment puts the amendment first, once, however many meetings it was posted to", async () => {
      const outcome = await callTool(connected, "search", { query: "SB 69-2" });

      expect(hitsOf(outcome)[0]).toMatchObject({
        id: "amendment-2025r1-sb69-2",
        document_id: "posting-2025r1-26288",
        kind: "proposed_amendment",
        title: "SB 69-2",
        measure: "measure-2025r1-sb69",
      });
      expect(hitsOf(outcome).filter((hit) => hit.id === "amendment-2025r1-sb69-2")).toHaveLength(1);
      expect(hitsOf(outcome).filter((hit) => hit.id.startsWith("posting-"))).toEqual([]);
    });

    // HB 3795's MeasureDocuments rows: Introduced (created 2025-02-26), A-Engrossed (04-07), B-Engrossed (05-27) and
    // Enrolled (06-16), and Printed Amendments "House Amendments to Introduced" and "Senate Amendments to
    // A-Engrossed", which are not Versions.
    it("of a Measure puts its Versions first, from Introduced to Enrolled", async () => {
      const outcome = await callTool(connected, "search", { query: "HB 3795" });

      expect(
        hitsOf(outcome)
          .map((hit) => hit.id)
          .slice(0, 4),
      ).toEqual([
        "version-2025r1-hb3795-introduced",
        "version-2025r1-hb3795-a-engrossed",
        "version-2025r1-hb3795-b-engrossed",
        "version-2025r1-hb3795-enrolled",
      ]);
    });

    // `pdftotext -raw` finds "ORS 418.808" (and not a longer number) in these documents of the fixture: HB 3795's
    // B-Engrossed and Enrolled Versions and its Printed Amendment "Senate Amendments to A-Engrossed", Staff Measure
    // Summary 92329, Exhibits 305864 and 306030, the three postings of Proposed Amendment -A3 (28997, 29108 and
    // 29109: one node) and Testimony 209256 and 209569. The Statutes Affected Table holds "418.808" with no "ORS"
    // before it, and is linked by no feed row.
    const holding = [
      "amendment-2025r1-hb3795-a3",
      "analysis-2025r1-92329",
      "exhibit-2025r1-305864",
      "exhibit-2025r1-306030",
      "printed-amendment-2025r1-hb3795-senate-amendments-to-a-engrossed",
      "version-2025r1-hb3795-b-engrossed",
      "version-2025r1-hb3795-enrolled",
    ];

    it("of an ORS section puts the documents whose text holds it first, and leaves Testimony for those who ask", async () => {
      const general = await callTool(connected, "search", { query: "ORS 418.808" });
      const withLetters = await callTool(connected, "search", { query: "ORS 418.808", include_testimony: true });

      expect(
        hitsOf(general)
          .slice(0, holding.length)
          .map((hit) => hit.id)
          .toSorted(),
      ).toEqual(holding);
      expect(
        hitsOf(general)
          .slice(0, holding.length)
          .every((hit) => hit.found_by.includes("citation")),
      ).toBe(true);
      expect(
        hitsOf(withLetters)
          .slice(0, holding.length + 2)
          .map((hit) => hit.id)
          .toSorted(),
      ).toEqual([...holding, "testimony-2025r1-209256", "testimony-2025r1-209569"].toSorted());
    });
  });

  // A passage ends at a line end, and a PDF breaks its lines wherever the page is full, so a citation can be cut in two:
  // "ORS" ends one passage and the number begins the next. A document holds the citation all the same, so it is an
  // exact match over the document's whole text and not passage by passage (ADR-0025). The fake embedder cuts the
  // passages where the real model's tokenizer does (test/support/fake-embedder.ts), so these cuts are production's;
  // which documents a citation names does not depend on meaning, which is why the fake is enough here.
  //
  // `pdftotext -raw` with white space folded finds "ORS 192.245" in eight documents of the fixture, HB 3795's
  // Introduced, A-Engrossed, B-Engrossed and Enrolled Versions and its Printed Amendment "House Amendments to
  // Introduced", SB 69's and SB 921's Introduced Versions and Proposed Amendment 27966 (HB 3795-1); and
  // "ORS 279C.800" in five nodes, SB 69's A-Engrossed and Enrolled Versions, its Printed Amendment "Senate Amendments
  // to Introduced" and the postings of its Proposed Amendments -1 (26284, 26285, 26287) and -2 (26286, 26288). In HB 3795's
  // Enrolled Version the text reads "in the manner provided in ORS" and then, on the next line, "192.245", and in SB 69's
  // Enrolled Version "279C.800" starts a line.
  describe("an exact citation of an ORS section that a passage boundary cuts in two", () => {
    test.for([
      {
        section: "ORS 192.245",
        holding: [
          "amendment-2025r1-hb3795-1",
          "printed-amendment-2025r1-hb3795-house-amendments-to-introduced",
          "version-2025r1-hb3795-a-engrossed",
          "version-2025r1-hb3795-b-engrossed",
          "version-2025r1-hb3795-enrolled",
          "version-2025r1-hb3795-introduced",
          "version-2025r1-sb69-introduced",
          "version-2025r1-sb921-introduced",
        ],
      },
      {
        section: "ORS 279C.800",
        holding: [
          "amendment-2025r1-sb69-1",
          "amendment-2025r1-sb69-2",
          "printed-amendment-2025r1-sb69-senate-amendments-to-introduced",
          "version-2025r1-sb69-a-engrossed",
          "version-2025r1-sb69-enrolled",
        ],
      },
    ])(
      "$section puts every document that holds it first, the Enrolled Version included",
      async ({ section, holding }) => {
        const outcome = await callTool(connected, "search", { query: section });

        const first = hitsOf(outcome).slice(0, holding.length);
        expect(first.map((hit) => hit.id).toSorted()).toEqual(holding);
        expect(first.filter((hit) => !hit.found_by.includes("citation")).map((hit) => hit.id)).toEqual([]);
      },
    );
  });

  // A citation that names nothing the index holds. SB 69's Proposed Amendments are -1 and -2: the feed has no -3 and no
  // -21 (CommitteeProposedAmendments rows 26284-26288), there is no HB 9999 in Measures, and no document of the fixture
  // names ORS 999.999 (`pdftotext -raw` finds none). The result says so and puts nothing first; a citation's own
  // numbers are not loose keywords, so "3" and "21" match nothing on their own (the PDFs' margins number their lines).
  describe("a citation that names nothing the index holds", () => {
    test.for([
      { query: "SB 69-3", citation: "SB 69-3" },
      { query: "SB 69-21", citation: "SB 69-21" },
      { query: "HB 9999", citation: "HB 9999" },
      { query: "ORS 999.999", citation: "ORS 999.999" },
    ])(
      "$citation is said so in a note, and no hit is an exact match or a stray number",
      async ({ query, citation }) => {
        const outcome = await callTool(connected, "search", { query });

        expect(outcome.structured?.["notes"]).toEqual([expect.stringContaining(`"${citation}"`)]);
        expect(hitsOf(outcome)).toEqual([]);
      },
    );

    it("still finds what the rest of the query finds, and says which citation it could not place", async () => {
      const outcome = await callTool(connected, "search", { query: "paid family leave SB 69-3" });

      expect(outcome.structured?.["notes"]).toEqual([expect.stringContaining('"SB 69-3"')]);
      expect(hitsOf(outcome).length).toBeGreaterThan(0);
      expect(hitsOf(outcome).filter((hit) => hit.found_by.includes("citation"))).toEqual([]);
    });

    it("has no note when the citation is held but a filter leaves its documents out", async () => {
      const outcome = await callTool(connected, "search", { query: "HB 3795", kind: "agenda" });

      expect(outcome.structured?.["notes"]).toEqual([]);
    });
  });

  // The snippet of a hit found by an exact citation shows the citation, even where a passage boundary cuts it in two:
  // "ORS" ends HB 3795's Enrolled passage and "192.245" begins the next.
  describe("the snippet of an exact citation", () => {
    it("holds the citation, in every one of the eight documents that name ORS 192.245", async () => {
      const outcome = await callTool(connected, "search", { query: "ORS 192.245" });

      const first = hitsOf(outcome).slice(0, 8);
      expect(
        first.map((hit) => hit.snippet.replaceAll(/\s+/g, " ")).filter((snippet) => !snippet.includes("ORS 192.245")),
      ).toEqual([]);
    });
  });

  describe("the size and the contents of an answer", () => {
    it("is twenty hits unless the call asks for fewer or more, and fifty at most", async () => {
      const standard = await callTool(connected, "search", { query: "committee" });
      const few = await callTool(connected, "search", { query: "committee", limit: 3 });
      const many = await callTool(connected, "search", { query: "committee", limit: 50 });

      expect(hitsOf(standard)).toHaveLength(20);
      expect(hitsOf(few)).toHaveLength(3);
      expect(hitsOf(many)).toHaveLength(50);
      const tooMany = await callTool(connected, "search", { query: "committee", limit: 51 });
      expect(tooMany.isError).toBe(true);
      expect(tooMany.text).toContain("limit");
    });

    it("gives every hit what an agent needs to cite it, and an id that get_document resolves", async () => {
      const outcome = await callTool(connected, "search", { query: "Department of Human Services", limit: 50 });

      const hits = hitsOf(outcome);
      expect(hits.length).toBeGreaterThan(20);
      expect(outcome.structured?.["as_of"]).toBe("2026-08-05T10:00:00-07:00");
      expect(outcome.structured?.["notice"]).toMatch(/not the official record/i);
      // Every kind of document belongs to a Measure but an agenda, and every document has a date. A Recording Log
      // and an Exhibit may belong to none.
      const measureless = new Set(["agenda", "recording_log", "exhibit"]);
      for (const hit of hits) {
        expect(hit.title, hit.id).not.toBe("");
        expect(hit.source_url, hit.id).toMatch(/^https:\/\/olis\.oregonlegislature\.gov\/liz\/2025R1\/Downloads\//);
        expect(hit.snippet.length, hit.id).toBeGreaterThan(0);
        expect(hit.snippet.length, hit.id).toBeLessThanOrEqual(310);
        expect(hit.date, hit.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?-0[78]:00$/);
        if (!measureless.has(hit.kind)) expect(hit.measure, hit.id).toMatch(/^measure-2025r1-[a-z]+\d+$/);
        const document = await callTool(connected, "get_document", { id: hit.id });
        expect(document.isError, hit.id).toBe(false);
        expect(document.structured, hit.id).toMatchObject({ id: hit.id, kind: hit.kind });
        // A Proposed Amendment is served as its latest posting, which can be another file than the one that matched.
        if (hit.kind !== "proposed_amendment") expect(document.structured?.["source_url"], hit.id).toBe(hit.source_url);
      }
    }, 60_000);

    // The fields of a hit, read from the fixture and not from the code: the feed's rows (documents/feed/*.json) for the
    // date, the Measure and the label, the manifest for the link, and the document as `pdftotext -raw` prints it for
    // the words of the snippet. A date is the start of the meeting a document is posted to or for, else the CreatedDate of
    // its row, in Pacific time (-08:00 in winter, -07:00 in summer).
    //  - HB 3795's Introduced Version: MeasureDocuments row "Introduced", CreatedDate 2025-02-26T16:50:22.157.
    //  - SB 69's Proposed Amendment -2, as its latest posting, row 26288 of CommitteeProposedAmendments (SLB, meeting of
    //    2025-01-30 08:00, Adopted). The page starts "SB 69-2 (LC 1368) ... PROPOSED AMENDMENTS TO SENATE BILL 69".
    //  - SLB's agenda for 2025-01-21: CommitteeMeetings row, committee "Labor and Business" (Committees row), no Measure.
    //  - Testimony 209256: CommitteePublicTestimonies row, HB 3795, SHS, meeting of 2025-05-20 08:00, DocumentDescription
    //    "Testimony". The letter cites "ORS 418.808(4)".
    test.for([
      {
        query: "HB 3795",
        include_testimony: false,
        expected: {
          id: "version-2025r1-hb3795-introduced",
          document_id: "version-2025r1-hb3795-introduced",
          kind: "version",
          title: "HB 3795 Introduced",
          measure: "measure-2025r1-hb3795",
          date: "2025-02-26T16:50:22.157-08:00",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/Introduced",
        },
        snippetHolds: "House Bill 3795",
      },
      {
        query: "SB 69-2",
        include_testimony: false,
        expected: {
          id: "amendment-2025r1-sb69-2",
          document_id: "posting-2025r1-26288",
          kind: "proposed_amendment",
          title: "SB 69-2",
          measure: "measure-2025r1-sb69",
          date: "2025-01-30T08:00:00-08:00",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26288",
        },
        snippetHolds: "PROPOSED AMENDMENTS TO SENATE BILL 69",
      },
      {
        query: "time-rounding policies unpaid wages penalties",
        include_testimony: false,
        expected: {
          id: "agenda-2025r1-slb-2025-01-21-0800",
          document_id: "agenda-2025r1-slb-2025-01-21-0800",
          kind: "agenda",
          title: "Labor and Business Agenda",
          measure: null,
          date: "2025-01-21T08:00:00-08:00",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeAgenda/SLB/2025-01-21-08-00",
        },
        snippetHolds: "employee entitlements for recovery of unpaid wages and penalties",
      },
      {
        query: "ORS 418.808",
        include_testimony: true,
        expected: {
          id: "testimony-2025r1-209256",
          document_id: "testimony-2025r1-209256",
          kind: "testimony",
          title: "HB 3795 Testimony",
          measure: "measure-2025r1-hb3795",
          date: "2025-05-20T08:00:00-07:00",
          source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/209256",
        },
        snippetHolds: "ORS 418.808(4)",
      },
    ])(
      "shows $expected.id with the values the fixture gives it",
      async ({ query, include_testimony, expected, snippetHolds }) => {
        const outcome = await callTool(connected, "search", { query, include_testimony });

        const hit = hitsOf(outcome).find((candidate) => candidate.id === expected.id);
        expect(hit).toMatchObject(expected);
        expect(hit?.snippet.replaceAll("’", "'")).toContain(snippetHolds);
      },
    );

    it("is an empty list, not an error, for a query with no words to look for", async () => {
      const outcome = await callTool(connected, "search", { query: "what is the" });

      expect(outcome.isError).toBe(false);
      expect(hitsOf(outcome)).toEqual([]);
    });
  });
});
