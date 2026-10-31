// Seam 1: the Agency Links `get_measure` shows (ticket #16, spec #1 stories 31 to 35), with the whole system behind
// it. One database of the whole fixture serves every case in this file because none of them changes it; the cases
// that need the feed as it stood earlier, or a row the fixture lacks, are in the files beside it.
//
// Expected values are literals from the fixture's feed rows (test/fixtures/olis-2025R1/feed/), the documents as
// `pdftotext` prints them (test/fixtures/olis-2025R1/documents/), and the registry slugs of the snapshot fixture
// (test/fixtures/oregonai-snapshot/snapshot.json).
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { snapshotFixturePath } from "../support/oregonai-snapshot.ts";
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

  // SB 69's Testimony 196915 (feed/CommitteePublicTestimonies.json) was submitted by Josh Nasbe for HLWS's meeting of
  // 2025-04-21 with Organization "Bureau of Labor and Industries", which is the registry's name for the Agency, so the
  // Measure has an Agency Link to it. The Testimony of SB 64 gives the Organization "Oregon State Senate" (7 rows) and
  // "Southern Oregon", and HB 3795's 209256 gives "ODHS": the snapshot's registry names none of them (it has no alias
  // "ODHS", ADR-0012), so they link no Agency.
  describe("submitted Testimony", () => {
    it("links SB 69 to the Bureau of Labor and Industries through Testimony 196915, on the Measure", async () => {
      const links = await agencyLinksOf("SB 69");

      expect(evidenceOf(links, "testimony")).toEqual([
        ["bureau-of-labor-and-industries", "testimony-2025r1-196915", "measure-2025r1-sb69", "measure"],
      ]);
      const boli = links.agencies.find((agency) => agency.agency_id === "bureau-of-labor-and-industries");
      expect(boli?.evidence.find((evidence) => evidence.kind === "testimony")).toMatchObject({
        organization: "Bureau of Labor and Industries",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/196915",
      });
    });

    it("links no Agency for an Organization the registry does not name", async () => {
      expect(evidenceOf(await agencyLinksOf("SB 64"), "testimony")).toEqual([]);
      expect(evidenceOf(await agencyLinksOf("HB 3795"), "testimony")).toEqual([]);
    });
  });

  /** A derived evidence entry as [node, document, chapter, link kind, link target, measure section, links in the chapter]. */
  function derivedOf(
    links: AgencyLinks,
    agency: string,
  ): [string, string, string, string, string, string | null, number][] {
    const entry = links.agencies.find((candidate) => candidate.agency_id === agency);
    return (entry?.evidence ?? [])
      .filter((evidence) => evidence.kind === "derived")
      .map((evidence) => [
        evidence.node_id,
        evidence.document_id,
        evidence.chapter_id ?? "",
        evidence.statute_link?.kind ?? "",
        evidence.statute_link?.target_id ?? "",
        evidence.statute_link?.measure_section ?? null,
        evidence.links_in_chapter ?? 0,
      ]);
  }

  // SB 69's A-Engrossed and Enrolled Versions and its Proposed Amendments -1 and -2 have the same changes to the law
  // (pdftotext of measure-documents/SB69/A-Engrossed.pdf and proposed-amendments/26284.pdf, 26286.pdf): SECTION 1 adds
  // section 2 of the Act "to and made a part of ORS chapter 657B"; SECTIONS 3 to 10 amend ORS 657B.070, 659A.159,
  // 659A.165, 657B.400, 657B.060, 653.616, 653.626 and 659A.156. So the changes reach chapter 657B four times (SECTIONS
  // 1, 3, 6 and 7), chapter 659A three times (4, 5 and 10) and chapter 653 twice (8 and 9). The snapshot fixture's
  // Chapter table (test/fixtures/oregonai-snapshot/snapshot.json) gives chapter 653 to the Bureau of Labor and Industries
  // alone, 657B to it and the Employment Department, and 659A to it, DAS's Chief Human Resources Office, Corrections,
  // DHS's Aging and People with Disabilities and Developmental Disabilities, OHA's Public Employees Benefit Board and
  // the State Treasury. The same text cites ORS chapter 657 ("ORS chapter 657." in 26284.pdf and Enrolled.pdf), whose
  // Agencies include the Board of Nursing, and the Introduced Version cites ORS 192.245, a chapter 57 Agencies
  // implement, among them the Board of Optometry: a citation is not a change, so neither Agency is linked (ADR-0027).
  describe("derived through a Statute Link", () => {
    const sb69Nodes = [
      ["amendment-2025r1-sb69-1", "posting-2025r1-26284"],
      ["amendment-2025r1-sb69-2", "posting-2025r1-26286"],
      ["version-2025r1-sb69-a-engrossed", "version-2025r1-sb69-a-engrossed"],
      ["version-2025r1-sb69-enrolled", "version-2025r1-sb69-enrolled"],
    ] as const;

    it("links the Bureau of Labor and Industries to SB 69 through each chapter its sections change, naming the Statute Link", async () => {
      const links = await agencyLinksOf("SB 69");

      expect(derivedOf(links, "bureau-of-labor-and-industries")).toEqual(
        sb69Nodes.flatMap(([node, document]): [string, string, string, string, string, string | null, number][] => [
          [node, document, "ors-chapter-657b", "adds-to", "ors-chapter-657b", "1", 4],
          [node, document, "ors-chapter-659a", "amends", "ors-659a.159", "4", 3],
          [node, document, "ors-chapter-653", "amends", "ors-653.616", "8", 2],
        ]),
      );
    });

    it("links every Agency the Chapter table gives those chapters, and no other, to SB 69's A-Engrossed Version", async () => {
      const links = await agencyLinksOf("SB 69");

      const onAEngrossed = links.agencies
        .filter((agency) =>
          agency.evidence.some(
            (evidence) => evidence.kind === "derived" && evidence.node_id === "version-2025r1-sb69-a-engrossed",
          ),
        )
        .map((agency) => agency.agency_id);
      expect(onAEngrossed).toEqual([
        "bureau-of-labor-and-industries",
        "department-of-administrative-services-chief-human-resources-office",
        "department-of-corrections",
        "department-of-human-services-aging-and-people-with-disabilities-and-developmental-disabilities",
        "employment-department",
        "oregon-health-authority-public-employees-benefit-board",
        "oregon-state-treasury",
      ]);
    });

    it("derives nothing from a citation", async () => {
      const links = await agencyLinksOf("SB 69");

      const agencies = links.agencies.map((agency) => agency.agency_id);
      expect(agencies).not.toContain("board-of-optometry");
      expect(agencies).not.toContain("board-of-nursing");
      const chapters = links.agencies.flatMap((agency) => agency.evidence.map((evidence) => evidence.chapter_id));
      expect(chapters).not.toContain("ors-chapter-192");
      expect(chapters).not.toContain("ors-chapter-657");
    });

    // HB 3795: A-Engrossed amends ORS 409.711 (SECTION 1); B-Engrossed and Enrolled amend it and ORS 418.808 (SECTION 2);
    // Proposed Amendment -1 amends 409.711 (SECTION 1) and -A3 amends 418.808 (SECTION 2) (pdftotext of
    // measure-documents/HB3795/ and proposed-amendments/27966.pdf, 28997.pdf). The Introduced Version amends no ORS
    // section (SECTION 2 repeals section 1 of the Act). The Chapter table gives chapters 409 and 418 the Department
    // of Human Services among others.
    it("links the Department of Human Services to HB 3795 through the sections its Versions and amendments change", async () => {
      const links = await agencyLinksOf("HB 3795");

      expect(derivedOf(links, "department-of-human-services")).toEqual([
        ["amendment-2025r1-hb3795-1", "posting-2025r1-27966", "ors-chapter-409", "amends", "ors-409.711", "1", 1],
        ["amendment-2025r1-hb3795-a3", "posting-2025r1-28997", "ors-chapter-418", "amends", "ors-418.808", "2", 1],
        [
          "version-2025r1-hb3795-a-engrossed",
          "version-2025r1-hb3795-a-engrossed",
          "ors-chapter-409",
          "amends",
          "ors-409.711",
          "1",
          1,
        ],
        [
          "version-2025r1-hb3795-b-engrossed",
          "version-2025r1-hb3795-b-engrossed",
          "ors-chapter-409",
          "amends",
          "ors-409.711",
          "1",
          1,
        ],
        [
          "version-2025r1-hb3795-b-engrossed",
          "version-2025r1-hb3795-b-engrossed",
          "ors-chapter-418",
          "amends",
          "ors-418.808",
          "2",
          1,
        ],
        [
          "version-2025r1-hb3795-enrolled",
          "version-2025r1-hb3795-enrolled",
          "ors-chapter-409",
          "amends",
          "ors-409.711",
          "1",
          1,
        ],
        [
          "version-2025r1-hb3795-enrolled",
          "version-2025r1-hb3795-enrolled",
          "ors-chapter-418",
          "amends",
          "ors-418.808",
          "2",
          1,
        ],
      ]);
    });
  });

  // The ticket's fourth box: "Agency ids are OregonAI registry slugs". The registry is the snapshot fixture's `agencies`
  // (test/fixtures/oregonai-snapshot/snapshot.json, 114 rows), whose `slug` is OregonAI's id for the Agency
  // (`bureau-of-labor-and-industries`). Every Agency Link of the Measures of the fixture names one of them, and none
  // is a name: "Bureau of Labor and Industries" is the unit a statement writes, not the id.
  describe("Agency ids", () => {
    it("are slugs of the OregonAI registry, for every Measure of the fixture", async () => {
      const snapshot: unknown = JSON.parse(readFileSync(snapshotFixturePath, "utf8"));
      const registry = new Set((snapshot as { agencies: { slug: string }[] }).agencies.map((agency) => agency.slug));
      const measures = ["SB 64", "SB 69", "SB 121", "SB 921", "SB 983", "HB 3027", "HB 3131", "HB 3795"];

      const named = new Set<string>();
      for (const measure of measures) {
        for (const agency of (await agencyLinksOf(measure)).agencies) named.add(agency.agency_id);
      }

      expect(named.size).toBeGreaterThan(20);
      expect([...named].filter((id) => !registry.has(id))).toEqual([]);
      expect(named.has("bureau-of-labor-and-industries")).toBe(true);
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
