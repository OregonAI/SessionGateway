// Seam 1: get_measure's Statute Links when the store does NOT yet hold the next Version of a Measure, when it
// comes in with a later pull, and for the rows the committed fixture lacks (ticket #13; ADR-0001: "When the next
// Version is printed, its parse replaces these links for that Measure"). This index reads that as a state, not a
// date: an amendment's links are listed while no Version later than the one it amends is held.
//
// The first two systems run the fake OLIS at 2025-02-01 12:00 Pacific, a day when SB 69 has its Introduced Version
// and the Proposed Amendments -1 and -2 and nothing more. This is not a trimmed feed: it is the feed as it stood.
// The fake OLIS hides a row created after its clock, and Feed/MeasureDocuments.json says SB 69's A-Engrossed
// Version and its Printed Amendment "Senate Amendments to Introduced" were created 2025-02-03T16:42, and its
// Enrolled Version 2025-05-05T17:06. The third system has the whole fixture and MADE-UP ROWS (ids 9900xx; labelled
// where they are used), for the cases the fixture lacks: an amendment whose Version is not known, a Version with no
// text layer, and a Version with no place in the order of printing.
// Every case runs once with a 2026-07-28 client and once with a legacy client.
//
// A case that only reads, or that moves a row, starts from a copy of the run's template for its options
// (test/CLAUDE.md, Database, Templates); the system with made-up rows pulls for itself.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import {
  chapterTarget,
  expectedLinks,
  noLinks,
  sectionTarget,
  triplesOf,
  type StatuteLinks,
} from "../support/statute-links.ts";
import { startCopiedSystem, startSystem, type System } from "../support/system.ts";

// A case that builds its own system and serves the documents pulls up to the fixture's 314 files, about four
// seconds on its own and more with the other files' workers running beside it (the default is five).
vi.setConfig({ testTimeout: 60_000 });
const root = "https://olis.oregonlegislature.gov/liz/2025R1/Downloads";

type Posting = { id: string; meeting_id: string; meeting_date: string; committee_code: string; meaning: string | null };
type Amendment = {
  id: string;
  number: string;
  amended_version: { known: boolean; id: string | null; label: string | null; reason: string };
  postings: Posting[];
  files: { posting_ids: string[]; text_read: boolean; statute_links: StatuteLinks }[];
};
type Block = {
  versions: {
    id: string;
    label: string;
    same_links_as?: string;
    text_read?: boolean;
    not_read_reason?: string | null;
    statute_links?: StatuteLinks;
  }[];
  proposed_amendments: Amendment[];
  superseded_amendments: { id: string; number: string; later_version: { id: string; label: string } }[];
};

/** SB 69's A-Engrossed and Enrolled Versions and -2 all amend the same eight sections and add to chapter 657B (pdftotext). */
const sb69Amends = [
  sectionTarget("ors-657b.070", "3"),
  sectionTarget("ors-659a.159", "4"),
  sectionTarget("ors-659a.165", "5"),
  sectionTarget("ors-657b.400", "6"),
  sectionTarget("ors-657b.060", "7"),
  sectionTarget("ors-653.616", "8"),
  sectionTarget("ors-653.626", "9"),
  sectionTarget("ors-659a.156", "10"),
];
const sb69AddsTo = [chapterTarget("ors-chapter-657b", "1")];

async function blockOf(connected: ConnectedClient, measure: string): Promise<Block> {
  const outcome = await callTool(connected, "get_measure", { measure });
  expect(outcome.isError).toBe(false);
  return outcome.structured?.["statute_links_by_source"] as Block;
}

