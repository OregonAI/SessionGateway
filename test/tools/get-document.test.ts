// Seam 1 (test/CLAUDE.md): get_document as an agent sees it, with the whole system behind it. A fake
// OLIS serves the committed fixture and its 280 documents as the feed stood in August 2026, the ingest
// worker pulls them into a database, and an MCP client calls the tool in-process. One database serves
// every case in this file because none of them changes it; cases that build their own are in
// get-document-pull.test.ts.
//
// Its database is shared by every case and is a copy of the run's template for its options (test/CLAUDE.md,
// Database, Templates).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { startCopiedSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // 2026-08-01 10:00 in Oregon: every row of the fixture exists by then (the newest Exhibit row was
  // created on 2026-07-27), so the pull fetches all 280 documents.
  system = await startCopiedSystem({ clockAt: "2026-08-01T17:00:00Z", documents: true });
}, 60_000);

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("get_document for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Expected values are literals from outside the code. The text is SB 69's Introduced Version as
  // `pdftotext -raw` prints it (test/fixtures/olis-2025R1/documents/measure-documents/SB69/Introduced.pdf);
  // the hash is the manifest's sha256 of those bytes; the URL is the feed row's DocumentUrl
  // (feed/MeasureDocuments.json); the retrieval time is the simulated clock's.
  it("returns SB 69's Introduced Version exactly as published, with where and when it came from", async () => {
    const outcome = await callTool(connected, "get_document", { id: "version-2025r1-sb69-introduced" });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({
      id: "version-2025r1-sb69-introduced",
      kind: "version",
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Introduced",
      retrieved_at: "2026-08-01T10:00:00-07:00",
      content_hash: "a306d6c6bf7d1a16814d60bc731f7ef6d1be4dfd3198edcfab27feca14f34f99",
      has_text_layer: true,
      part: 1,
      part_count: 1,
    });
    const text = String(outcome.structured?.["text"]);
    expect(text).toContain(
      "SECTION 1. The Employment Department shall study issues related to laws concerning\n" +
        "job-protected leave from work. The department shall submit a report in the manner provided\n" +
        "by ORS 192.245, and may include recommendations for legislation, to the interim committees\n" +
        "of the Legislative Assembly related to business and labor no later than September 15, 2026.\n" +
        "SECTION 2. Section 1 of this 2025 Act is repealed on January 2, 2027.",
    );
    expect.soft(outcome.structured?.["notice"]).toMatch(/not the official record/i);
    expect.soft(outcome.structured?.["as_of"]).toBe("2026-08-01T10:00:00-07:00");
    expect(outcome.structured?.["related"]).toContainEqual(
      expect.objectContaining({ id: "measure-2025r1-sb69", relation: "measure" }),
    );
  });

  // One row per kind of document and per wording of its name. Each row names the feed row it comes
  // from (test/fixtures/olis-2025R1/feed/) and gives the id (spec #1, "Session graph"), the label and
  // the link as that row writes them, and the nodes the row points at.
  type Row = {
    /** False for the fixture's three scans. */
    hasTextLayer?: boolean;
    document: string;
    id: string;
    kind: string;
    label: string;
    sourceUrl: string;
    related: [relation: string, id: string][];
  };
  const kinds: Row[] = [
    {
      document: "MeasureDocuments row for HB 3795, Senate Amendments to A-Engrossed (a Printed Amendment)",
      id: "printed-amendment-2025r1-hb3795-senate-amendments-to-a-engrossed",
      kind: "printed_amendment",
      label: "Senate Amendments to A-Engrossed",
      // The feed writes the spaces raw; the link a person can follow has them percent-encoded.
      sourceUrl:
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/Senate%20Amendments%20to%20A-Engrossed",
      // Its description names the Version it amends: "Senate Amendments to A-Engrossed".
      related: [
        ["measure", "measure-2025r1-hb3795"],
        ["version", "version-2025r1-hb3795-a-engrossed"],
      ],
    },
    {
      // The row spells the committee property `CommittteCode` and the key `MeasureAnalysisId` as a string.
      // Its Version is "A", which is SB 69's A-Engrossed (olis-odata.md gotcha 9: "INTRO", "A", "B", ...).
      document: "MeasureAnalysisDocuments row 85414, SB 69's Fiscal Impact Statement",
      id: "analysis-2025r1-85414",
      kind: "analysis",
      label: "Fiscal Impact Statement",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/85414",
      related: [
        ["measure", "measure-2025r1-sb69"],
        ["committee", "committee-2025r1-slb"],
        ["version", "version-2025r1-sb69-a-engrossed"],
      ],
    },
    {
      document: "CommitteeMeetingDocuments row 287879, an Exhibit of SLB's 2025-01-21 meeting on SB 69",
      id: "exhibit-2025r1-287879",
      kind: "exhibit",
      label: "Meeting Material",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/287879",
      related: [
        ["measure", "measure-2025r1-sb69"],
        ["committee", "committee-2025r1-slb"],
        ["meeting", "meeting-2025r1-slb-2025-01-21-0800"],
      ],
    },
    {
      // The row's own DocumentUrl is only the session root, https://olis.oregonlegislature.gov/liz/2025R1
      // (olis-odata.md gotcha 2); the file is at /Downloads/PublicTestimonyDocument/{CommTestId}.
      document: "CommitteePublicTestimonies row 117165, Testimony on HB 3131 to HALNRW on 2025-01-22",
      id: "testimony-2025r1-117165",
      kind: "testimony",
      label: "Testimony",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/117165",
      related: [
        ["measure", "measure-2025r1-hb3131"],
        ["committee", "committee-2025r1-halnrw"],
        ["meeting", "meeting-2025r1-halnrw-2025-01-22-0800"],
      ],
    },
    {
      document: "MeasureDocuments row for HB 3795, B-Engrossed (a Version)",
      id: "version-2025r1-hb3795-b-engrossed",
      kind: "version",
      label: "B-Engrossed",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/B-Engrossed",
      related: [["measure", "measure-2025r1-hb3795"]],
    },
    {
      document: "MeasureDocuments row for HB 3795, Enrolled (a Version)",
      id: "version-2025r1-hb3795-enrolled",
      kind: "version",
      label: "Enrolled",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/Enrolled",
      related: [["measure", "measure-2025r1-hb3795"]],
    },
    {
      document: "MeasureDocuments row for HB 3795, House Amendments to Introduced (a Printed Amendment)",
      id: "printed-amendment-2025r1-hb3795-house-amendments-to-introduced",
      kind: "printed_amendment",
      label: "House Amendments to Introduced",
      sourceUrl:
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/HB3795/House%20Amendments%20to%20Introduced",
      related: [
        ["measure", "measure-2025r1-hb3795"],
        ["version", "version-2025r1-hb3795-introduced"],
      ],
    },
    {
      document: "MeasureDocuments row for SB 69, Senate Amendments to Introduced (a Printed Amendment)",
      id: "printed-amendment-2025r1-sb69-senate-amendments-to-introduced",
      kind: "printed_amendment",
      label: "Senate Amendments to Introduced",
      sourceUrl:
        "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB69/Senate%20Amendments%20to%20Introduced",
      related: [
        ["measure", "measure-2025r1-sb69"],
        ["version", "version-2025r1-sb69-introduced"],
      ],
    },
    {
      // The row's Version is "INTRO": HB 3131's Introduced Version.
      document: "MeasureAnalysisDocuments row 85719, HB 3131's Revenue Impact Statement",
      id: "analysis-2025r1-85719",
      kind: "analysis",
      label: "Revenue Impact Statement",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/85719",
      related: [
        ["measure", "measure-2025r1-hb3131"],
        ["committee", "committee-2025r1-halnrw"],
        ["version", "version-2025r1-hb3131-introduced"],
      ],
    },
    {
      // The row's Version is blank, as it is on 688 of the Session's rows (olis-odata.md gotcha 9).
      document: "MeasureAnalysisDocuments row 90799, SB 64's Staff Measure Summary",
      id: "analysis-2025r1-90799",
      kind: "analysis",
      label: "Staff Measure Summary",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureAnalysisDocument/90799",
      related: [
        ["measure", "measure-2025r1-sb64"],
        ["committee", "committee-2025r1-shs"],
      ],
    },
    {
      document: "CommitteeMeetingDocuments row 288487, a Witness Registration list for HALNRW on 2025-01-27",
      id: "exhibit-2025r1-288487",
      kind: "exhibit",
      label: "Witness Registration",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/288487",
      related: [
        ["measure", "measure-2025r1-hb3131"],
        ["committee", "committee-2025r1-halnrw"],
        ["meeting", "meeting-2025r1-halnrw-2025-01-27-0800"],
      ],
    },
    {
      hasTextLayer: false,
      document: "CommitteePublicTestimonies row 148731, a Photo submitted on SB 921 to SLB on 2025-03-11",
      id: "testimony-2025r1-148731",
      kind: "testimony",
      label: "Photo",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/148731",
      related: [
        ["measure", "measure-2025r1-sb921"],
        ["committee", "committee-2025r1-slb"],
        ["meeting", "meeting-2025r1-slb-2025-03-11-0800"],
      ],
    },
    {
      document: "CommitteeMeetings row for SLB on 2025-01-30 at 08:00, whose AgendaUrl is the agenda",
      id: "agenda-2025r1-slb-2025-01-30-0800",
      kind: "agenda",
      label: "Agenda",
      sourceUrl: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeAgenda/SLB/2025-01-30-08-00",
      related: [
        ["committee", "committee-2025r1-slb"],
        ["meeting", "meeting-2025r1-slb-2025-01-30-0800"],
      ],
    },
  ];

  it.for(kinds)("returns $document with its id, kind, label, link and related nodes", async (row) => {
    const outcome = await callTool(connected, "get_document", { id: row.id });

    expect(outcome.isError).toBe(false);
    expect(outcome.structured).toMatchObject({
      id: row.id,
      kind: row.kind,
      label: row.label,
      source_url: row.sourceUrl,
      has_text_layer: row.hasTextLayer ?? true,
    });
    const related = (outcome.structured?.["related"] as { id: string; relation: string }[]).map(
      (node) => [node.relation, node.id] as const,
    );
    expect(related.toSorted()).toEqual(row.related.toSorted());
  });

  describe("a Proposed Amendment posted to several meetings", () => {
    // SB 69's -1 has three rows in feed/CommitteeProposedAmendments.json, ProposedAmendmentId 26284
    // (SLB, 2025-01-21), 26285 (SLB, 2025-01-28) and 26287 (SLB, 2025-01-30): spec #1 says it "was posted
    // to three meetings". Its -2 has two (26286 on 2025-01-28, 26288 on 2025-01-30, adopted that day).
    it("is one node with a posting edge for each meeting it was posted to", async () => {
      const outcome = await callTool(connected, "get_document", { id: "amendment-2025r1-sb69-1" });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({
        id: "amendment-2025r1-sb69-1",
        kind: "proposed_amendment",
        label: "-1",
      });
      const related = (outcome.structured?.["related"] as { id: string; relation: string }[]).map(
        (node) => [node.relation, node.id] as const,
      );
      expect(related.toSorted()).toEqual(
        [
          ["measure", "measure-2025r1-sb69"],
          ["committee", "committee-2025r1-slb"],
          ["posted_to", "meeting-2025r1-slb-2025-01-21-0800"],
          ["posted_to", "meeting-2025r1-slb-2025-01-28-0800"],
          ["posted_to", "meeting-2025r1-slb-2025-01-30-0800"],
        ].toSorted(),
      );
    });

    // The files differ: the manifest's sha256 of 26284 (posted 01-21) is not that of 26285 and 26287
    // (posted 01-28 and 01-30), which are the same file (test/fixtures/olis-2025R1/manifest.json). Their
    // text is the same (`pdftotext -raw` prints 34,141 characters for each; only the PDF's ModDate
    // differs), so a posting whose text differs is built in get-document-pull.test.ts.
    it("keeps the file of each posting, and serves the latest posting's under the amendment's id", async () => {
      const node = await callTool(connected, "get_document", { id: "amendment-2025r1-sb69-1" });
      const first = await callTool(connected, "get_document", { id: "posting-2025r1-26284" });

      expect(node.structured).toMatchObject({
        document_id: "posting-2025r1-26287",
        content_hash: "6c7919c7745dc087d0a16f9d4c98b096481cc2856b6fda431c1220ab9e4d51d4",
      });
      expect(first.structured).toMatchObject({
        id: "posting-2025r1-26284",
        document_id: "posting-2025r1-26284",
        kind: "proposed_amendment",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/ProposedAmendment/26284",
        content_hash: "c58e10ef692899f88e4d595727d739117b5893775527c09737441b5d95e57fe3",
      });
      // Each posting edge names the meeting and the document posted there.
      expect(node.structured?.["related"]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: "posted_to",
            id: "meeting-2025r1-slb-2025-01-21-0800",
            document_id: "posting-2025r1-26284",
          }),
          expect.objectContaining({
            relation: "posted_to",
            id: "meeting-2025r1-slb-2025-01-28-0800",
            document_id: "posting-2025r1-26285",
          }),
          expect.objectContaining({
            relation: "posted_to",
            id: "meeting-2025r1-slb-2025-01-30-0800",
            document_id: "posting-2025r1-26287",
          }),
        ]),
      );
      // A posting points back at the amendment it is a text of.
      expect(first.structured?.["related"]).toContainEqual(
        expect.objectContaining({ relation: "amendment", id: "amendment-2025r1-sb69-1" }),
      );
    });

    // Spec #1: "SB 69-2 was adopted by SLB on 2025-01-30". The feed has it Proposed on 2025-01-28
    // (26286) and Adopted on 2025-01-30 (26288).
    it("says what the committee did with the amendment at each meeting", async () => {
      const outcome = await callTool(connected, "get_document", { id: "amendment-2025r1-sb69-2" });

      const postings = (outcome.structured?.["related"] as { relation: string; id: string; meaning: string | null }[])
        .filter((node) => node.relation === "posted_to")
        .map((node) => [node.id, node.meaning]);
      expect(postings).toEqual([
        ["meeting-2025r1-slb-2025-01-28-0800", "Proposed"],
        ["meeting-2025r1-slb-2025-01-30-0800", "Adopted"],
      ]);
    });

    // HB 3795's -A3 (spec #1, case (b)) is numbered with a letter: rows 28997 (SHS, 2025-05-15, Proposed),
    // 29108 (2025-05-20, Adopted) and 29109 (2025-05-22, Proposed).
    it("keeps the letter of an amendment number in its id", async () => {
      const outcome = await callTool(connected, "get_document", { id: "amendment-2025r1-hb3795-a3" });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({ label: "-A3", kind: "proposed_amendment" });
      const postings = (outcome.structured?.["related"] as { relation: string; id: string; meaning: string | null }[])
        .filter((node) => node.relation === "posted_to")
        .map((node) => [node.id, node.meaning]);
      expect(postings).toEqual([
        ["meeting-2025r1-shs-2025-05-15-0800", "Proposed"],
        ["meeting-2025r1-shs-2025-05-20-0800", "Adopted"],
        ["meeting-2025r1-shs-2025-05-22-0800", "Proposed"],
      ]);
    });

    // The feed writes SB 921's second -2 as "-2 " with a trailing space (ProposedAmendmentId 26923,
    // posted 2025-03-18, feed/CommitteeProposedAmendments.json); 26824 (2025-03-13) writes it "-2".
    it("treats a number the feed wrote with a trailing space as the same amendment", async () => {
      const outcome = await callTool(connected, "get_document", { id: "amendment-2025r1-sb921-2" });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({ label: "-2", document_id: "posting-2025r1-26923" });
      const meetings = (outcome.structured?.["related"] as { relation: string; id: string }[])
        .filter((node) => node.relation === "posted_to")
        .map((node) => node.id);
      expect(meetings).toEqual(["meeting-2025r1-slb-2025-03-13-0800", "meeting-2025r1-slb-2025-03-18-0800"]);
    });
  });

  describe("a long document", () => {
    // SB 69's A-Engrossed Version is 10 pages (`pdfinfo`), 35,802 characters and 29,734 that are not
    // whitespace as `pdftotext -raw` prints it: more than one part of at most 20,000 characters.
    const id = "version-2025r1-sb69-a-engrossed";

    it("is served in parts that say how many there are and add up to the text as published", async () => {
      const first = await callTool(connected, "get_document", { id });
      const count = Number(first.structured?.["part_count"]);
      const parts = [first];
      for (let part = 2; part <= count; part += 1) {
        parts.push(await callTool(connected, "get_document", { id, part }));
      }

      expect(count).toBe(2);
      expect(parts.map((outcome) => outcome.structured?.["part"])).toEqual([1, 2]);
      expect(parts.map((outcome) => outcome.structured?.["part_count"])).toEqual([2, 2]);
      const texts = parts.map((outcome) => String(outcome.structured?.["text"]));
      for (const text of texts) expect(text.length).toBeLessThanOrEqual(20_000);
      // A part ends at the end of a line, so no line is cut in two.
      expect(texts[0]).toMatch(/\n$/);

      const whole = texts.join("");
      expect(whole.replace(/\s/g, "")).toHaveLength(29_734);
      // Exactly as published: line numbers, the hyphen that breaks "Labor" across two lines, and the
      // form feed between pages are all kept (the page count is 10, so there are nine).
      expect(whole.startsWith("1\n2\n3\n")).toBe(true);
      expect(whole).toContain("the Bureau of La-\nbor and Industries is responsible for administrative");
      expect(whole.split("\f")).toHaveLength(10);
      expect(parts[0]?.structured).toMatchObject({ page_count: 10 });
    });

    it("tells an agent that asks for a part that is not there", async () => {
      const outcome = await callTool(connected, "get_document", { id, part: 3 });

      expect(outcome.isError).toBe(true);
      expect(outcome.text).toContain("2 parts");
    });
  });

  describe("an id written another way", () => {
    // Ids are minted in lower case (spec #1, "Session graph"), and get_measure reads "MEASURE-2025R1-SB69" as
    // the Measure it names. A document id is read the same way, and answered under the id as minted.
    it.for([
      ["in capitals", "VERSION-2025R1-SB69-INTRODUCED", "version-2025r1-sb69-introduced"],
      ["with spaces round it", "  version-2025r1-sb69-introduced  ", "version-2025r1-sb69-introduced"],
      ["a Proposed Amendment in capitals", "AMENDMENT-2025R1-SB69-2", "amendment-2025r1-sb69-2"],
      [
        "a Printed Amendment in capitals",
        "PRINTED-AMENDMENT-2025R1-SB69-SENATE-AMENDMENTS-TO-INTRODUCED",
        "printed-amendment-2025r1-sb69-senate-amendments-to-introduced",
      ],
    ] as const)("is read as the document it names: %s", async ([, written, minted]) => {
      const outcome = await callTool(connected, "get_document", { id: written });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({ id: minted });
    });
  });

  describe("an id that is not a document", () => {
    it.for([
      ["an id the Session does not have", "version-2025r1-sb69-z-engrossed"],
      ["a document of another Session", "version-2025s1-sb69-introduced"],
      ["a Measure id, which is a node and not a document", "measure-2025r1-sb69"],
      ["an Amendment of a Measure that has none by that number", "amendment-2025r1-sb69-9"],
      ["words that are not an id", "the paid leave bill"],
      ["an empty id", ""],
    ])("is a tool error, not a result: %s", async ([, id]) => {
      const outcome = await callTool(connected, "get_document", { id });

      expect(outcome.isError).toBe(true);
      expect(outcome.structured).toBeUndefined();
      expect(outcome.text).toContain("2025R1");
      // The message teaches the id form (spec #1's), so the agent can correct the call.
      expect(outcome.text).toContain("version-2025r1-sb69-a-engrossed");
    });
  });

  describe("session_overview", () => {
    // Counts are literals from the fixture: its README says it holds 10 Measures and 280 documents, and
    // feed/ has 12 Committees, 36 CommitteeMeetings, 25 MeasureDocuments (5 of them Printed Amendments:
    // "Senate Amendments to Introduced" for SB 69, SB 921 and SB 983, "House Amendments to Introduced"
    // and "Senate Amendments to A-Engrossed" for HB 3795), 34 MeasureAnalysisDocuments, 15
    // CommitteeProposedAmendments (postings of 7 amendments), 86 CommitteeMeetingDocuments and 84
    // CommitteePublicTestimonies. 33 of the 34 Recording Logs exist at this clock (ticket #124): SRULES's of 2025-04-23 was created 2026-08-04, so the Session holds 313 of the fixture's 314 documents.
    it("returns the Session, what the index holds, and when it was last refreshed", async () => {
      const outcome = await callTool(connected, "session_overview", {});

      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({
        session: "2025R1",
        as_of: "2026-08-01T10:00:00-07:00",
        counts: {
          measures: 10,
          committees: 12,
          meetings: 36,
          proposed_amendments: 7,
          documents: 313,
          documents_without_text_layer: 3,
          documents_by_kind: {
            version: 20,
            printed_amendment: 5,
            proposed_amendment: 15,
            analysis: 34,
            exhibit: 86,
            recording_log: 33,
            testimony: 84,
            agenda: 36,
            // The fixture holds no FloorLetters file (ticket #64).
            floor_letter: 0,
          },
        },
      });
      expect.soft(outcome.structured?.["notice"]).toMatch(/not the official record/i);
    });
  });

  describe("a ligature in the text layer", () => {
    // Served as the file's text layer holds it (ADR-0002): U+FB01, one character, not "fi". Each row's
    // source is outside the code. Testimony 117165's own ToUnicode map says `<010E> <FB01>` for the glyph
    // before "nancial"; `pdftotext -raw` on Testimony 209270 prints "de-identi\uFB01ed" with the same
    // character. (pdftotext splits the ligature in the other three files that have one, which is why the
    // rows are these two and not all five.)
    it.for([
      ["Testimony 117165 on HB 3131", "testimony-2025r1-117165", "technical assistance and \uFB01nancial\nincentives"],
      [
        "Testimony 209270 on HB 3795",
        "testimony-2025r1-209270",
        "CIRT\nreports are de-identi\uFB01ed and publicly-available.",
      ],
    ] as const)("is kept as one character, not split into letters: %s", async ([, id, quoted]) => {
      const outcome = await callTool(connected, "get_document", { id });

      expect(outcome.isError).toBe(false);
      expect(String(outcome.structured?.["text"])).toContain(quoted);
    });
  });

  describe("a document with no text layer", () => {
    // The fixture has three, none of which `pdftotext` finds a character in (test/fixtures/olis-2025R1/
    // README.md): Exhibit 288141 (SB 64, a 2-page scan) and the photographs behind SB 921's Testimony 148731
    // and 148734 (1 page each).
    it.for([
      ["Exhibit 288141, a scan of SB 64's tax expenditure report", "exhibit-2025r1-288141", 2],
      ["Testimony 148731, a photograph", "testimony-2025r1-148731", 1],
      ["Testimony 148734, a photograph", "testimony-2025r1-148734", 1],
    ] as const)("is flagged, and its empty text is not taken for the document: %s", async ([, id, pages]) => {
      const outcome = await callTool(connected, "get_document", { id });

      expect(outcome.isError).toBe(false);
      expect(outcome.structured).toMatchObject({
        id,
        has_text_layer: false,
        text: "",
        page_count: pages,
        part_count: 1,
      });
    });
  });
});

describe("the build report", () => {
  // The same three documents (test/fixtures/olis-2025R1/README.md), by the id and source_url the manifest
  // gives them. The report is a file beside the database, which the harness reads.
  it("lists every document with no text layer, and no document it failed to get", () => {
    const report = system.buildReport();

    expect(report["documents_not_fetched"]).toEqual([]);
    expect(report["documents_without_text_layer"]).toEqual([
      {
        id: "exhibit-2025r1-288141",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/CommitteeMeetingDocument/288141",
      },
      {
        id: "testimony-2025r1-148731",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/148731",
      },
      {
        id: "testimony-2025r1-148734",
        source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/PublicTestimonyDocument/148734",
      },
    ]);
  });
});
