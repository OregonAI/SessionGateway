// Seam 1: the Agency Links `get_measure` shows (ticket #16, spec #1 stories 31 to 35), with the whole system behind
// it. One database of the whole fixture serves every case in this file because none of them changes it; the cases
// that need the feed as it stood earlier, or a row the fixture lacks, are in the files beside it.
//
// Expected values are literals from the fixture's feed rows (test/fixtures/olis-2025R1/feed/), the documents as
// `pdftotext` prints them (test/fixtures/olis-2025R1/documents/), and the registry slugs of the snapshot fixture
// (test/fixtures/oregonai-snapshot/snapshot.json).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 278 documents.
  system = await startSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type Evidence = {
  kind: string;
  node_id: string;
  node_type: string;
  document_id: string;
  source_url: string;
  unit?: string;
  terms?: string[];
  organization?: string;
  chapter_id?: string;
  statute_link?: { kind: string; target_id: string; measure_section: string | null };
  links_in_chapter?: number;
};
type AgencyEntry = { agency_id: string; evidence: Evidence[] };
type UnresolvedUnit = { unit: string; statement_id: string; source_url: string; node_id: string; node_type: string };
type AgencyLinks = { agencies: AgencyEntry[]; unresolved_units: UnresolvedUnit[]; note: string };

