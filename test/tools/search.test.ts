// Seam 1 (test/CLAUDE.md): `search` as an agent sees it, with the whole system behind it. A fake OLIS
// serves the committed fixture and its documents as the feed stood early in the 2025R1 Session, the
// ingest worker pulls and indexes them, and an MCP client calls the tool in-process. One database
// serves every case in this file because none of them changes it.
//
// Search here runs on the real embedding model (bge-small-en-v1.5, `npm run model:fetch`), because what
// these cases show is how well it ranks. The clock is 2025-01-17 18:00 Pacific. Every document the feed had created by then is in: the
// Introduced Versions of six Measures, four agendas, SB 69's Exhibit 287879 and Proposed Amendment -1,
// and three of HB 3131's letters. A later clock would include SB 64's Testimony 117281 (395,000
// characters) and take half a minute to embed with the real model.
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { callTool, connectClient, eras, type ConnectedClient } from "../support/mcp-clients.ts";
import { loadRealEmbedder } from "../support/real-embedder.ts";
import { startSystem, type System } from "../support/system.ts";

let system: System;

beforeAll(async () => {
  // The real model: these are the tests of how well search ranks. About 140,000 characters are embedded,
  // which takes about ten seconds on one core.
  system = await startSystem({
    clockAt: "2025-01-18T02:00:00Z",
    documents: true,
    embedder: await loadRealEmbedder(),
  });
}, 120_000);

afterAll(async () => {
  await system.stop();
});

