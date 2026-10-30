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

/** What an agent sees of one Statute Link. */
type Link = {
  kind: string;
  target_id: string;
  target_type: "section" | "chapter";
  resolvable_on_oregonai: boolean;
  measure_section: string | null;
};

/** An ORS section: OregonAI has its page. */
const section = (kind: string, id: string, measureSection: string): Link => ({
  kind,
  target_id: id,
  target_type: "section",
  resolvable_on_oregonai: true,
  measure_section: measureSection,
});

/** An ORS chapter: OregonAI has no id for it, and the link says so (spec #1, story 27). */
const chapter = (kind: string, id: string, measureSection: string): Link => ({
  kind,
  target_id: id,
  target_type: "chapter",
  resolvable_on_oregonai: false,
  measure_section: measureSection,
});

type File = {
  posting_ids: string[];
  text_read: boolean;
  not_read_reason: string | null;
  statute_links: Link[];
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
  // gives 653.616 (A, section 8), chapter 657B (Add, section 1) and 659A.159 (A, section 4).
  describe("the amendment's own Statute Links", () => {
    async function filesOf(reference: string): Promise<File[]> {
      const outcome = await callTool(connected, "compare_amendment", { amendment: reference });
      expect(outcome.isError).toBe(false);
      return outcome.structured?.["files"] as File[];
    }

    it("has the three links the Statutes Affected Table gives for SB 69", async () => {
      const [file, ...others] = await filesOf("SB 69-2");

      expect(others).toEqual([]);
      expect(file?.statute_links).toEqual(
        expect.arrayContaining([
          section("amends", "ors-653.616", "8"),
          chapter("adds-to", "ors-chapter-657b", "1"),
          section("amends", "ors-659a.159", "4"),
        ]),
      );
    });

    it("lists the sections it amends and the chapter it adds to first, by kind and then by measure section", async () => {
      const [file] = await filesOf("SB 69-2");

      const links = file?.statute_links ?? [];
      expect(links.slice(0, 9)).toEqual([
        section("amends", "ors-657b.070", "3"),
        section("amends", "ors-659a.159", "4"),
        section("amends", "ors-659a.165", "5"),
        section("amends", "ors-657b.400", "6"),
        section("amends", "ors-657b.060", "7"),
        section("amends", "ors-653.616", "8"),
        section("amends", "ors-653.626", "9"),
        section("amends", "ors-659a.156", "10"),
        chapter("adds-to", "ors-chapter-657b", "1"),
      ]);
      expect(links.slice(9).every((link) => link.kind === "cites")).toBe(true);
    });

    it("shows a passing mention as a citation, not as an amendment", async () => {
      const [file] = await filesOf("SB 69-2");

      // Section 2 says "the requirements under ORS 657B.060, and the provisions of ORS 657B.070"; section 3
      // opens "(a) Violate ORS 657B.060" and refers to ORS 659A.885 and 659A.820 and to appeals under ORS 657B.410 and 657B.420.
      const links = file?.statute_links ?? [];
      expect(links).toEqual(
        expect.arrayContaining([
          section("cites", "ors-657b.060", "2"),
          section("cites", "ors-657b.070", "2"),
          section("cites", "ors-657b.060", "3"),
          section("cites", "ors-659a.885", "3"),
          section("cites", "ors-659a.820", "3"),
          section("cites", "ors-657b.410", "3"),
          section("cites", "ors-657b.420", "3"),
        ]),
      );
      // ORS 657B.410 and 657B.420 are named, and nothing is amended there.
      expect(links.filter((link) => link.kind === "amends").map((link) => link.target_id)).not.toContain(
        "ors-657b.410",
      );
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

  describe("what the comparison covers", () => {
    it("carries the note that what the amendment deletes was not evaluated", async () => {
      const outcome = await callTool(connected, "compare_amendment", { amendment: "SB 69-2" });

      expect(outcome.structured?.["deletions_note"]).toBe(
        "What this amendment deletes from the Version it amends was not evaluated: only the Statute Links in the sections the amendment inserts and its edits to the relating clause are read, so a link of the Version that the amendment does not mention is not shown as removed.",
      );
    });
  });
});
