// Seam 1: what compare_amendment says when the evidence about the Version an amendment amends is missing or
// disagrees, when an amendment's postings hold different files, and when a file has no text layer or never
// came. The committed fixture has none of these (test/fixtures/CLAUDE.md: it is never edited by hand), so each
// case adds a feed row to the fake OLIS (`strayRows`), served with a fixture file (`strayDocuments`), or makes
// a fixture file fail (`documentFailures`). EVERY ROW IN `madeUp` IS MADE UP: its id (9900xx), its amendment number
// and the file it is served with are not the feed's. What is real is each file: it is a fixture document, and what
// compare_amendment reads of it is what it reads of the fixture's own. Cases that only read the fixture are in
// compare-amendment.test.ts. Every case runs once with a 2026-07-28 client and once with a legacy client.
// Which cases copy (test/CLAUDE.md, "Templates"): the two describes that add made-up rows and read them copy the run's template of the fixture's pull, add the rows (and their files) with `addRows` and `addStrayDocuments`, and pull, which fetches only what they add. The two whose subject is a file that fails to come keep a real pull.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { noLinks, sectionTarget, triplesOf, type StatuteLinks } from "../support/statute-links.ts";
import { startCopiedSystem, startSystem, type System } from "../support/system.ts";

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
  statute_links: StatuteLinks;
};
type File = {
  posting_ids: string[];
  text_read: boolean;
  not_read_reason: string | null;
  statute_links: StatuteLinks;
};
type Comparison = {
  amendment: { postings: { id: string; fetched: boolean }[] };
  amended_version: Amended;
  files: File[];
  deletions_note: string;
};

/** The part of get_measure's statute_links_by_source that says which amendments are current and which are replaced. */
type Block = {
  versions: { label: string }[];
  proposed_amendments: { id: string; amended_version: { known: boolean; reason: string } }[];
  superseded_amendments: {
    id: string;
    number: string;
    amended_version: { id: string | null; label: string; source_url: string | null };
    later_version: { id: string; label: string };
  }[];
};

async function blockOf(connected: ConnectedClient, measure: string): Promise<Block> {
  const outcome = await callTool(connected, "get_measure", { measure });
  expect(outcome.isError).toBe(false);
  return outcome.structured?.["statute_links_by_source"] as Block;
}