// Feed/CommitteeProposedAmendments.json: -1 has rows 26284 (SLB 2025-01-21 08:00, Proposed), 26285 (2025-01-28,
// Proposed) and 26287 (2025-01-30, Proposed); -2 has 26286 (2025-01-28, Proposed) and 26288 (2025-01-30, Adopted).
// Times are Pacific in January: -08:00.
describe("the feed as it stood on 2025-02-01", () => {
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystem({
      clockAt: "2025-02-01T20:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
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

    it("holds only SB 69's Introduced Version, so the links of -1 and -2 are listed, each under its own number and what the committee did", async () => {
      const block = await blockOf(connected, "SB 69");

      expect(block.versions.map((version) => version.label)).toEqual(["Introduced"]);
      expect(block.superseded_amendments).toEqual([]);
      expect(block.proposed_amendments.map((amendment) => amendment.id)).toEqual([
        "amendment-2025r1-sb69-1",
        "amendment-2025r1-sb69-2",
      ]);
      const [first, second] = block.proposed_amendments;
      expect(first?.number).toBe("-1");
      expect(first?.postings.map((posting) => [posting.id, posting.meeting_date, posting.meaning])).toEqual([
        ["posting-2025r1-26284", "2025-01-21T08:00:00-08:00", "Proposed"],
        ["posting-2025r1-26285", "2025-01-28T08:00:00-08:00", "Proposed"],
        ["posting-2025r1-26287", "2025-01-30T08:00:00-08:00", "Proposed"],
      ]);
      expect(second?.number).toBe("-2");
      expect(second?.postings.map((posting) => [posting.id, posting.meeting_date, posting.meaning])).toEqual([
        ["posting-2025r1-26286", "2025-01-28T08:00:00-08:00", "Proposed"],
        ["posting-2025r1-26288", "2025-01-30T08:00:00-08:00", "Adopted"],
      ]);
    });

    it("shows -2's links and -1's, with the measure section each came from, and the Introduced Version they amend", async () => {
      const block = await blockOf(connected, "SB 69");

      const [first, second] = block.proposed_amendments;
      for (const amendment of [first, second]) {
        expect(amendment?.amended_version).toMatchObject({
          known: true,
          id: "version-2025r1-sb69-introduced",
          label: "Introduced",
        });
        expect(amendment?.files).toHaveLength(1);
      }
      // -2 (pdftotext of proposed-amendments/26286.pdf) has the structure of the Enrolled Version.
      expect(second?.files[0]?.posting_ids).toEqual(["posting-2025r1-26286", "posting-2025r1-26288"]);
      expect(second?.files[0]?.statute_links.amends).toEqual({ sections: sb69Amends, chapters: [] });
      expect(second?.files[0]?.statute_links["adds-to"]).toEqual({ sections: [], chapters: sb69AddsTo });
      // -1 (proposed-amendments/26284.pdf) amends 657B.070 in SECTION 3 and adds SECTION 2 of the Act to chapter 657B.
      expect(first?.files[0]?.posting_ids).toEqual([
        "posting-2025r1-26284",
        "posting-2025r1-26285",
        "posting-2025r1-26287",
      ]);
      expect(triplesOf(first?.files[0]?.statute_links ?? noLinks)).toEqual(
        expect.arrayContaining([
          ["amends", "ors-657b.070", "3"],
          ["adds-to", "ors-chapter-657b", "1"],
        ]),
      );
    });

    it("also shows the Introduced Version's own link, beside the amendments", async () => {
      const block = await blockOf(connected, "SB 69");

      expect(block.versions[0]?.statute_links).toEqual(
        expectedLinks({ cites: { sections: [sectionTarget("ors-192.245", "1")] } }),
      );
    });
  });
});

// The case moves the clock and pulls again, which changes the database, so each era gets a system of its own.
// A real pull from an empty database: the case counts the requests of the first pull and of the second (test/CLAUDE.md).
describe.for(eras)("when the next Version comes in with a later pull, for a %s client", (era) => {
  let system: System;
  let connected: ConnectedClient;

  beforeAll(async () => {
    system = await startSystem({
      clockAt: "2025-02-01T20:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
    });
    connected = await connectClient(era, system.handler);
  }, 60_000);

  afterAll(async () => {
    await connected.close();
    await system.stop();
  });

  it("lists the amendments' links before, and the new Version's links instead of them after", async () => {
    const before = await blockOf(connected, "SB 69");
    expect(before.proposed_amendments.map((amendment) => amendment.number)).toEqual(["-1", "-2"]);

    // 2026-08-05: A-Engrossed (created 2025-02-03) and Enrolled (2025-05-05) now exist in the feed.
    system.clock.set("2026-08-05T17:00:00Z");
    await system.pullAgain();

    // The second pull reads the Versions it newly holds from the text it stores, and fetches nothing it already held
    // (ADR-0005: a fetched file is unchanging): SB 69-2's posting was asked for once, by the first pull.
    expect(system.olis.documentRequests().filter((path) => path.endsWith("/ProposedAmendment/26286"))).toHaveLength(1);

    const after = await blockOf(connected, "SB 69");
    expect(after.versions.map((version) => version.label)).toEqual(["Introduced", "A-Engrossed", "Enrolled"]);
    expect(after.versions[1]?.statute_links?.amends).toEqual({ sections: sb69Amends, chapters: [] });
    expect(after.versions[1]?.statute_links?.["adds-to"]).toEqual({ sections: [], chapters: sb69AddsTo });
    expect(after.proposed_amendments).toEqual([]);
    expect(after.superseded_amendments.map((amendment) => [amendment.number, amendment.later_version.label])).toEqual([
      ["-1", "A-Engrossed"],
      ["-2", "A-Engrossed"],
    ]);
  });
});

