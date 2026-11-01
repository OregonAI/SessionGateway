// Seam 1: the Agency Links `get_measure` shows (ticket #16, spec #1 stories 31 to 35), with the whole system behind
// it. One database of the whole fixture serves every case in this file because none of them changes it; the cases
// that need the feed as it stood earlier, or a row the fixture lacks, are in the files beside it.
//
// Expected values are literals from the fixture's feed rows (test/fixtures/olis-2025R1/feed/), the documents as
// `pdftotext` prints them (test/fixtures/olis-2025R1/documents/), and the registry slugs of the snapshot fixture
// (test/fixtures/oregonai-snapshot/snapshot.json).
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates). It covers each kind of evidence with its count and examples, a parent's link through its
// sub-unit, the units that are not Agencies, what a citation does not derive and the size of the answer.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { snapshotFixturePath } from "../support/oregonai-snapshot.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 278 documents.
  system = await startCopiedSystem({
    clockAt: "2026-08-01T17:00:00Z",
    documents: true,
    serverEnv: { MCP_RATE_LIMIT: "1000" },
  });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

type Example = {
  document_id: string;
  node_id: string;
  node_type: string;
  unit?: string;
  terms?: string[];
  organization?: string;
  chapter_id?: string;
  statute_link?: { kind: string; target_id: string; measure_section: string | null };
  links_in_chapter?: number;
  through?: string[];
};
type KindEvidence = { kind: string; count: number; examples: Example[] };
type AgencyEntry = { agency_id: string; parent_id: string | null; evidence: KindEvidence[] };
type UnresolvedUnit = { unit: string; statement_id: string; node_id: string; node_type: string };
type AgencyLinks = {
  agencies: AgencyEntry[];
  documents: { id: string; source_url: string }[];
  unresolved_units: UnresolvedUnit[];
  note: string;
};

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

  /** One Agency's evidence of one kind: how many pieces there are and the examples the answer gives. */
  function kindOf(links: AgencyLinks, agency: string, kind: string): KindEvidence | undefined {
    return links.agencies.find((entry) => entry.agency_id === agency)?.evidence.find((group) => group.kind === kind);
  }

  /** The examples of one kind as [agency, document, node, node type] rows, in the order the tool lists them. */
  function examplesOf(links: AgencyLinks, kind: string): [string, string, string, string][] {
    return links.agencies.flatMap((agency) =>
      (agency.evidence.find((group) => group.kind === kind)?.examples ?? []).map(
        (example): [string, string, string, string] => [
          agency.agency_id,
          example.document_id,
          example.node_id,
          example.node_type,
        ],
      ),
    );
  }

  const sourceUrlOf = (links: AgencyLinks, document: string): string | undefined =>
    links.documents.find((candidate) => candidate.id === document)?.source_url;

  // SB 69's Fiscal Impact Statement is analysis 85414 (feed/MeasureAnalysisDocuments.json: DocumentType "Fiscal Impact
  // Statement", Version "A"), and its "Government Unit(s) Affected:" line reads "Bureau of Labor and Industries,
  // Employment Department, Judicial Department, Department of Justice" (pdftotext of
  // measure-analysis-documents/85414.pdf, and test/fixtures/olis-2025R1/measures.txt). Its label "A" is the
  // A-Engrossed Version, which the feed lists for SB 69 (feed/MeasureDocuments.json), so the link sits on that Version
  // (ADR-0013). The slugs are the snapshot fixture's.
  describe("named in a Fiscal Impact Statement", () => {
    it("links SB 69's A-Engrossed Version to the four Agencies its Fiscal Impact Statement names, each with the unit as written", async () => {
      const links = await agencyLinksOf("SB 69");

      expect(examplesOf(links, "fiscal-impact-statement")).toEqual([
        ["bureau-of-labor-and-industries", "analysis-2025r1-85414", "version-2025r1-sb69-a-engrossed", "version"],
        ["department-of-justice", "analysis-2025r1-85414", "version-2025r1-sb69-a-engrossed", "version"],
        ["employment-department", "analysis-2025r1-85414", "version-2025r1-sb69-a-engrossed", "version"],
        ["judicial-department", "analysis-2025r1-85414", "version-2025r1-sb69-a-engrossed", "version"],
      ]);
      const boli = kindOf(links, "bureau-of-labor-and-industries", "fiscal-impact-statement");
      expect(boli?.count).toBe(1);
      expect(boli?.examples[0]?.unit).toBe("Bureau of Labor and Industries");
      expect(sourceUrlOf(links, "analysis-2025r1-85414")).toBe(
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/85414",
      );
    });
  });

  // HB 3795 is a Department of Human Services measure. pdftotext of its documents (test/fixtures/olis-2025R1/documents/)
  // shows "Department of Human Services" in Introduced ("SECTION 1. The Department of Human Services shall study"),
  // A-Engrossed, B-Engrossed and Enrolled; in proposed-amendments/27966.pdf, HB 3795-1 ("(1) The Department of Human
  // Services shall adopt by rule a grant program"); and in -A3's postings 28997, 29108 and 29109 across a line break
  // ("the Department of Human" / "Services reasonably believes"). The Printed Amendments (House Amendments to
  // Introduced, Senate Amendments to A-Engrossed) name it too, but a Printed Amendment is not a Version and is not
  // read (ADR-0015). -A3's three postings are one Proposed Amendment: its link is counted once. That is six links; the
  // answer counts them and gives the first three as examples, in the order of node id: -1, -A3, then A-Engrossed.
  // find_measures lists all six (find-measures.test.ts).
  describe("named in the text", () => {
    it("counts the nodes of HB 3795 whose text names the Department of Human Services, and gives three of them", async () => {
      const links = await agencyLinksOf("HB 3795");

      const named = kindOf(links, "department-of-human-services", "named-in-text");
      expect(named?.count).toBe(6);
      expect(named?.examples.map((example) => [example.document_id, example.node_id, example.node_type])).toEqual([
        ["posting-2025r1-27966", "amendment-2025r1-hb3795-1", "proposed_amendment"],
        ["posting-2025r1-28997", "amendment-2025r1-hb3795-a3", "proposed_amendment"],
        ["version-2025r1-hb3795-a-engrossed", "version-2025r1-hb3795-a-engrossed", "version"],
      ]);
    });

    // The A-Engrossed Version's Digest reads "The Act tells ODHS to study human services" (pdftotext of
    // measure-documents/HB3795/A-Engrossed.pdf), and "ODHS" is an alias of the Department since ERF 6c41efefb5 (#49),
    // so its link names both terms, in the order they come in the text. The two Proposed Amendments name only the
    // Department's name.
    it("names the registry terms that were found", async () => {
      const links = await agencyLinksOf("HB 3795");

      const named = kindOf(links, "department-of-human-services", "named-in-text");
      expect(named?.examples.map((example) => [example.node_id, example.terms])).toEqual([
        ["amendment-2025r1-hb3795-1", ["Department of Human Services"]],
        ["amendment-2025r1-hb3795-a3", ["Department of Human Services"]],
        ["version-2025r1-hb3795-a-engrossed", ["ODHS", "Department of Human Services"]],
      ]);
    });
  });

  // SB 69's Testimony 196915 (feed/CommitteePublicTestimonies.json) was submitted by Josh Nasbe for HLWS's meeting of
  // 2025-04-21 with Organization "Bureau of Labor and Industries", which is the registry's name for the Agency, so the
  // Measure has an Agency Link to it. The Testimony of SB 64 gives the Organization "Oregon State Senate" (7 rows) and
  // "Southern Oregon": the snapshot's registry names neither, so they link no Agency. HB 3795's 209256 gives "ODHS",
  // which it does name (below).
  describe("submitted Testimony", () => {
    it("links SB 69 to the Bureau of Labor and Industries through Testimony 196915, on the Measure", async () => {
      const links = await agencyLinksOf("SB 69");

      expect(examplesOf(links, "testimony")).toEqual([
        ["bureau-of-labor-and-industries", "testimony-2025r1-196915", "measure-2025r1-sb69", "measure"],
      ]);
      expect(kindOf(links, "bureau-of-labor-and-industries", "testimony")?.examples[0]?.organization).toBe(
        "Bureau of Labor and Industries",
      );
      expect(sourceUrlOf(links, "testimony-2025r1-196915")).toBe(
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/196915",
      );
    });

    it("links no Agency for an Organization the registry does not name", async () => {
      expect(examplesOf(await agencyLinksOf("SB 64"), "testimony")).toEqual([]);
    });

    // HB 3795's Testimony 209256 (feed/CommitteePublicTestimonies.json: Organization "ODHS", Michelle Pfeiffer for
    // SHS's meeting of 2025-05-20) names the Department of Human Services by the alias "ODHS", which the registry has
    // since ERF 6c41efefb5 (ticket #49; PR #40 question 2: no local alias).
    it("links HB 3795 to the Department of Human Services through Testimony 209256, whose Organization is the alias ODHS", async () => {
      const links = await agencyLinksOf("HB 3795");

      expect(examplesOf(links, "testimony")).toEqual([
        ["department-of-human-services", "testimony-2025r1-209256", "measure-2025r1-hb3795", "measure"],
      ]);
      expect(kindOf(links, "department-of-human-services", "testimony")?.examples[0]?.organization).toBe("ODHS");
    });
  });

  /** A derived example as [node, document, chapter, link kind, link target, measure section, links in the chapter]. */
  function derivedOf(
    links: AgencyLinks,
    agency: string,
  ): [string, string, string, string, string, string | null, number][] {
    return (kindOf(links, agency, "derived")?.examples ?? []).map((example) => [
      example.node_id,
      example.document_id,
      example.chapter_id ?? "",
      example.statute_link?.kind ?? "",
      example.statute_link?.target_id ?? "",
      example.statute_link?.measure_section ?? null,
      example.links_in_chapter ?? 0,
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
  // The answer lists the links of the two Versions and not of -1 and -2, which amend the Introduced Version and are
  // replaced by A-Engrossed (ADR-0015, get_measure's superseded_amendments).
  describe("derived through a Statute Link", () => {
    it("links the Bureau of Labor and Industries to SB 69 through each chapter its sections change, naming the Statute Link", async () => {
      const links = await agencyLinksOf("SB 69");

      // Six links (A-Engrossed and Enrolled, three chapters each) and the first three as examples.
      expect(kindOf(links, "bureau-of-labor-and-industries", "derived")?.count).toBe(6);
      expect(derivedOf(links, "bureau-of-labor-and-industries")).toEqual([
        [
          "version-2025r1-sb69-a-engrossed",
          "version-2025r1-sb69-a-engrossed",
          "ors-chapter-657b",
          "adds-to",
          "ors-chapter-657b",
          "1",
          4,
        ],
        [
          "version-2025r1-sb69-a-engrossed",
          "version-2025r1-sb69-a-engrossed",
          "ors-chapter-659a",
          "amends",
          "ors-659a.159",
          "4",
          3,
        ],
        [
          "version-2025r1-sb69-a-engrossed",
          "version-2025r1-sb69-a-engrossed",
          "ors-chapter-653",
          "amends",
          "ors-653.616",
          "8",
          2,
        ],
      ]);
    });

    // The registry places three of the six sub-units under a Department of their own (the snapshot's `parent`: DAS's Chief
    // Human Resources Office under the Department of Administrative Services, DHS's Aging and People with Disabilities
    // under the Department of Human Services, OHA's Public Employees Benefit Board under the Oregon Health Authority), and
    // the Chapter table lists none of the three Departments for these chapters, so each gets a link through its sub-unit
    // (ADR-0029, #16 F3). Each has one link on each of the two Versions.
    it("links every Agency the Chapter table gives those chapters, and the parents of those that are sub-units", async () => {
      const links = await agencyLinksOf("SB 69");

      const derived = links.agencies
        .filter((agency) => agency.evidence.some((group) => group.kind === "derived"))
        .map((agency) => [agency.agency_id, kindOf(links, agency.agency_id, "derived")?.count]);
      expect(derived).toEqual([
        ["bureau-of-labor-and-industries", 6],
        ["department-of-administrative-services", 2],
        ["department-of-administrative-services-chief-human-resources-office", 2],
        ["department-of-corrections", 2],
        ["department-of-human-services", 2],
        ["department-of-human-services-aging-and-people-with-disabilities-and-developmental-disabilities", 2],
        ["employment-department", 2],
        ["oregon-health-authority", 2],
        ["oregon-health-authority-public-employees-benefit-board", 2],
        ["oregon-state-treasury", 2],
      ]);
    });

    it("says a parent's link came through its sub-unit, and gives each Agency its parent", async () => {
      const links = await agencyLinksOf("SB 69");

      const apd = "department-of-human-services-aging-and-people-with-disabilities-and-developmental-disabilities";
      expect(
        kindOf(links, "department-of-human-services", "derived")?.examples.map((example) => example.through),
      ).toEqual([[apd], [apd]]);
      expect(kindOf(links, apd, "derived")?.examples.map((example) => example.through)).toEqual([undefined, undefined]);
      const parents = Object.fromEntries(links.agencies.map((agency) => [agency.agency_id, agency.parent_id]));
      expect(parents[apd]).toBe("department-of-human-services");
      expect(parents["department-of-human-services"]).toBeNull();
      expect(parents["bureau-of-labor-and-industries"]).toBeNull();
      expect(parents["department-of-administrative-services-chief-human-resources-office"]).toBe(
        "department-of-administrative-services",
      );
    });

    it("derives nothing from a citation", async () => {
      const links = await agencyLinksOf("SB 69");

      const agencies = links.agencies.map((agency) => agency.agency_id);
      expect(agencies).not.toContain("board-of-optometry");
      expect(agencies).not.toContain("board-of-nursing");
      const chapters = links.agencies.flatMap((agency) =>
        agency.evidence.flatMap((group) => group.examples.map((example) => example.chapter_id)),
      );
      expect(chapters).not.toContain("ors-chapter-192");
      expect(chapters).not.toContain("ors-chapter-657");
    });

    // The links of SB 69-1 and -2 are not in the answer's list of Statute Links (they amend the Introduced Version, and
    // A-Engrossed is held), so the Agency Links derived from them are left out too, and counted: 12 each, the
    // Agencies of chapter 653 (1), 657B (2) and 659A (6 and the 3 Departments of its sub-units).
    it("leaves out the links derived from the amendments whose Statute Links the answer does not list, and counts them", async () => {
      const links = await agencyLinksOf("SB 69");

      expect(links.note).toContain(
        "24 derived links from 2 Proposed Amendments are left out: their Statute Links are not listed in statute_links_by_source",
      );
      // What an amendment's text names is not a Statute Link and stays; only the derived links go.
      const derivedNodes = links.agencies.flatMap((agency) =>
        agency.evidence
          .filter((group) => group.kind === "derived")
          .flatMap((group) => group.examples.map((example) => example.node_type)),
      );
      expect(derivedNodes.filter((type) => type === "proposed_amendment")).toEqual([]);
      expect(examplesOf(links, "named-in-text").some(([, , node]) => node === "amendment-2025r1-sb69-2")).toBe(true);
    });

    // HB 3795: A-Engrossed amends ORS 409.711 (SECTION 1); B-Engrossed and Enrolled amend it and ORS 418.808 (SECTION 2);
    // Proposed Amendment -1 amends 409.711 (SECTION 1) and -A3 amends 418.808 (SECTION 2) (pdftotext of
    // measure-documents/HB3795/ and proposed-amendments/27966.pdf, 28997.pdf). The Introduced Version amends no ORS
    // section (SECTION 2 repeals section 1 of the Act). The Chapter table gives chapters 409 and 418 the Department
    // of Human Services among others. -1 and -A3 are replaced by the Versions after the ones they amend, so the answer
    // lists the five links of the three Versions.
    it("links the Department of Human Services to HB 3795 through the sections its Versions change", async () => {
      const links = await agencyLinksOf("HB 3795");

      expect(kindOf(links, "department-of-human-services", "derived")?.count).toBe(5);
      expect(derivedOf(links, "department-of-human-services")).toEqual([
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
      ]);
    });

    // Chapter 409 lists 6 Agencies and the Oregon Health Authority as the parent of one; 418 lists 8 and the Authority
    // again. -1 amends 409.711 and -A3 amends 418.808, so the answer leaves out 7 + 9 = 16 links of 2 amendments.
    it("counts the links derived from HB 3795's replaced amendments", async () => {
      const links = await agencyLinksOf("HB 3795");

      expect(links.note).toContain("16 derived links from 2 Proposed Amendments are left out");
    });
  });

  // The ticket's fourth box: "Agency ids are OregonAI registry slugs". The registry is the snapshot fixture's `agencies`
  // (test/fixtures/oregonai-snapshot/snapshot.json, 129 rows), whose `slug` is OregonAI's id for the Agency
  // (`bureau-of-labor-and-industries`). Every Agency Link of the Measures of the fixture names one of them, and none
  // is a name: "Bureau of Labor and Industries" is the unit a statement writes, not the id. So is each parent.
  describe("Agency ids", () => {
    it("are slugs of the OregonAI registry, for every Measure of the fixture", async () => {
      const snapshot: unknown = JSON.parse(readFileSync(snapshotFixturePath, "utf8"));
      const registry = new Set((snapshot as { agencies: { slug: string }[] }).agencies.map((agency) => agency.slug));
      const measures = ["SB 64", "SB 69", "SB 121", "SB 921", "SB 983", "HB 3027", "HB 3131", "HB 3795"];

      const named = new Set<string>();
      for (const measure of measures) {
        for (const agency of (await agencyLinksOf(measure)).agencies) {
          named.add(agency.agency_id);
          if (agency.parent_id !== null) named.add(agency.parent_id);
        }
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
      expect(sourceUrlOf(links, "analysis-2025r1-88044")).toBe(
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/88044",
      );
      expect(sourceUrlOf(links, "analysis-2025r1-91466")).toBe(
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/91466",
      );
    });

    // Neither statement gives any Agency a link of any kind: no Agency has a piece of evidence read from either document.
    it("links no Agency to them, of any kind", async () => {
      const links = await agencyLinksOf("SB 983");

      const documentsOfEvidence = links.agencies.flatMap((agency) =>
        agency.evidence.flatMap((group) => group.examples.map((example) => example.document_id)),
      );
      expect(documentsOfEvidence).not.toContain("analysis-2025r1-88044");
      expect(documentsOfEvidence).not.toContain("analysis-2025r1-91466");
      expect(links.agencies.flatMap((agency) => agency.evidence.map((group) => group.kind))).not.toContain(
        "fiscal-impact-statement",
      );
    });
  });

  // The answer is compact and bounded (#16 F5): each kind of evidence has a count and three examples, and each document
  // appears once in `documents`, however many pieces of evidence name it. SB 69's agency_links was 26,980 characters with
  // every link listed (82 pieces of evidence for 15 Agencies, counted in the answer before this change); a part of
  // get_document is 20,000 (src/packages/mcp-server/lib/parts.ts), which the repo takes as a few percent of an agent's context.
  describe("size", () => {
    it("is less than one part of get_document for SB 69, the Measure with the most Agencies in the fixture", async () => {
      const links = await agencyLinksOf("SB 69");

      expect(links.agencies.length).toBeGreaterThan(10);
      expect(JSON.stringify(links).length).toBeLessThan(20_000);
    });

    it("gives at most three examples of a kind, and counts the rest", async () => {
      const links = await agencyLinksOf("HB 3795");

      const groups = links.agencies.flatMap((agency) => agency.evidence);
      expect(groups.every((group) => group.examples.length === Math.min(group.count, 3))).toBe(true);
      expect(groups.some((group) => group.count > 3)).toBe(true);
    });
  });

  describe("documents", () => {
    it("lists each document once, with where the Legislature publishes it, and every document the evidence names", async () => {
      const links = await agencyLinksOf("SB 69");

      const ids = links.documents.map((document) => document.id);
      expect(new Set(ids).size).toBe(ids.length);
      const named = new Set(
        links.agencies.flatMap((agency) =>
          agency.evidence.flatMap((group) => group.examples.map((example) => example.document_id)),
        ),
      );
      expect([...named].filter((id) => !ids.includes(id))).toEqual([]);
      expect(ids).toContain("analysis-2025r1-85414");
      expect(sourceUrlOf(links, "version-2025r1-sb69-a-engrossed")).toBe(
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/A-Engrossed",
      );
    });
  });
});