describe.for(eras)("search for a %s client", (era) => {
  let connected: ConnectedClient;

  beforeAll(async () => {
    connected = await connectClient(era, system.handler);
  });

  afterAll(async () => {
    await connected.close();
  });

  // Expected values are literals from outside the code. The words are SB 64's Introduced Version as
  // `pdftotext -raw` prints it (test/fixtures/olis-2025R1/documents/measure-documents/SB64/Introduced.pdf);
  // the date is the CreatedDate of its MeasureDocuments row ("2025-01-10T13:20:18.827", Pacific); the link
  // is that row's DocumentUrl; the as-of time is the simulated clock's.
  it("finds a Version by words in its text, with everything an agent needs to cite it", async () => {
    const outcome = await callTool(connected, "search", {
      query: "waive supplemental nutrition assistance dependent care tax credit",
    });

    expect(outcome.isError).toBe(false);
    const first = (outcome.structured?.["results"] as Record<string, unknown>[])[0];
    expect(first).toMatchObject({
      id: "version-2025r1-sb64-introduced",
      kind: "version",
      title: "SB 64 Introduced",
      measure: "measure-2025r1-sb64",
      date: "2025-01-10T13:20:18.827-08:00",
      source_url: "https://olis.oregonlegislature.gov/liz/2025R1/Downloads/MeasureDocument/SB64/Introduced",
    });
    expect(String(first?.["snippet"])).toContain("Supplemental Nutrition");
    expect(String(first?.["snippet"]).length).toBeLessThanOrEqual(320);
    expect(outcome.structured?.["as_of"]).toBe("2025-01-17T18:00:00-08:00");
    expect(outcome.structured?.["notice"]).toMatch(/not the official record/i);
  });

  // A paraphrased question. Each expected document is chosen by reading it, and each question is worded from
  // the subject of that document without the distinctive words it holds, so that no passage holds all of the
  // question's words and only the meaning can bring the document up: the hit says it was found by meaning
  // alone, and it is the first hit.
  //  - HB 3027's Introduced Version (documents/measure-documents/HB3027/Introduced.pdf): "Permits the Higher
  //    Education Coordinating Commission to seek an injunction against a person or career school that is
  //    engaged ... in any activity in violation of career school licensure requirements."
  //  - SB 64's Introduced Version (SB64/Introduced.pdf): "Requires the Department of Human Services to seek a
  //    waiver of federal requirements in the Supplemental Nutrition Assistance Program in order to allow
  //    recipients ... to receive advance installment payments of the tax credit for dependent care expenses."
  //  - HB 3131's Introduced Version (HB3131/Introduced.pdf): "Appropriates moneys to the Oregon Watershed
  //    Enhancement Board, out of the General Fund, for deposit in the Oregon Agricultural Heritage Fund."
  test.for([
    {
      document: "version-2025r1-hb3027-introduced",
      question:
        "Gives the postsecondary oversight panel the power to ask a judge to halt vocational academies that ignore their permits",
    },
    {
      document: "version-2025r1-sb64-introduced",
      question:
        "A petition for an exemption from national food stamp rules, so that families keep their benefits when a childcare refund is paid early, month by month",
    },
    {
      document: "version-2025r1-hb3131-introduced",
      question:
        "Lets a legislator-sponsored cash grant go to a conservation program that keeps ranches from being turned into subdivisions",
    },
  ])("finds $document from a question that shares none of its words", async ({ document, question }) => {
    const outcome = await callTool(connected, "search", { query: question });

    const hits = outcome.structured?.["results"] as { id: string; found_by: string[] }[];
    expect(hits[0]).toMatchObject({ id: document, found_by: ["embedding"] });
  });

  // A keyword-only document is found by its words and never by meaning (ADR-0006), so a question with a word that
  // the document lacks must still find it by the words it has. SLB's agenda for 2025-01-21 lists SB 397, "Provides
  // that laws regarding employee entitlements for recovery of unpaid wages and penalties do not apply to wages and
  // penalties lost as a result of an employer's time-rounding policies"
  // (documents/committee-agendas/SLB/2025-01-21-08-00.pdf, `pdftotext -raw`). It is the only document of the fixture
  // that holds "time-rounding", and it lacks "claims". The corpus has three more agendas, none of which holds
  // "time-rounding" or "claims".
  it("finds an agenda from a question that has a word the agenda lacks", async () => {
    const query = "time-rounding wage claims";

    const everything = await callTool(connected, "search", { query });
    const agendas = await callTool(connected, "search", { query, kind: "agenda" });

    const slb = (everything.structured?.["results"] as { id: string; found_by: string[] }[]).find(
      (hit) => hit.id === "agenda-2025r1-slb-2025-01-21-0800",
    );
    expect(slb?.found_by).toEqual(["keyword"]);
    expect((agendas.structured?.["results"] as { id: string }[])[0]?.id).toBe("agenda-2025r1-slb-2025-01-21-0800");
  });

  // Testimony. HB 3131's Testimony 117165, 117166 and 117167 (CommitteePublicTestimonies rows, all three
  // written on 2025-01-17 for HB 3131) are letters from the Oregon Climate and Agriculture Network, American
  // Farmland Trust and the Oregon Association of Conservation Districts about the Oregon Agricultural
  // Heritage Program. The query is words from them and from HB 3131's Introduced Version, which also holds
  // "Oregon Agricultural Heritage Fund", so a general search has something to return that is not Testimony.
  const heritageQuery = "Oregon Agricultural Heritage";
  const idsOf = (outcome: { structured: Record<string, unknown> | undefined }): string[] =>
    (outcome.structured?.["results"] as { id: string }[]).map((result) => result.id);
  const kindsOf = (outcome: { structured: Record<string, unknown> | undefined }): string[] =>
    (outcome.structured?.["results"] as { kind: string }[]).map((result) => result.kind);
  const letters = ["testimony-2025r1-117165", "testimony-2025r1-117166", "testimony-2025r1-117167"];

  it("leaves Testimony out of a general search", async () => {
    const outcome = await callTool(connected, "search", { query: heritageQuery });

    expect(idsOf(outcome)).toContain("version-2025r1-hb3131-introduced");
    expect(kindsOf(outcome)).not.toContain("testimony");
  });

  it("includes Testimony when the call asks for it", async () => {
    const outcome = await callTool(connected, "search", { query: heritageQuery, include_testimony: true });

    expect(idsOf(outcome)).toEqual(expect.arrayContaining(letters));
  });

  it("includes Testimony when the search is scoped to one Measure, by citation or by id", async () => {
    for (const measure of ["HB 3131", "measure-2025r1-hb3131"]) {
      const outcome = await callTool(connected, "search", { query: heritageQuery, measure });

      expect(idsOf(outcome), measure).toEqual(expect.arrayContaining(letters));
    }
  });
  // ADR-0006: Testimony is left out "unless the question asks for it or is about one Measure". A question asks for it
  // when it holds the word "testimony"; it is about one Measure when it cites exactly one (a citation of a Measure the
  // index holds). Such a question is scoped to the Measure for this rule only: it is not filtered to that Measure.
  describe("a question that asks for Testimony or is about one Measure", () => {
    const among = (outcome: { structured: Record<string, unknown> | undefined }, count: number): string[] =>
      idsOf(outcome).slice(0, count);

    it("includes Testimony when it holds the word testimony, in any case", async () => {
      for (const query of ["testimony on HB 3131", "TESTIMONY about the Oregon Agricultural Heritage Fund"]) {
        const outcome = await callTool(connected, "search", { query });

        expect(among(outcome, 8), query).toEqual(expect.arrayContaining(letters));
      }
    });

    it("includes Testimony when it cites exactly one Measure, though it does not say testimony", async () => {
      const outcome = await callTool(connected, "search", { query: "Oregon Agricultural Heritage HB 3131" });

      expect(among(outcome, 8)).toEqual(expect.arrayContaining(letters));
    });

    it("is not filtered to that Measure: the other Measures' documents are still found", async () => {
      const outcome = await callTool(connected, "search", { query: "Oregon Agricultural Heritage HB 3131" });

      const measures = (outcome.structured?.["results"] as { measure: string | null }[]).map((hit) => hit.measure);
      expect(new Set(measures).size).toBeGreaterThan(2);
    });

    it("leaves Testimony out when it cites two Measures, which is a question about neither", async () => {
      const outcome = await callTool(connected, "search", { query: "Oregon Agricultural Heritage HB 3131 SB 64" });

      expect(kindsOf(outcome)).not.toContain("testimony");
    });

    it("leaves Testimony out when the Measure it cites is not in the index", async () => {
      const outcome = await callTool(connected, "search", { query: "Oregon Agricultural Heritage HB 9999" });

      expect(kindsOf(outcome)).not.toContain("testimony");
    });
  });

  // Filters. The corpus (see the top of the file) has these committee-bound documents, from the feed's
  // CommitteeMeetings, CommitteeProposedAmendments, CommitteeMeetingDocuments and CommitteePublicTestimonies
  // rows created by then: SLB's agenda for 2025-01-21, SB 69's Exhibit 287879 and Proposed Amendment -1
  // (posted to SLB on 2025-01-21), HALNRW's agendas for 2025-01-22 and 2025-01-27, HB 3131's three letters
  // (HALNRW, 2025-01-22) and SHS's agenda for 2025-01-23. Every Version in it was created on 2025-01-10 or
  // 2025-01-16 (MeasureDocuments rows).
  describe("filters", () => {
    type Hit = { id: string; kind: string; measure: string | null; date: string | null };
    const hitsOf = (outcome: { structured: Record<string, unknown> | undefined }): Hit[] =>
      outcome.structured?.["results"] as Hit[];

    it("kind narrows the hits to one kind of document", async () => {
      const query = "dependent care tax credit";

      const everything = await callTool(connected, "search", { query });
      const agendas = await callTool(connected, "search", { query, kind: "agenda" });
      const versions = await callTool(connected, "search", { query, kind: "version" });

      expect(idsOf(everything)).toEqual(
        expect.arrayContaining(["version-2025r1-sb64-introduced", "agenda-2025r1-shs-2025-01-23-0800"]),
      );
      expect(idsOf(agendas)).toContain("agenda-2025r1-shs-2025-01-23-0800");
      expect(new Set(kindsOf(agendas))).toEqual(new Set(["agenda"]));
      expect(idsOf(versions)).toContain("version-2025r1-sb64-introduced");
      expect(new Set(kindsOf(versions))).toEqual(new Set(["version"]));
    });

    it("kind testimony returns Testimony without include_testimony: the call asked for it", async () => {
      const outcome = await callTool(connected, "search", { query: heritageQuery, kind: "testimony" });

      expect(idsOf(outcome)).toEqual(expect.arrayContaining(letters));
      expect(new Set(kindsOf(outcome))).toEqual(new Set(["testimony"]));
    });

    it("measure narrows the hits to the documents of one Measure", async () => {
      const everything = await callTool(connected, "search", { query: "department" });
      const sb69 = await callTool(connected, "search", { query: "department", measure: "SB 69" });

      expect(new Set(hitsOf(everything).map((hit) => hit.measure)).size).toBeGreaterThan(2);
      expect(new Set(hitsOf(sb69).map((hit) => hit.measure))).toEqual(new Set(["measure-2025r1-sb69"]));
      expect(idsOf(sb69)).toEqual(
        expect.arrayContaining(["version-2025r1-sb69-introduced", "amendment-2025r1-sb69-1", "exhibit-2025r1-287879"]),
      );
    });

    it("committee narrows the hits to the documents of one committee, given by its code or its id", async () => {
      const slb = ["agenda-2025r1-slb-2025-01-21-0800", "amendment-2025r1-sb69-1", "exhibit-2025r1-287879"];
      const everything = await callTool(connected, "search", { query: "department" });

      expect(idsOf(everything).length).toBeGreaterThan(slb.length);
      for (const committee of ["SLB", "slb", "committee-2025r1-slb"]) {
        const outcome = await callTool(connected, "search", { query: "department", committee });

        expect(idsOf(outcome).toSorted(), committee).toEqual(slb);
      }
    });

    it("from and to narrow the hits to a range of dates, the whole of the last day included", async () => {
      const query = "Employment Department";
      const everything = await callTool(connected, "search", { query });
      const onTheDay = await callTool(connected, "search", { query, from: "2025-01-21", to: "2025-01-21" });
      const afterTheVersions = await callTool(connected, "search", { query, from: "2025-01-11" });
      const beforeTheMeetings = await callTool(connected, "search", { query, to: "2025-01-20" });

      expect(idsOf(everything)).toContain("version-2025r1-sb69-introduced");
      expect(idsOf(onTheDay).toSorted()).toEqual(
        expect.arrayContaining(["amendment-2025r1-sb69-1", "exhibit-2025r1-287879"]),
      );
      expect(hitsOf(onTheDay).every((hit) => hit.date?.startsWith("2025-01-21") === true)).toBe(true);
      expect(idsOf(afterTheVersions)).not.toContain("version-2025r1-sb69-introduced");
      expect(hitsOf(afterTheVersions).every((hit) => (hit.date ?? "") >= "2025-01-11")).toBe(true);
      expect(idsOf(beforeTheMeetings)).toContain("version-2025r1-sb69-introduced");
      expect(hitsOf(beforeTheMeetings).every((hit) => (hit.date ?? "9") < "2025-01-21")).toBe(true);
    });

    it("an unknown Measure, an unknown committee and a backwards range are tool errors that say what is wrong", async () => {
      const measure = await callTool(connected, "search", { query: "department", measure: "HB 9999" });
      const committee = await callTool(connected, "search", { query: "department", committee: "XYZ" });
      const range = await callTool(connected, "search", { query: "department", from: "2025-02-01", to: "2025-01-01" });

      expect([measure.isError, committee.isError, range.isError]).toEqual([true, true, true]);
      expect(measure.text).toContain("HB 9999");
      expect(committee.text).toContain("XYZ");
      expect(range.text).toContain("2025-02-01");
    });
  });
  // Exact citations. The citation of a Measure ("HB 3131"), of a Proposed Amendment ("SB 69-1") or of an ORS
  // section ("ORS 192.245") puts its exact matches first, ahead of the documents that only talk about it.
  describe("a citation", () => {
    type Hit = { id: string; document_id: string; found_by: string[] };
    const hitsOf = (outcome: { structured: Record<string, unknown> | undefined }): Hit[] =>
      outcome.structured?.["results"] as Hit[];

    it("of a Measure puts the Measure's Version first, however the citation is written or what surrounds it", async () => {
      for (const query of ["HB 3131", "hb 3131", "HB3131", "what does HB 3131 pay for"]) {
        const outcome = await callTool(connected, "search", { query });

        expect(idsOf(outcome)[0], query).toBe("version-2025r1-hb3131-introduced");
        expect(hitsOf(outcome)[0]?.found_by, query).toContain("citation");
      }
    });

    it("of a Proposed Amendment puts the amendment first, as one node whose text is the posting's", async () => {
      // SB 69's amendment -1 was posted once by then: CommitteeProposedAmendments row 26284, SLB, 2025-01-21.
      const outcome = await callTool(connected, "search", { query: "SB 69-1" });

      expect(hitsOf(outcome)[0]).toMatchObject({
        id: "amendment-2025r1-sb69-1",
        document_id: "posting-2025r1-26284",
      });
      expect(idsOf(outcome).filter((id) => id === "amendment-2025r1-sb69-1")).toHaveLength(1);
    });

    it("of an ORS section puts the documents whose text holds it first", async () => {
      // `pdftotext -raw` finds "ORS 192.245" in SB 69's Introduced Version and in SB 921's, and in no other
      // document the corpus has, and the corpus's other documents talk about statutes, so they follow.
      const outcome = await callTool(connected, "search", { query: "ORS 192.245" });

      expect(idsOf(outcome).slice(0, 2).toSorted()).toEqual([
        "version-2025r1-sb69-introduced",
        "version-2025r1-sb921-introduced",
      ]);
      expect(
        hitsOf(outcome)
          .slice(0, 2)
          .map((hit) => hit.found_by),
      ).toEqual([expect.arrayContaining(["citation"]), expect.arrayContaining(["citation"])]);
    });

    it("keeps to the filters: a Version is not first when the search is for agendas", async () => {
      const outcome = await callTool(connected, "search", { query: "HB 3131", kind: "agenda" });

      expect(idsOf(outcome)).toContain("agenda-2025r1-halnrw-2025-01-22-0800");
      expect(new Set(kindsOf(outcome))).toEqual(new Set(["agenda"]));
    });

    it("that no document has finds what the rest of the query finds", async () => {
      const outcome = await callTool(connected, "search", { query: "HB 9999 Oregon Agricultural Heritage Fund" });

      expect(outcome.isError).toBe(false);
      expect(idsOf(outcome)).toContain("version-2025r1-hb3131-introduced");
    });
  });
});