// EVERY ROW IN THIS SYSTEM IS MADE UP: ids 990011 to 990013 and their files are not the feed's. SB 69's whole
// fixture is held (Introduced, A-Engrossed, Enrolled). 990011 is a posting "-3" of SB 69 whose file is SB 69's
// Introduced Version, which has no "PROPOSED AMENDMENTS TO" header, so the Version it amends is not known.
// 990012 is a "B-Engrossed" Version of SB 69 served with a scan (Exhibit 288141) that has no text layer.
// 990013 is a "Minority Report A-Engrossed" Version, which the feed lists for 8 Measures of the Session
// (docs/adr/0013), served with SB 69's real A-Engrossed file; it has no place in the order of printing.
describe("rows the fixture lacks", () => {
  const unreadableAmendment = {
    ProposedAmendmentId: 990011,
    CommitteeAgendaItemId: 202165,
    SessionKey: "2025R1",
    CommitteeCode: "SLB",
    MeetingDate: "2025-01-30T08:00:00",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    AmendmentNumber: "-3",
    Meaning: "Proposed",
    ProposedAmendmentUrl: `${root}/MeasureDocument/SB69/Introduced`,
    CreatedDate: "2025-01-23T16:00:00",
    ModifiedDate: null,
  };
  const versionRow = (description: string): Record<string, unknown> => ({
    SessionKey: "2025R1",
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    VersionDescription: description,
    DocumentUrl: `${root}/MeasureDocument/SB69/${description}`,
    CreatedDate: "2025-03-01T10:00:00",
    ModifiedDate: null,
  });
  let system: System;

  beforeAll(async () => {
    system = await startCopiedSystem({
      clockAt: "2026-08-05T17:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
      olis: {
        strayRows: {
          CommitteeProposedAmendments: [unreadableAmendment],
          MeasureDocuments: [versionRow("B-Engrossed"), versionRow("Minority Report A-Engrossed")],
        },
        strayDocuments: {
          "/liz/2025R1/Downloads/MeasureDocument/SB69/B-Engrossed": "committee-meeting-documents/288141.pdf",
          "/liz/2025R1/Downloads/MeasureDocument/SB69/Minority%20Report%20A-Engrossed":
            "measure-documents/SB69/A-Engrossed.pdf",
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

    it("keeps listing an amendment whose Version is not known, labelled so, while -1 and -2 are replaced", async () => {
      const block = await blockOf(connected, "SB 69");

      expect(block.proposed_amendments.map((amendment) => amendment.id)).toEqual(["amendment-2025r1-sb69-3"]);
      expect(block.proposed_amendments[0]?.amended_version).toMatchObject({ known: false, id: null, label: null });
      expect(block.proposed_amendments[0]?.amended_version.reason).toContain("could not be read");
      expect(block.superseded_amendments.map((amendment) => amendment.number)).toEqual(["-1", "-2"]);
    });

    it("lists a Version with no text layer as not read, and a Version with no place in the order of printing last", async () => {
      const block = await blockOf(connected, "SB 69");

      // The made-up Minority Report is served with the A-Engrossed file, and Enrolled reads the same as that file: so the
      // Minority Report's links are the same as Enrolled's, the Version before it in print order (ADR-0036). Enrolled
      // is listed in full: the Version before it, B-Engrossed, was not read, and a Version that was not read is nothing
      // another can be the same as.
      expect(block.versions.map((version) => [version.label, version.text_read, version.same_links_as])).toEqual([
        ["Introduced", true, undefined],
        ["A-Engrossed", true, undefined],
        ["B-Engrossed", false, undefined],
        ["Enrolled", true, undefined],
        ["Minority Report A-Engrossed", undefined, "version-2025r1-sb69-enrolled"],
      ]);
      const scan = block.versions[2];
      expect(scan?.statute_links).toEqual(noLinks);
      expect(scan?.not_read_reason).toContain("no text layer");
    });

    it("does not let a Version with no place in the order replace an amendment, but does let a held later one", async () => {
      // -1 and -2 amend Introduced; A-Engrossed (and B-Engrossed and Enrolled) are later and held. The minority
      // report is later than none, so it is never the Version named as the one that replaces an amendment.
      const block = await blockOf(connected, "SB 69");

      expect(block.superseded_amendments.map((amendment) => amendment.later_version.label)).toEqual([
        "A-Engrossed",
        "A-Engrossed",
      ]);
    });
  });
});

// MADE UP, as above: id 990013's row, a "Minority Report A-Engrossed" Version of SB 69 (the feed lists such Versions
// for 8 Measures of the Session, docs/adr/0013), served with SB 69's A-Engrossed file, on the day before the real
// A-Engrossed exists. It has no place in the order of printing, so it is not "a Version later than Introduced",
// and -1 and -2 keep their links.
describe.for(eras)("a Version with no place in the order of printing is the only later one, for a %s client", (era) => {
  let system: System;
  let connected: ConnectedClient;

  beforeAll(async () => {
    system = await startCopiedSystem({
      clockAt: "2025-02-01T20:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
      olis: {
        strayRows: {
          MeasureDocuments: [
            {
              SessionKey: "2025R1",
              MeasurePrefix: "SB",
              MeasureNumber: 69,
              VersionDescription: "Minority Report A-Engrossed",
              DocumentUrl: `${root}/MeasureDocument/SB69/Minority Report A-Engrossed`,
              CreatedDate: "2025-01-31T10:00:00",
              ModifiedDate: null,
            },
          ],
        },
        strayDocuments: {
          "/liz/2025R1/Downloads/MeasureDocument/SB69/Minority%20Report%20A-Engrossed":
            "measure-documents/SB69/A-Engrossed.pdf",
        },
      },
    });
    connected = await connectClient(era, system.handler);
  }, 60_000);

  afterAll(async () => {
    await connected.close();
    await system.stop();
  });

  it("keeps -1 and -2 listed, and lists the minority report's Version after Introduced", async () => {
    const block = await blockOf(connected, "SB 69");

    expect(block.versions.map((version) => version.label)).toEqual(["Introduced", "Minority Report A-Engrossed"]);
    expect(block.proposed_amendments.map((amendment) => amendment.number)).toEqual(["-1", "-2"]);
    expect(block.superseded_amendments).toEqual([]);
  });
});

// MADE UP, as above: ids 990021 and 990022, two postings of SB 69's amendment "7", the first written "7" (the
// way the feed writes HB 2344's 27679, SB 108's 28657 and HB 2741's 28785) and the second "-7", both served with
// SB 69-2's file. The amendment is one node, its number names the Introduced Version whichever posting is first,
// and A-Engrossed and Enrolled are held, so its links are replaced and it is listed as superseded, not as current.
describe.for(eras)("an amendment whose earliest posting writes its number with no hyphen, for a %s client", (era) => {
  let system: System;
  let connected: ConnectedClient;
  const posting = (id: number, number: string, meetingDate: string): Record<string, unknown> => ({
    ProposedAmendmentId: id,
    CommitteeAgendaItemId: 202165,
    SessionKey: "2025R1",
    CommitteeCode: "SLB",
    MeetingDate: meetingDate,
    MeasurePrefix: "SB",
    MeasureNumber: 69,
    AmendmentNumber: number,
    Meaning: "Proposed",
    ProposedAmendmentUrl: `${root}/ProposedAmendment/26286`,
    CreatedDate: "2025-01-23T16:00:00",
    ModifiedDate: null,
  });

  beforeAll(async () => {
    system = await startCopiedSystem({
      clockAt: "2026-08-05T17:00:00Z",
      documents: true,
      serverEnv: { MCP_RATE_LIMIT: "1000" },
      olis: {
        strayRows: {
          CommitteeProposedAmendments: [
            posting(990021, "7", "2025-01-21T08:00:00"),
            posting(990022, "-7", "2025-01-30T08:00:00"),
          ],
        },
      },
    });
    connected = await connectClient(era, system.handler);
  }, 60_000);

  afterAll(async () => {
    await connected.close();
    await system.stop();
  });

  it("replaces its links with A-Engrossed's, and does not list it as current", async () => {
    const block = await blockOf(connected, "SB 69");

    expect(block.proposed_amendments).toEqual([]);
    expect(block.superseded_amendments.find((amendment) => amendment.id === "amendment-2025r1-sb69-7")).toMatchObject({
      number: "7",
      later_version: { label: "A-Engrossed" },
    });
  });
});