describe("amendments the fixture has no row for", () => {
  // SB 69-A9: a number that names A-Engrossed, on SB 69-2's file, whose header names Introduced.
  // SB 69-3: the file is SB 69's Introduced Version, which has no "PROPOSED AMENDMENTS TO" header.
  // SB 69-2 again, posted a third time with the file of SB 921-2 (header "SENATE BILL 921", Introduced).
  // SB 69-4: the file is a scan with no text layer (Exhibit 288141, the fixture's SB 64 scan).
  // SB 69-AB3: SB 69-2's file again, with a number that names no Version.
  // SB 69-B1: SB 69-2's file again, with a number that names B-Engrossed.
  // SB 69-5: two postings whose files are two different scans, Exhibit 288141 and Testimony 148731, neither with a
  //   text layer, so neither is read.
  // SB 69-6: two postings of the same scan (Exhibit 288141), so one file posted twice.
  const madeUp = [
    postingRow(990001, "-A9", `${root}/ProposedAmendment/26286`),
    postingRow(990002, "-3", `${root}/MeasureDocument/SB69/Introduced`),
    postingRow(990003, "-2", `${root}/ProposedAmendment/26923`),
    postingRow(990004, "-4", `${root}/ProposedAmendment/990004`),
    // The number "-AB3" names no Version in either form (digits alone, or one letter and digits).
    postingRow(990005, "-AB3", `${root}/ProposedAmendment/26286`),
    // SB 69-B1: a number that names B-Engrossed ("-B1", as the brief and Legislative Counsel's numbering have it).
    postingRow(990006, "-B1", `${root}/ProposedAmendment/26286`),
    postingRow(990007, "-5", `${root}/ProposedAmendment/990007`),
    postingRow(990008, "-5", `${root}/ProposedAmendment/990008`),
    postingRow(990009, "-6", `${root}/ProposedAmendment/990009`),
    postingRow(990010, "-6", `${root}/ProposedAmendment/990009`),
  ];
  let system: System;

  beforeAll(async () => {
    // The pull is not the subject: the case copies the template of the fixture's pull, adds the made-up rows and
    // their files, and pulls, which fetches and embeds only what it adds.
    system = await startCopiedSystem({ clockAt, documents: true, serverEnv: { MCP_RATE_LIMIT: "1000" } });
    system.olis.addRows("CommitteeProposedAmendments", madeUp);
    system.olis.addStrayDocuments({
      "/liz/2025R1/Downloads/ProposedAmendment/990004": "committee-meeting-documents/288141.pdf",
      "/liz/2025R1/Downloads/ProposedAmendment/990007": "committee-meeting-documents/288141.pdf",
      "/liz/2025R1/Downloads/ProposedAmendment/990008": "testimony/148731.pdf",
      "/liz/2025R1/Downloads/ProposedAmendment/990009": "committee-meeting-documents/288141.pdf",
    });
    await system.pullAgain();
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
        statute_links: noLinks,
      });
      // The file is SB 69-2's: its links are read all the same, and the deletions note is still there.
      expect(comparison.files.map((file) => file.posting_ids)).toEqual([["posting-2025r1-990001"]]);
      expect(comparison.files[0]?.statute_links.amends.sections[0]).toEqual(sectionTarget("ors-657b.070", "3"));
      expect(comparison.deletions_note).toContain("was not evaluated");
    });

    it("says the Version is not known when the file has no header, because nothing is guessed from the number alone", async () => {
      const comparison = await compare("SB 69-3");

      expect(comparison.amended_version.known).toBe(false);
      expect(comparison.amended_version.reason).toBe(
        'The header of the amendment\'s file (the line after "PROPOSED AMENDMENTS TO") could not be read, so which Version it amends is not known.',
      );
      expect(comparison.amended_version.statute_links).toEqual(noLinks);
    });

    it("reads the letter in a number as the engrossed Version it amends: -B1 names B-Engrossed", async () => {
      const comparison = await compare("SB 69-B1");

      expect(comparison.amended_version.known).toBe(false);
      expect(comparison.amended_version.reason).toBe(
        "The amendment's header names the Introduced Version but its number -B1 names the B-Engrossed Version, so which Version it amends is not known.",
      );
    });

    it("says the Version is not known when the number names no Version, however the header reads", async () => {
      // The citation form takes one letter and digits, so this amendment is asked for by its id.
      const comparison = await compare("amendment-2025r1-sb69-ab3");

      expect(comparison.amended_version.known).toBe(false);
      expect(comparison.amended_version.reason).toBe(
        "The amendment's number -AB3 is not a number with an optional Version letter (a number alone, as in -2, names Introduced, and a letter before it, as in -A3, names that engrossed Version), so which Version it amends is not known.",
      );
    });

    it("lists each distinct file of an amendment on its own with its posting ids, and picks none", async () => {
      const comparison = await compare("SB 69-2");

      // 26286 and 26288 share a file; the made-up posting 990003 is a different one, SB 921-2's, whose header
      // names another Measure ("SENATE BILL 921").
      expect(comparison.files.map((file) => file.posting_ids)).toEqual([
        ["posting-2025r1-26286", "posting-2025r1-26288"],
        ["posting-2025r1-990003"],
      ]);
      expect(triplesOf(comparison.files[0]?.statute_links ?? noLinks)).toContainEqual(["amends", "ors-653.616", "8"]);
      // SB 921-2 (pdftotext of proposed-amendments/26923.pdf): SECTION 1 refers to "ORS 285A.666 to ..."; nothing is amended.
      const other = comparison.files[1]?.statute_links ?? noLinks;
      expect(triplesOf(other)).toContainEqual(["cites", "ors-285a.666", "1"]);
      expect(other.amends).toEqual({ sections: [], chapters: [] });
    });

    // Replaces the case that asserted `known: true` here: it compared SB 921-2's file against SB 69's Introduced
    // Version and said the header and the number agreed, though the header names SENATE BILL 921 (finding F3).
    it("says the Version is not known when a file's header names another Measure, and names both Measures", async () => {
      const comparison = await compare("SB 69-2");

      expect(comparison.amended_version).toEqual({
        known: false,
        id: null,
        label: null,
        source_url: null,
        reason:
          "The amendment is to SB 69, but a file posted for it has a header that names SB 921, so which Version it amends is not known.",
        text_read: null,
        not_read_reason: null,
        statute_links: noLinks,
      });
    });

    it("reports a file with no text layer as not read, with no links, and does not call the Version known", async () => {
      const comparison = await compare("SB 69-4");

      expect(comparison.files).toEqual([
        {
          posting_ids: ["posting-2025r1-990004"],
          text_read: false,
          not_read_reason:
            "This index did not read the file for Statute Links: it has no text layer (a scan or a photograph), or the index has not read it yet. The empty list does not mean the document has none.",
          statute_links: noLinks,
          relating_clause_edits: [],
        },
      ]);
      expect(comparison.amended_version.known).toBe(false);
    });

    // Two scans are two different files, and neither was read, so nothing says they read the same: each is listed
    // with its own posting (finding F7). Postings that share one scan are one file.
    it("lists two different files that were both not read separately, and one file posted twice once", async () => {
      const different = await compare("SB 69-5");
      expect(different.files.map((file) => [file.posting_ids, file.text_read])).toEqual([
        [["posting-2025r1-990007"], false],
        [["posting-2025r1-990008"], false],
      ]);

      const same = await compare("SB 69-6");
      expect(same.files.map((file) => [file.posting_ids, file.text_read])).toEqual([
        [["posting-2025r1-990009", "posting-2025r1-990010"], false],
      ]);
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

describe("an amendment number the feed spells in more than one way", () => {
  // The feed spells one amendment's number more than one way (CommitteeProposedAmendments.json: HB 2344's 27679 is
  // "1" and 27883 is "-1"; SB 702's 29245 is "A6" and 29484 is "-A6"; HB 3051's three postings are "- 3"). They are
  // one amendment, because its id is minted from the number. EVERY ROW BELOW IS MADE UP (ids 9901xx): the spellings
  // are the real ones, put on SB 69 and HB 3795 in the order the review probed, and each is served with the
  // fixture's file of that Measure: 26286 (SB 69-2, header "SENATE BILL 69") and 28997 (HB 3795-A3, header
  // "A-ENGROSSED HOUSE BILL 3795").
  const slb21 = "2025-01-21T08:00:00";
  const slb30 = "2025-01-30T08:00:00";
  const sb69File = `${root}/ProposedAmendment/26286`;
  const hb3795File = `${root}/ProposedAmendment/28997`;
  const madeUp = [
    // SB 69 "7": a bare "7" at the earlier meeting, then "-7" at the later one.
    { ...postingRow(990101, "7", sb69File), MeetingDate: slb21 },
    { ...postingRow(990102, "-7", sb69File), MeetingDate: slb30 },
    // SB 69 "-8": "-8" at the earlier meeting, then "- 8" (HB 3051's spelling) at the later one.
    { ...postingRow(990103, "-8", sb69File), MeetingDate: slb21 },
    { ...postingRow(990104, "- 8", sb69File), MeetingDate: slb30 },
    // SB 69 "-9": the earlier posting is "-9" and the later one "--9", which is not a spelling of a number.
    { ...postingRow(990105, "-9", sb69File), MeetingDate: slb21 },
    { ...postingRow(990106, "--9", sb69File), MeetingDate: slb30 },
    // HB 3795 "A5": a letter and digits with no hyphen, as SB 702's "A6", on A-Engrossed's file. Posted to SHS
    // on 2025-05-15 08:00, the meeting of the real 28997 (agenda item 211461).
    {
      ...postingRow(990107, "A5", hb3795File),
      CommitteeAgendaItemId: 211461,
      CommitteeCode: "SHS",
      MeetingDate: "2025-05-15T08:00:00",
      MeasurePrefix: "HB",
      MeasureNumber: 3795,
    },
  ];
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystem({ clockAt, documents: true, serverEnv: { MCP_RATE_LIMIT: "1000" } });
    system.olis.addRows("CommitteeProposedAmendments", madeUp);
    await system.pullAgain();
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

    async function compare(reference: string): Promise<Comparison & { amendment: { number: string } }> {
      const outcome = await callTool(connected, "compare_amendment", { amendment: reference });
      expect(outcome.isError).toBe(false);
      return outcome.structured as unknown as Comparison & { amendment: { number: string } };
    }

    it("names Introduced for a number whose earliest posting spells it with no hyphen: the Version does not depend on the spelling", async () => {
      const comparison = await compare("SB 69-7");

      expect(comparison.amendment.number).toBe("7");
      expect(comparison.amended_version).toMatchObject({
        known: true,
        id: "version-2025r1-sb69-introduced",
        label: "Introduced",
      });
    });

    it("names Introduced for a number spelled with a space after the hyphen at one meeting and without at another", async () => {
      const comparison = await compare("SB 69-8");

      expect(comparison.amended_version).toMatchObject({ known: true, id: "version-2025r1-sb69-introduced" });
      expect(comparison.amendment.postings.map((posting) => posting.id)).toEqual([
        "posting-2025r1-990103",
        "posting-2025r1-990104",
      ]);
    });

    it("names A-Engrossed for a letter and digits with no hyphen, as the feed spells SB 702's A6", async () => {
      const comparison = await compare("HB 3795-A5");

      expect(comparison.amended_version).toMatchObject({
        known: true,
        id: "version-2025r1-hb3795-a-engrossed",
        label: "A-Engrossed",
      });
    });

    it("says the Version is not known when the postings spell the number in ways that do not name one Version, and names the spellings", async () => {
      const comparison = await compare("SB 69-9");

      expect(comparison.amended_version.known).toBe(false);
      expect(comparison.amended_version.reason).toBe(
        "The postings of the amendment write its number as -9 and --9, which do not name one Version, so which Version it amends is not known.",
      );
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
      expect(comparison.files[0]?.statute_links.amends).toEqual({
        sections: [sectionTarget("ors-418.808", "2")],
        chapters: [],
      });
    });

    // The amendment's header and number name A-Engrossed, which was not fetched, but B-Engrossed and Enrolled are
    // held: the amendment is replaced by a Version printed after the one it amends, whether or not that one came.
    it("does not list HB 3795-A3's links as current when B-Engrossed and Enrolled are held, though its own A-Engrossed is not", async () => {
      const block = await blockOf(connected, "HB 3795");

      expect(block.versions.map((version) => version.label)).toEqual(["Introduced", "B-Engrossed", "Enrolled"]);
      expect(block.proposed_amendments).toEqual([]);
      expect(block.superseded_amendments.find((amendment) => amendment.number === "-A3")).toEqual({
        id: "amendment-2025r1-hb3795-a3",
        number: "-A3",
        amended_version: { id: null, label: "A-Engrossed", source_url: null },
        later_version: {
          id: "version-2025r1-hb3795-b-engrossed",
          label: "B-Engrossed",
          source_url: `${root}/MeasureDocument/HB3795/B-Engrossed`,
        },
      });
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

describe("files that never came, when no later Version came either", () => {
  // HB 3795's A-Engrossed, B-Engrossed and Enrolled Versions all answer 404, so the store holds its Introduced Version
  // only. HB 3795-1 amends Introduced, which is held, and nothing later is held: its links are current. HB 3795-A3
  // names A-Engrossed, which is not held, and nothing later is held either: it stays listed, labelled "not known".
  let system: System;

  beforeAll(async () => {
    system = await startSystem({
      clockAt,
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
      olis: {
        documentFailures: {
          [`${root}/MeasureDocument/HB3795/A-Engrossed`]: [404],
          [`${root}/MeasureDocument/HB3795/B-Engrossed`]: [404],
          [`${root}/MeasureDocument/HB3795/Enrolled`]: [404],
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

    it("keeps HB 3795-A3 listed, labelled as not known, and keeps -1 listed, because no later Version is held", async () => {
      const block = await blockOf(connected, "HB 3795");

      expect(block.versions.map((version) => version.label)).toEqual(["Introduced"]);
      expect(block.superseded_amendments).toEqual([]);
      expect(block.proposed_amendments.map((amendment) => [amendment.id, amendment.amended_version.known])).toEqual([
        ["amendment-2025r1-hb3795-1", true],
        ["amendment-2025r1-hb3795-a3", false],
      ]);
      expect(block.proposed_amendments[1]?.amended_version.reason).toBe(
        "The amendment's header and number both name the A-Engrossed Version of HB 3795, which this index does not hold.",
      );
    });
  });
});
