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
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { chapterTarget, expectedLinks, sectionTarget, triplesOf, type StatuteLinks } from "../support/statute-links.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then, so the pull fetches all 278 documents.
  // The simulated clock never moves, so the rate limit's window never ends; the cases make more calls than
  // the default 120 a minute together.
  system = await startCopiedSystem({
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

type File = {
  posting_ids: string[];
  text_read: boolean;
  not_read_reason: string | null;
  statute_links: StatuteLinks;
  relating_clause_edits: {
    deleted: string | null;
    deleted_lines: string[];
    inserted: string | null;
    inserted_sections: string[];
  }[];
};

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

  // SB 69-2 as `pdftotext proposed-amendments/26286.pdf` prints it. Its sections (the "SECTION n." lines): 1 adds
  // section 2 of the Act to ORS chapter 657B; 3 amends ORS 657B.070, 4 amends 659A.159 ("as amended by section 8,
  // chapter 20, Oregon Laws 2024"), 5 amends 659A.165, 6 amends 657B.400, 7 amends 657B.060, 8 amends 653.616, 9 amends
  // 653.626 and 10 amends 659A.156. The Statutes Affected Table for SB 69 (artables2025R1.pdf; olis-odata.md §5)
  // gives 653.616 (A, section 8), chapter 657B (Add, section 1) and 659A.159 (A, section 4), and `pdftotext -layout`
  // of it also has the rows 653.626 A §9, 659A.156 A §10 and 659A.165 A §5 for "SB 69 A" (A is the engrossing level).
  describe("the amendment's own Statute Links", () => {
    async function filesOf(reference: string): Promise<File[]> {
      const outcome = await callTool(connected, "compare_amendment", { amendment: reference });
      expect(outcome.isError).toBe(false);
      return outcome.structured?.["files"] as File[];
    }

    it("has the three links the Statutes Affected Table gives for SB 69", async () => {
      const [file, ...others] = await filesOf("SB 69-2");

      expect(others).toEqual([]);
      expect(triplesOf(file?.statute_links ?? expectedLinks({}))).toEqual(
        expect.arrayContaining([
          ["amends", "ors-653.616", "8"],
          ["adds-to", "ors-chapter-657b", "1"],
          ["amends", "ors-659a.159", "4"],
        ]),
      );
    });

    // Each target is listed once under its kind with the measure sections it is linked in (finding F6), in the order
    // of its first measure section. SB 69-2 amends one section in each of its sections 3 to 10 and adds to chapter 657B in 1.
    it("lists, kind by kind, the sections it amends and the chapter it adds to, and nothing it repeals", async () => {
      const [file] = await filesOf("SB 69-2");

      const links = file?.statute_links ?? expectedLinks({});
      expect(links.amends).toEqual({
        sections: [
          sectionTarget("ors-657b.070", "3"),
          sectionTarget("ors-659a.159", "4"),
          sectionTarget("ors-659a.165", "5"),
          sectionTarget("ors-657b.400", "6"),
          sectionTarget("ors-657b.060", "7"),
          sectionTarget("ors-653.616", "8"),
          sectionTarget("ors-653.626", "9"),
          sectionTarget("ors-659a.156", "10"),
        ],
        chapters: [],
      });
      expect(links["adds-to"]).toEqual({ sections: [], chapters: [chapterTarget("ors-chapter-657b", "1")] });
      expect(links.repeals).toEqual({ sections: [], chapters: [] });
      expect(links.cites.sections.length).toBeGreaterThan(0);
    });

    it("shows a passing mention as a citation, not as an amendment", async () => {
      const [file] = await filesOf("SB 69-2");

      // Section 2 says "the requirements under ORS 657B.060, and the provisions of ORS 657B.070"; section 3
      // opens "(a) Violate ORS 657B.060" and refers to ORS 659A.885 and 659A.820 and to appeals under ORS 657B.410 and 657B.420.
      const triples = triplesOf(file?.statute_links ?? expectedLinks({}));
      expect(triples).toEqual(
        expect.arrayContaining([
          ["cites", "ors-657b.060", "2"],
          ["cites", "ors-657b.070", "2"],
          ["cites", "ors-657b.060", "3"],
          ["cites", "ors-659a.885", "3"],
          ["cites", "ors-659a.820", "3"],
          ["cites", "ors-657b.410", "3"],
          ["cites", "ors-657b.420", "3"],
        ]),
      );
      // ORS 657B.410 and 657B.420 are named, and nothing is amended there.
      expect(triples.filter(([kind]) => kind === "amends").map(([, targetId]) => targetId)).not.toContain(
        "ors-657b.410",
      );
    });

    // Spec #1 story 26: a range is expanded into each section, so none in the middle of it is missed. SB 69-2's
    // section 4 says "Family leave under ORS 659A.150 to 659A.186" and, after it, "as described in ORS 659A.104";
    // section 6 says "Is exempt from disclosure under ORS 192.311 to 192.478". The lists are the snapshot's own
    // section ids between the two ends (oregonai-snapshot/snapshot.json, filtered by hand, not through the parser).
    it("expands the ranges it cites into every section the snapshot holds between the ends", async () => {
      const [file] = await filesOf("SB 69-2");

      // The targets are listed in the order of their first measure section, not of this one, so the lists are compared sorted.
      const citedIn = (measureSection: string, prefix: string): string[] =>
        (file?.statute_links.cites.sections ?? [])
          .filter((target) => target.measure_sections.includes(measureSection) && target.target_id.startsWith(prefix))
          .map((target) => target.target_id)
          .toSorted();
      expect(citedIn("4", "ors-659a.1")).toEqual([
        "ors-659a.104",
        "ors-659a.150",
        "ors-659a.153",
        "ors-659a.156",
        "ors-659a.157",
        "ors-659a.159",
        "ors-659a.162",
        "ors-659a.164",
        "ors-659a.165",
        "ors-659a.168",
        "ors-659a.171",
        "ors-659a.174",
        "ors-659a.177",
        "ors-659a.180",
        "ors-659a.183",
        "ors-659a.186",
      ]);
      expect(citedIn("6", "ors-192.")).toEqual([
        "ors-192.311",
        "ors-192.314",
        "ors-192.318",
        "ors-192.324",
        "ors-192.329",
        "ors-192.335",
        "ors-192.338",
        "ors-192.340",
        "ors-192.345",
        "ors-192.355",
        "ors-192.360",
        "ors-192.363",
        "ors-192.365",
        "ors-192.368",
        "ors-192.371",
        "ors-192.374",
        "ors-192.377",
        "ors-192.380",
        "ors-192.385",
        "ors-192.390",
        "ors-192.395",
        "ors-192.398",
        "ors-192.401",
        "ors-192.407",
        "ors-192.411",
        "ors-192.415",
        "ors-192.418",
        "ors-192.422",
        "ors-192.427",
        "ors-192.431",
        "ors-192.461",
        "ors-192.464",
        "ors-192.468",
        "ors-192.472",
        "ors-192.475",
        "ors-192.476",
        "ors-192.477",
        "ors-192.478",
      ]);
    });

    // Spec #1 story 27: a link to a whole chapter has no OregonAI id, and says so. SB 69-2 adds to ORS chapter
    // 657B (section 1) and, in section 6, names "ORS chapter 652, 653 or 659A", "ORS chapters 654, 656 and 731",
    // "ORS chapter 701", "ORS chapter 319" and "ORS chapter 657".
    it("marks every chapter it names as not resolvable on OregonAI, and lists every section apart from them", async () => {
      const [file] = await filesOf("SB 69-2");

      const links = file?.statute_links ?? expectedLinks({});
      expect(links["adds-to"].chapters).toEqual([chapterTarget("ors-chapter-657b", "1")]);
      expect(links.cites.chapters).toEqual([
        chapterTarget("ors-chapter-652", "6"),
        chapterTarget("ors-chapter-653", "6"),
        chapterTarget("ors-chapter-659a", "6"),
        chapterTarget("ors-chapter-654", "6"),
        chapterTarget("ors-chapter-656", "6"),
        chapterTarget("ors-chapter-731", "6"),
        chapterTarget("ors-chapter-701", "6"),
        chapterTarget("ors-chapter-319", "6"),
        chapterTarget("ors-chapter-657", "6"),
      ]);
      expect(links.amends.chapters).toEqual([]);
      const groups = [links.amends, links.repeals, links["adds-to"], links.cites];
      const chapters = groups.flatMap((group) => group.chapters);
      expect(chapters).toHaveLength(10);
      expect(chapters.some((chapter) => chapter.resolvable_on_oregonai)).toBe(false);
      // No chapter is among the sections, which OregonAI has pages for.
      expect(
        groups.flatMap((group) => group.sections).some((target) => target.target_id.startsWith("ors-chapter-")),
      ).toBe(false);
    });

    // ADR-0011: SB 69's -1 has three postings (26284, 26285, 26287) and two files (26285 and 26287 are byte-identical,
    // and 26284 differs from them in the PDF's modification date, not in its words). Their Statute Links and relating
    // clause edits are the same, so they are listed once, with all three posting ids: nothing is picked, and nothing
    // is repeated twice.
    it("lists postings whose files read the same as one entry with all their posting ids", async () => {
      const files = await filesOf("SB 69-1");

      expect(files.map((file) => file.posting_ids)).toEqual([
        ["posting-2025r1-26284", "posting-2025r1-26285", "posting-2025r1-26287"],
      ]);
      expect(triplesOf(files[0]?.statute_links ?? expectedLinks({}))).toContainEqual(["amends", "ors-657b.070", "3"]);
    });

    // SECTION 8 of SB 69-1 (pdftotext of proposed-amendments/26284.pdf): "(4) For a purpose specified in ORS 659A.272,
    // notwithstanding ORS" ends page 13, and "659A.270 (1)." starts page 14. The index reads the text the store holds,
    // which is PDF.js's, whose page footer is one line less than pdftotext's (finding F4): the citation must still join.
    it("reads a citation that runs over a page break, from the text the store holds", async () => {
      const files = await filesOf("SB 69-1");

      const triples = triplesOf(files[0]?.statute_links ?? expectedLinks({}));
      expect(triples).toContainEqual(["cites", "ors-659a.270", "8"]);
      expect(triples).toContainEqual(["cites", "ors-659a.272", "8"]);
    });

    it("carries the amendment's edit to the relating clause", async () => {
      const [file] = await filesOf("SB 69-2");

      // Page 1, as pdftotext prints it: In line 2 of the printed bill, before the period insert "; creating new pro- /
      // visions; amending ORS 653.616, 653.626, 657B.060, 657B.070, 657B.400, / 659A.156, 659A.159 and 659A.165; and
      // prescribing an effective date".
      expect(file?.relating_clause_edits).toEqual([
        {
          deleted: null,
          deleted_lines: [],
          inserted:
            "; creating new provisions; amending ORS 653.616, 653.626, 657B.060, 657B.070, 657B.400, 659A.156, 659A.159 and 659A.165; and prescribing an effective date",
          inserted_sections: [
            "ors-653.616",
            "ors-653.626",
            "ors-657b.060",
            "ors-657b.070",
            "ors-657b.400",
            "ors-659a.156",
            "ors-659a.159",
            "ors-659a.165",
          ],
        },
      ]);
    });

    it("lists the two postings that share one file as one file", async () => {
      // 26286 and 26288 are byte-identical (sha256 7aa13015...; the lead checked with sha256sum), so the
      // amendment has one file, posted twice.
      const files = await filesOf("SB 69-2");

      expect(files.map((file) => file.posting_ids)).toEqual([["posting-2025r1-26286", "posting-2025r1-26288"]]);
      expect(files[0]?.text_read).toBe(true);
      expect(files[0]?.not_read_reason).toBeNull();
    });
  });

  // Introduced SB 69 as `pdftotext measure-documents/SB69/Introduced.pdf` prints it: its only reference to the ORS is
  // in SECTION 1, "the manner provided by ORS 192.245". SECTION 2 repeals section 1 of the Act, which is no ORS section.
  describe("the amended Version's Statute Links", () => {
    it("are shown beside the amendment's, in the same shape: the Introduced Version cites ORS 192.245 and changes nothing", async () => {
      const outcome = await callTool(connected, "compare_amendment", { amendment: "SB 69-2" });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured?.["amended_version"]).toMatchObject({
        known: true,
        text_read: true,
        not_read_reason: null,
        statute_links: expectedLinks({ cites: { sections: [sectionTarget("ors-192.245", "1")] } }),
      });
    });
  });

  // HB 3795-A3 (Feed/CommitteeProposedAmendments.json 28997, 29108, 29109: SHS, the Senate Committee On Human
  // Services, 2025-05-15, 2025-05-20 and 2025-05-22; the three files are byte-identical). Its head, from `pdftotext
  // proposed-amendments/28997.pdf`: "PROPOSED AMENDMENTS TO / A-ENGROSSED HOUSE BILL 3795", "On page 1 of the
  // printed A-engrossed bill, line 2, before the period insert 'and 418.808'", and "SECTION 2. ORS 418.808 is amended
  // to read: 418.808. As used in ORS 418.806 to 418.816, ...". The A-Engrossed Version
  // (measure-documents/HB3795/A-Engrossed.pdf) has "Relating to human services; amending ORS 409.711.", SECTION 1
  // "ORS 409.711 is amended to read:" and, in subsection (5), "in the manner provided in ORS 192.245". The
  // snapshot (oregonai-snapshot/snapshot.json) has five sections from 418.806 to 418.816: 418.806, 418.808, 418.811,
  // 418.813 and 418.816.
  describe("HB 3795-A3", () => {
    async function compare(): Promise<Record<string, unknown>> {
      const outcome = await callTool(connected, "compare_amendment", { amendment: "HB 3795-A3" });
      expect(outcome.isError).toBe(false);
      return outcome.structured ?? {};
    }

    it("names the A-Engrossed Version, because its header and its number both say so", async () => {
      expect((await compare())["amended_version"]).toMatchObject({
        known: true,
        id: "version-2025r1-hb3795-a-engrossed",
        label: "A-Engrossed",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/A-Engrossed",
      });
    });

    it("amends ORS 418.808 and only cites the sections of the range ORS 418.806 to 418.816, which is expanded", async () => {
      const [file, ...others] = (await compare())["files"] as File[];

      expect(others).toEqual([]);
      expect(file?.posting_ids).toEqual(["posting-2025r1-28997", "posting-2025r1-29108", "posting-2025r1-29109"]);
      expect(file?.statute_links).toEqual(
        expectedLinks({
          amends: { sections: [sectionTarget("ors-418.808", "2")] },
          cites: {
            sections: [
              sectionTarget("ors-418.806", "2"),
              sectionTarget("ors-418.808", "2"),
              sectionTarget("ors-418.811", "2"),
              sectionTarget("ors-418.813", "2"),
              sectionTarget("ors-418.816", "2"),
            ],
          },
        }),
      );
    });

    it("carries the edit that adds ORS 418.808 to the relating clause", async () => {
      const [file] = (await compare())["files"] as File[];

      expect(file?.relating_clause_edits).toEqual([
        { deleted: null, deleted_lines: [], inserted: "and 418.808", inserted_sections: ["ors-418.808"] },
      ]);
    });

    it("shows the A-Engrossed Version amending ORS 409.711 and citing ORS 192.245", async () => {
      expect((await compare())["amended_version"]).toMatchObject({
        text_read: true,
        statute_links: expectedLinks({
          amends: { sections: [sectionTarget("ors-409.711", "1")] },
          cites: { sections: [sectionTarget("ors-192.245", "1")] },
        }),
      });
    });
  });

  describe("what the comparison covers", () => {
    it("carries the note that what the amendment deletes was not evaluated", async () => {
      const outcome = await callTool(connected, "compare_amendment", { amendment: "SB 69-2" });

      expect(outcome.structured?.["deletions_note"]).toBe(
        "What this amendment deletes from the Version it amends was not evaluated: only the Statute Links in the sections the amendment inserts and its edits to the relating clause are read, so a link of the Version that the amendment does not mention is not shown as removed.",
      );
    });
  });
});