describe.for(eras)("get_measure's Agency Links for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  async function agencyLinksOf(measure: string): Promise<AgencyLinks> {
    const outcome = await callTool(connected, "get_measure", { measure });
    expect(outcome.isError).toBe(false);
    return outcome.structured?.["agency_links"] as AgencyLinks;
  }

  /** The evidence of one kind, as [agency, document, node, node type] rows in the order the tool lists them. */
  function evidenceOf(links: AgencyLinks, kind: string): [string, string, string, string][] {
    return links.agencies.flatMap((agency) =>
      agency.evidence
        .filter((evidence) => evidence.kind === kind)
        .map((evidence): [string, string, string, string] => [
          agency.agency_id,
          evidence.document_id,
          evidence.node_id,
          evidence.node_type,
        ]),
    );
  }

  // SB 69's Fiscal Impact Statement is analysis 85414 (feed/MeasureAnalysisDocuments.json: DocumentType "Fiscal Impact
  // Statement", Version "A"), and its "Government Unit(s) Affected:" line reads "Bureau of Labor and Industries,
  // Employment Department, Judicial Department, Department of Justice" (pdftotext of
  // measure-analysis-documents/85414.pdf, and test/fixtures/olis-2025R1/measures.txt). Its label "A" is the
  // A-Engrossed Version, which the feed lists for SB 69 (feed/MeasureDocuments.json), so the link sits on that Version
  // (ADR-0013). The slugs are the snapshot fixture's.
  describe("named in a Fiscal Impact Statement", () => {
    it("links SB 69's A-Engrossed Version to the four Agencies its Fiscal Impact Statement names, each with the unit as written", async () => {
      const links = await agencyLinksOf("SB 69");

      expect(evidenceOf(links, "fiscal-impact-statement")).toEqual([
        ["bureau-of-labor-and-industries", "analysis-2025r1-85414", "version-2025r1-sb69-a-engrossed", "version"],
        ["department-of-justice", "analysis-2025r1-85414", "version-2025r1-sb69-a-engrossed", "version"],
        ["employment-department", "analysis-2025r1-85414", "version-2025r1-sb69-a-engrossed", "version"],
        ["judicial-department", "analysis-2025r1-85414", "version-2025r1-sb69-a-engrossed", "version"],
      ]);
      const boli = links.agencies.find((agency) => agency.agency_id === "bureau-of-labor-and-industries");
      expect(boli?.evidence.find((evidence) => evidence.kind === "fiscal-impact-statement")).toMatchObject({
        unit: "Bureau of Labor and Industries",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/85414",
      });
    });
  });

  // HB 3795 is a Department of Human Services measure. pdftotext of its documents (test/fixtures/olis-2025R1/documents/)
  // shows "Department of Human Services" in Introduced ("SECTION 1. The Department of Human Services shall study"),
  // A-Engrossed, B-Engrossed and Enrolled; in proposed-amendments/27966.pdf, HB 3795-1 ("(1) The Department of Human
  // Services shall adopt by rule a grant program"); and in -A3's postings 28997, 29108 and 29109 across a line break
  // ("the Department of Human" / "Services reasonably believes"). The Printed Amendments (House Amendments to
  // Introduced, Senate Amendments to A-Engrossed) name it too, but a Printed Amendment is not a Version and is not
  // read (ADR-0015). -A3's three postings are one Proposed Amendment: its link is listed once, with the first posting.
  describe("named in the text", () => {
    it("links HB 3795 to the Department of Human Services on each Version and Proposed Amendment whose text names it", async () => {
      const links = await agencyLinksOf("HB 3795");

      const named = evidenceOf(links, "named-in-text").filter(([agency]) => agency === "department-of-human-services");
      expect(named).toEqual([
        ["department-of-human-services", "posting-2025r1-27966", "amendment-2025r1-hb3795-1", "proposed_amendment"],
        ["department-of-human-services", "posting-2025r1-28997", "amendment-2025r1-hb3795-a3", "proposed_amendment"],
        [
          "department-of-human-services",
          "version-2025r1-hb3795-a-engrossed",
          "version-2025r1-hb3795-a-engrossed",
          "version",
        ],
        [
          "department-of-human-services",
          "version-2025r1-hb3795-b-engrossed",
          "version-2025r1-hb3795-b-engrossed",
          "version",
        ],
        ["department-of-human-services", "version-2025r1-hb3795-enrolled", "version-2025r1-hb3795-enrolled", "version"],
        [
          "department-of-human-services",
          "version-2025r1-hb3795-introduced",
          "version-2025r1-hb3795-introduced",
          "version",
        ],
      ]);
    });

    it("names the registry term that was found", async () => {
      const links = await agencyLinksOf("HB 3795");

      const dhs = links.agencies.find((agency) => agency.agency_id === "department-of-human-services");
      const text = dhs?.evidence.filter((evidence) => evidence.kind === "named-in-text") ?? [];
      expect(text).toHaveLength(6);
      for (const evidence of text) expect(evidence.terms).toEqual(["Department of Human Services"]);
    });
  });

  // SB 983's Introduced Fiscal Impact Statement is analysis 88044 and its A-Engrossed one 91466 (feed/
  // MeasureAnalysisDocuments.json, Version "INTRO" and "A"); both read "Government Unit(s) Affected: Cities, Counties,
  // School Districts, Special Districts, Metro, TriMet" (pdftotext of measure-analysis-documents/88044.pdf and
  // 91466.pdf, and test/fixtures/olis-2025R1/measures.txt). None of them is a state agency, so none is an Agency: they
  // stay as the statements write them (spec #1 story 34).
  describe("units that are not Agencies", () => {
    const units = ["Cities", "Counties", "School Districts", "Special Districts", "Metro", "TriMet"];

    it("keeps SB 983's units as each statement writes them, with the statement and the Version it sits on, in the statement's order", async () => {
      const links = await agencyLinksOf("SB 983");

      expect(
        links.unresolved_units.map((unit) => [unit.statement_id, unit.node_id, unit.node_type, unit.unit]),
      ).toEqual([
        ...units.map((unit) => ["analysis-2025r1-88044", "version-2025r1-sb983-introduced", "version", unit]),
        ...units.map((unit) => ["analysis-2025r1-91466", "version-2025r1-sb983-a-engrossed", "version", unit]),
      ]);
      expect(links.unresolved_units[0]?.source_url).toBe(
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/88044",
      );
    });

    it("links no Agency to them", async () => {
      const links = await agencyLinksOf("SB 983");

      expect(evidenceOf(links, "fiscal-impact-statement")).toEqual([]);
    });
  });
});
